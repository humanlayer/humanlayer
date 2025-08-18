package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// getShutdownTimeout returns the timeout for graceful session shutdown
func getShutdownTimeout() time.Duration {
	if timeoutStr := os.Getenv("HUMANLAYER_HLD_SHUTDOWN_TIMEOUT"); timeoutStr != "" {
		if timeout, err := time.ParseDuration(timeoutStr); err == nil {
			slog.Info("using custom shutdown timeout", "timeout", timeout)
			return timeout
		} else {
			slog.Warn("invalid HUMANLAYER_HLD_SHUTDOWN_TIMEOUT, using default",
				"value", timeoutStr, "error", err)
		}
	}
	return 5 * time.Second // default per ENG-1699 requirements
}

// getPermissionMonitorInterval returns the interval for dangerous skip permissions expiry checks
func getPermissionMonitorInterval() time.Duration {
	if intervalStr := os.Getenv("HLD_PERMISSION_MONITOR_INTERVAL"); intervalStr != "" {
		if interval, err := time.ParseDuration(intervalStr); err == nil {
			return interval
		}
		slog.Warn("invalid HLD_PERMISSION_MONITOR_INTERVAL, using default", "value", intervalStr)
	}
	return 30 * time.Second
}

// Daemon coordinates all daemon functionality
type Daemon struct {
	config            *config.Config
	httpServer        *HTTPServer
	sessions          session.SessionManager
	approvals         approval.Manager
	eventBus          bus.EventBus
	store             store.ConversationStore
	permissionMonitor *session.PermissionMonitor
	pidfileManager    *PidfileManager
}

// New creates a new daemon instance
func New() (*Daemon, error) {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid configuration: %w", err)
	}

	// Safeguard: Prevent test binaries from using production database
	if strings.Contains(os.Args[0], "/T/") || strings.Contains(os.Args[0], "test") {
		defaultDB := expandPath("~/.humanlayer/daemon.db")
		if cfg.DatabasePath == defaultDB && os.Getenv("HUMANLAYER_ALLOW_TEST_PROD_DB") != "true" {
			return nil, fmt.Errorf("test process attempting to use production database - set HUMANLAYER_DATABASE_PATH or HUMANLAYER_ALLOW_TEST_PROD_DB=true")
		}
	}

	// Use config directory for pidfile
	configDir := expandPath("~/.humanlayer")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create config directory: %w", err)
	}

	// Create pidfile based on database name pattern
	// Extract base name from database path for consistency
	dbBase := filepath.Base(cfg.DatabasePath)
	if ext := filepath.Ext(dbBase); ext == ".db" {
		dbBase = dbBase[:len(dbBase)-len(ext)]
	}
	pidfilePath := filepath.Join(configDir, dbBase+".pid")
	pidfileManager := NewPidfileManager(pidfilePath)

	// Check if another daemon is already running via pidfile
	running, err := pidfileManager.CheckRunning()
	if err != nil {
		return nil, fmt.Errorf("failed to check daemon status: %w", err)
	}
	if running {
		return nil, fmt.Errorf("%w (pidfile: %s)", ErrDaemonAlreadyRunning, pidfilePath)
	}

	// Write our PID
	if err := pidfileManager.WritePidfile(); err != nil {
		return nil, fmt.Errorf("failed to write pidfile: %w", err)
	}
	slog.Info("wrote pidfile", "path", pidfilePath)

	// Create event bus
	eventBus := bus.NewEventBus()

	// Initialize SQLite store
	conversationStore, err := store.NewSQLiteStore(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create SQLite store: %w", err)
	}

	// Create session manager with store and config (pass HTTP port)
	sessionManager, err := session.NewManager(eventBus, conversationStore, cfg.HTTPPort)
	if err != nil {
		_ = conversationStore.Close()
		return nil, fmt.Errorf("failed to create session manager: %w", err)
	}

	// Always create local approval manager
	slog.Info("creating local approval manager")
	approvalManager := approval.NewManager(conversationStore, eventBus)
	slog.Debug("local approval manager created successfully")

	// Create HTTP server (always enabled, port 0 means dynamic allocation)
	slog.Info("creating HTTP server", "port", cfg.HTTPPort)
	httpServer := NewHTTPServer(cfg, sessionManager, approvalManager, conversationStore, eventBus)

	return &Daemon{
		config:         cfg,
		sessions:       sessionManager,
		approvals:      approvalManager,
		eventBus:       eventBus,
		store:          conversationStore,
		httpServer:     httpServer,
		pidfileManager: pidfileManager,
	}, nil
}

// Run starts the daemon and blocks until ctx is cancelled
func (d *Daemon) Run(ctx context.Context) error {
	// Ensure cleanup on exit
	defer func() {
		if d.pidfileManager != nil {
			if err := d.pidfileManager.Cleanup(); err != nil {
				slog.Warn("failed to cleanup pidfile", "error", err)
			}
		}
		if d.store != nil {
			if err := d.store.Close(); err != nil {
				slog.Warn("failed to close store", "error", err)
			}
		}
		slog.Info("cleaned up resources")
	}()

	// Mark orphaned sessions as failed (from previous daemon run)
	if err := d.markOrphanedSessionsAsFailed(ctx); err != nil {
		slog.Warn("failed to mark orphaned sessions as failed", "error", err)
		// Don't fail startup for this
	}

	// Create and start dangerous skip permissions monitor
	permissionMonitor := session.NewPermissionMonitor(d.store, d.eventBus, getPermissionMonitorInterval())
	d.permissionMonitor = permissionMonitor

	// Start dangerous skip permissions monitor in background
	go func() {
		permissionMonitor.Start(ctx)
	}()
	slog.Info("started dangerous skip permissions expiry monitor")

	// Start HTTP server if enabled
	if d.httpServer != nil {
		httpCtx, httpCancel := context.WithCancel(ctx)
		defer httpCancel()

		go func() {
			if err := d.httpServer.Start(httpCtx); err != nil {
				slog.Error("HTTP server error", "error", err)
			}
		}()
	}

	slog.Info("daemon started", "http_port", d.config.HTTPPort)

	// Wait for shutdown signal
	<-ctx.Done()
	slog.Info("shutdown signal received, stopping sessions")

	// Gracefully stop all active sessions with configurable timeout
	if d.sessions != nil {
		shutdownTimeout := getShutdownTimeout()
		slog.Info("stopping sessions with timeout", "timeout", shutdownTimeout)

		if err := d.sessions.StopAllSessions(shutdownTimeout); err != nil {
			slog.Error("error stopping sessions", "error", err)
		}
	}

	// Stop HTTP server if running
	if d.httpServer != nil {
		if err := d.httpServer.Shutdown(); err != nil {
			slog.Error("error shutting down HTTP server", "error", err)
		}
	}

	return nil
}

// markOrphanedSessionsAsFailed marks any sessions that were running or waiting
// when the daemon restarted as failed. Sessions with status interrupting, interrupted,
// completed, or failed are left as-is.
func (d *Daemon) markOrphanedSessionsAsFailed(ctx context.Context) error {
	if d.store == nil {
		return nil
	}

	// Get all sessions from the database
	sessions, err := d.store.ListSessions(ctx)
	if err != nil {
		return fmt.Errorf("failed to list sessions: %w", err)
	}

	orphanedCount := 0
	for _, session := range sessions {
		// Mark only truly orphaned sessions as failed (running, waiting_input, starting).
		// Sessions with status interrupting, interrupted, completed, or failed are left as-is
		// to allow interrupted sessions to be resumed after daemon restart.
		if session.Status == store.SessionStatusRunning ||
			session.Status == store.SessionStatusWaitingInput ||
			session.Status == store.SessionStatusStarting {
			failedStatus := store.SessionStatusFailed
			errorMsg := "daemon restarted while session was active"
			now := time.Now()
			update := store.SessionUpdate{
				Status:       &failedStatus,
				CompletedAt:  &now,
				ErrorMessage: &errorMsg,
			}

			if err := d.store.UpdateSession(ctx, session.ID, update); err != nil {
				slog.Error("failed to mark orphaned session as failed",
					"session_id", session.ID,
					"error", err)
				// Continue with other sessions
			} else {
				orphanedCount++
			}
		}
	}

	if orphanedCount > 0 {
		slog.Info("marked orphaned sessions as failed", "count", orphanedCount)
	}

	return nil
}

// expandPath expands ~ to the user's home directory
func expandPath(path string) string {
	if len(path) > 0 && path[0] == '~' {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}
