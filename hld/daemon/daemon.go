package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

const (
	// SocketPermissions for secure local-only access
	SocketPermissions = 0600
)

// Daemon coordinates all daemon functionality
type Daemon struct {
	config     *config.Config
	socketPath string
	listener   net.Listener
	rpcServer  *rpc.Server
	httpServer *HTTPServer
	sessions   session.SessionManager
	approvals  approval.Manager
	eventBus   bus.EventBus
	store      store.ConversationStore
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

	socketPath := cfg.SocketPath

	// Ensure directory exists
	socketDir := filepath.Dir(socketPath)
	if err := os.MkdirAll(socketDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create socket directory: %w", err)
	}

	// Check if socket already exists (another daemon running)
	if _, err := os.Stat(socketPath); err == nil {
		// Try to connect to see if it's alive
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			_ = conn.Close()
			return nil, fmt.Errorf("%w at %s", ErrDaemonAlreadyRunning, socketPath)
		}
		// Socket exists but can't connect, remove stale socket
		slog.Info("removing stale socket file", "path", socketPath)
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("failed to remove stale socket: %w", err)
		}
	}

	// Create event bus
	eventBus := bus.NewEventBus()

	// Initialize SQLite store
	conversationStore, err := store.NewSQLiteStore(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create SQLite store: %w", err)
	}

	// Create session manager with store and config
	sessionManager, err := session.NewManager(eventBus, conversationStore, cfg.SocketPath)
	if err != nil {
		_ = conversationStore.Close()
		return nil, fmt.Errorf("failed to create session manager: %w", err)
	}

	// Always create local approval manager
	slog.Info("creating local approval manager")
	approvalManager := approval.NewManager(conversationStore, eventBus)
	slog.Debug("local approval manager created successfully")

	// Create HTTP server if enabled
	var httpServer *HTTPServer
	if cfg.HTTPPort > 0 {
		slog.Info("creating HTTP server", "port", cfg.HTTPPort)
		httpServer = NewHTTPServer(cfg, sessionManager, approvalManager, conversationStore, eventBus)
	}

	return &Daemon{
		config:     cfg,
		socketPath: socketPath,
		sessions:   sessionManager,
		approvals:  approvalManager,
		eventBus:   eventBus,
		store:      conversationStore,
		httpServer: httpServer,
	}, nil
}

// Run starts the daemon and blocks until ctx is cancelled
func (d *Daemon) Run(ctx context.Context) error {
	// Create Unix socket listener
	listener, err := net.Listen("unix", d.socketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on socket: %w", err)
	}
	d.listener = listener

	// Set socket permissions
	if err := os.Chmod(d.socketPath, SocketPermissions); err != nil {
		_ = listener.Close()
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	// Track if listener was already closed
	listenerClosed := &struct{ closed bool }{}

	// Ensure cleanup on exit
	defer func() {
		if !listenerClosed.closed {
			if err := listener.Close(); err != nil {
				slog.Warn("failed to close listener", "error", err)
			}
		}
		if err := os.Remove(d.socketPath); err != nil && !os.IsNotExist(err) {
			slog.Warn("failed to remove socket file", "path", d.socketPath, "error", err)
		}
		if d.store != nil {
			if err := d.store.Close(); err != nil {
				slog.Warn("failed to close store", "error", err)
			}
		}
		slog.Info("cleaned up resources", "path", d.socketPath)
	}()

	// Create and start RPC server
	if d.config.VersionOverride != "" {
		d.rpcServer = rpc.NewServerWithVersionOverride(d.config.VersionOverride)
	} else {
		d.rpcServer = rpc.NewServer()
	}

	// Mark orphaned sessions as failed (from previous daemon run)
	if err := d.markOrphanedSessionsAsFailed(ctx); err != nil {
		slog.Warn("failed to mark orphaned sessions as failed", "error", err)
		// Don't fail startup for this
	}

	// Register subscription handlers
	subscriptionHandlers := rpc.NewSubscriptionHandlers(d.eventBus)
	d.rpcServer.SetSubscriptionHandlers(subscriptionHandlers)

	// Register session handlers
	sessionHandlers := rpc.NewSessionHandlers(d.sessions, d.store, d.approvals)
	sessionHandlers.SetEventBus(d.eventBus)
	sessionHandlers.Register(d.rpcServer)

	// Register local approval handlers
	approvalHandlers := rpc.NewApprovalHandlers(d.approvals, d.sessions)
	approvalHandlers.Register(d.rpcServer)

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

	slog.Info("daemon started", "socket", d.socketPath, "http_enabled", d.httpServer != nil)

	// Accept connections until context is cancelled
	go d.acceptConnections(ctx)

	// Wait for shutdown signal
	<-ctx.Done()

	// Close listener to stop accepting new connections
	if err := listener.Close(); err != nil {
		slog.Warn("error closing listener during shutdown", "error", err)
	}
	listenerClosed.closed = true

	return nil
}

// acceptConnections handles incoming client connections
func (d *Daemon) acceptConnections(ctx context.Context) {
	for {
		conn, err := d.listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				// Expected during shutdown
				return
			default:
				slog.Error("failed to accept connection", "error", err)
				continue
			}
		}

		// Handle each connection in a goroutine
		go d.handleConnection(ctx, conn)
	}
}

// handleConnection processes a single client connection
func (d *Daemon) handleConnection(ctx context.Context, conn net.Conn) {
	defer func() { _ = conn.Close() }()

	slog.Debug("new client connected", "remote", conn.RemoteAddr())

	// Let RPC server handle the connection
	if err := d.rpcServer.ServeConn(ctx, conn); err != nil {
		slog.Error("error serving connection", "error", err)
	}

	slog.Debug("client disconnected", "remote", conn.RemoteAddr())
}

// markOrphanedSessionsAsFailed marks any sessions that were running or waiting
// when the daemon restarted as failed
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
		// Mark running or waiting sessions as failed
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
