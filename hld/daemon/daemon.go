package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
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
	sessions   *session.Manager
	mu         sync.Mutex
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
			conn.Close()
			return nil, fmt.Errorf("%w at %s", ErrDaemonAlreadyRunning, socketPath)
		}
		// Socket exists but can't connect, remove stale socket
		slog.Info("removing stale socket file", "path", socketPath)
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("failed to remove stale socket: %w", err)
		}
	}

	// Create session manager
	sessionManager, err := session.NewManager()
	if err != nil {
		return nil, fmt.Errorf("failed to create session manager: %w", err)
	}

	return &Daemon{
		config:     cfg,
		socketPath: socketPath,
		sessions:   sessionManager,
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
		listener.Close()
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	// Ensure socket is cleaned up on exit
	defer func() {
		listener.Close()
		os.Remove(d.socketPath)
		slog.Info("cleaned up socket", "path", d.socketPath)
	}()

	// Create and start RPC server
	d.rpcServer = rpc.NewServer()

	// Register session handlers
	sessionHandlers := rpc.NewSessionHandlers(d.sessions)
	sessionHandlers.Register(d.rpcServer)

	slog.Info("daemon started", "socket", d.socketPath)

	// Accept connections until context is cancelled
	go d.acceptConnections(ctx)

	// Wait for shutdown signal
	<-ctx.Done()

	// Close listener to stop accepting new connections
	listener.Close()

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
	defer conn.Close()

	slog.Debug("new client connected", "remote", conn.RemoteAddr())

	// Let RPC server handle the connection
	if err := d.rpcServer.ServeConn(ctx, conn); err != nil {
		slog.Error("error serving connection", "error", err)
	}

	slog.Debug("client disconnected", "remote", conn.RemoteAddr())
}
