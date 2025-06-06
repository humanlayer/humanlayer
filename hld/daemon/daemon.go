package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"

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
		return nil, fmt.Errorf("load config: %w", err)
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("validate configuration: %w", err)
	}

	socketPath := cfg.SocketPath

	// Ensure directory exists
	socketDir := filepath.Dir(socketPath)
	if err := os.MkdirAll(socketDir, 0700); err != nil {
		return nil, fmt.Errorf("create socket directory: %w", err)
	}

	// Check if socket already exists (another daemon running)
	if _, err := os.Stat(socketPath); err == nil {
		// Try to connect to see if it's alive
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			_ = conn.Close()
			return nil, fmt.Errorf("daemon already running at %s: %w", socketPath, ErrDaemonAlreadyRunning)
		}
		// Socket exists but can't connect, remove stale socket
		slog.Info("removing stale socket file", "path", socketPath)
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("remove stale socket: %w", err)
		}
	}

	// Create event bus
	eventBus := bus.NewEventBus()

	// Initialize SQLite store
	conversationStore, err := store.NewSQLiteStore(cfg.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("create SQLite store: %w", err)
	}

	// Create session manager with store and config
	sessionManager, err := session.NewManager(eventBus, conversationStore)
	if err != nil {
		_ = conversationStore.Close()
		return nil, fmt.Errorf("failed to create session manager: %w", err)
	}

	// Create approval manager if API key is configured
	var approvalManager approval.Manager
	if cfg.APIKey != "" {
		slog.Info("creating approval manager", "api_base_url", cfg.APIBaseURL)
		approvalCfg := approval.Config{
			APIKey:  cfg.APIKey,
			BaseURL: cfg.APIBaseURL,
			// Use defaults for now, could add to daemon config later
		}
		approvalManager, err = approval.NewManager(approvalCfg, eventBus)
		if err != nil {
			return nil, fmt.Errorf("failed to create approval manager: %w", err)
		}
		slog.Debug("approval manager created successfully")
	} else {
		slog.Warn("no API key configured, approval features disabled")
	}

	return &Daemon{
		config:     cfg,
		socketPath: socketPath,
		sessions:   sessionManager,
		approvals:  approvalManager,
		eventBus:   eventBus,
		store:      conversationStore,
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

	// Ensure cleanup on exit
	defer func() {
		if err := listener.Close(); err != nil {
			slog.Warn("failed to close listener", "error", err)
		}
		if err := os.Remove(d.socketPath); err != nil {
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
	d.rpcServer = rpc.NewServer()

	// Register subscription handlers
	subscriptionHandlers := rpc.NewSubscriptionHandlers(d.eventBus)
	d.rpcServer.SetSubscriptionHandlers(subscriptionHandlers)

	// Register session handlers
	sessionHandlers := rpc.NewSessionHandlers(d.sessions)
	sessionHandlers.Register(d.rpcServer)

	// Always register approval handlers (even without API key)
	approvalHandlers := rpc.NewApprovalHandlers(d.approvals, d.sessions)
	approvalHandlers.Register(d.rpcServer)

	// Start approval polling if approval manager is available
	if d.approvals != nil {
		if err := d.approvals.Start(ctx); err != nil {
			_ = listener.Close()
			return fmt.Errorf("failed to start approval poller: %w", err)
		}
		defer d.approvals.Stop()

		slog.Info("approval polling started")
	} else {
		slog.Warn("approval manager not configured (no API key)")
	}

	slog.Info("daemon started", "socket", d.socketPath)

	// Accept connections until context is cancelled
	go d.acceptConnections(ctx)

	// Wait for shutdown signal
	<-ctx.Done()

	// Close listener to stop accepting new connections
	if err := listener.Close(); err != nil {
		slog.Warn("error closing listener during shutdown", "error", err)
	}

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
