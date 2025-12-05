package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

const (
	// DefaultIdleTimeout is the default idle timeout for terminal sessions
	DefaultIdleTimeout = 30 * time.Minute

	// writeWait is the time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// pongWait is the time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// pingPeriod is how often to send pings to peer (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10
)

// ResizeMessage represents a terminal resize request
type ResizeMessage struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// TerminalHandler manages WebSocket terminal connections
type TerminalHandler struct {
	sessionManager session.SessionManager
	store          store.ConversationStore
	upgrader       websocket.Upgrader
	idleTimeout    time.Duration
}

// NewTerminalHandler creates a new terminal handler
func NewTerminalHandler(sessionManager session.SessionManager, store store.ConversationStore) *TerminalHandler {
	return &TerminalHandler{
		sessionManager: sessionManager,
		store:          store,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			// Allow connections from any origin for local development
			// In production, this should be restricted
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
		idleTimeout: DefaultIdleTimeout,
	}
}

// HandleWebSocket handles the WebSocket terminal connection
func (h *TerminalHandler) HandleWebSocket(c *gin.Context) {
	sessionID := c.Query("sessionId")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sessionId is required"})
		return
	}

	// Get session to validate it exists and get working directory
	sess, err := h.store.GetSession(c.Request.Context(), sessionID)
	if err != nil {
		slog.Error("failed to get session for terminal", "session_id", sessionID, "error", err)
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	// Validate working directory exists
	workingDir := sess.WorkingDir
	if workingDir == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session has no working directory"})
		return
	}

	// Expand ~ if present
	if strings.HasPrefix(workingDir, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			slog.Error("failed to get home directory", "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve home directory"})
			return
		}
		workingDir = filepath.Join(home, strings.TrimPrefix(workingDir, "~"))
	}

	// Verify the directory exists
	info, err := os.Stat(workingDir)
	if err != nil || !info.IsDir() {
		slog.Error("working directory does not exist or is not a directory", "path", workingDir, "error", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "working directory does not exist"})
		return
	}

	// Upgrade to WebSocket
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("failed to upgrade to websocket", "error", err)
		return
	}

	slog.Info("terminal websocket connected", "session_id", sessionID, "working_dir", workingDir)

	// Create terminal session
	ts := &terminalSession{
		conn:        conn,
		workingDir:  workingDir,
		idleTimeout: h.idleTimeout,
	}

	// Run the terminal session
	ts.run(c.Request.Context())
}

// terminalSession represents an active terminal session
type terminalSession struct {
	conn        *websocket.Conn
	workingDir  string
	idleTimeout time.Duration
	ptmx        *os.File
	cmd         *exec.Cmd
	mu          sync.Mutex
	closed      bool
}

// run starts the terminal session and handles I/O
func (ts *terminalSession) run(ctx context.Context) {
	defer ts.cleanup()

	// Get user's shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}

	// Create command
	ts.cmd = exec.CommandContext(ctx, shell)
	ts.cmd.Dir = ts.workingDir

	// Set up safe environment variables
	ts.cmd.Env = ts.getSafeEnv()

	// Start the command with a PTY
	var err error
	ts.ptmx, err = pty.Start(ts.cmd)
	if err != nil {
		slog.Error("failed to start pty", "error", err)
		ts.sendError("failed to start terminal")
		return
	}

	// Set initial terminal size
	_ = pty.Setsize(ts.ptmx, &pty.Winsize{Rows: 24, Cols: 80})

	// Create context for cancellation
	sessionCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Set up ping/pong for connection health
	_ = ts.conn.SetReadDeadline(time.Now().Add(pongWait))
	ts.conn.SetPongHandler(func(string) error {
		_ = ts.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Start goroutines for I/O
	var wg sync.WaitGroup

	// PTY -> WebSocket (stdout)
	wg.Add(1)
	go func() {
		defer wg.Done()
		ts.readFromPTY(sessionCtx, cancel)
	}()

	// WebSocket -> PTY (stdin)
	wg.Add(1)
	go func() {
		defer wg.Done()
		ts.readFromWebSocket(sessionCtx, cancel)
	}()

	// Ping ticker
	wg.Add(1)
	go func() {
		defer wg.Done()
		ts.pingLoop(sessionCtx)
	}()

	// Wait for all goroutines to finish
	wg.Wait()

	slog.Info("terminal session ended", "working_dir", ts.workingDir)
}

// readFromPTY reads from the PTY and sends to WebSocket
func (ts *terminalSession) readFromPTY(ctx context.Context, cancel context.CancelFunc) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := ts.ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					slog.Debug("pty read error", "error", err)
				}
				cancel()
				return
			}

			if n > 0 {
				ts.mu.Lock()
				if !ts.closed {
					_ = ts.conn.SetWriteDeadline(time.Now().Add(writeWait))
					err = ts.conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				}
				ts.mu.Unlock()

				if err != nil {
					slog.Debug("websocket write error", "error", err)
					cancel()
					return
				}
			}
		}
	}
}

// readFromWebSocket reads from WebSocket and writes to PTY
func (ts *terminalSession) readFromWebSocket(ctx context.Context, cancel context.CancelFunc) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			messageType, message, err := ts.conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					slog.Debug("websocket read error", "error", err)
				}
				cancel()
				return
			}

			switch messageType {
			case websocket.BinaryMessage:
				// Write to PTY stdin
				_, err = ts.ptmx.Write(message)
				if err != nil {
					slog.Debug("pty write error", "error", err)
					cancel()
					return
				}

			case websocket.TextMessage:
				// Parse as JSON control message
				var resize ResizeMessage
				if err := json.Unmarshal(message, &resize); err != nil {
					slog.Debug("failed to parse control message", "error", err)
					continue
				}

				if resize.Type == "resize" {
					ts.handleResize(resize.Cols, resize.Rows)
				}
			}
		}
	}
}

// handleResize handles terminal resize requests
func (ts *terminalSession) handleResize(cols, rows uint16) {
	if ts.ptmx == nil {
		return
	}

	err := pty.Setsize(ts.ptmx, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
	if err != nil {
		slog.Debug("failed to resize pty", "error", err, "cols", cols, "rows", rows)
	} else {
		slog.Debug("terminal resized", "cols", cols, "rows", rows)
	}
}

// pingLoop sends periodic pings to keep the connection alive
func (ts *terminalSession) pingLoop(ctx context.Context) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ts.mu.Lock()
			if !ts.closed {
				_ = ts.conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := ts.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					ts.mu.Unlock()
					return
				}
			}
			ts.mu.Unlock()
		}
	}
}

// sendError sends an error message to the WebSocket client
func (ts *terminalSession) sendError(msg string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if !ts.closed {
		errMsg := fmt.Sprintf("\r\n\x1b[31mError: %s\x1b[0m\r\n", msg)
		_ = ts.conn.WriteMessage(websocket.BinaryMessage, []byte(errMsg))
	}
}

// cleanup closes all resources
func (ts *terminalSession) cleanup() {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.closed {
		return
	}
	ts.closed = true

	// Close PTY
	if ts.ptmx != nil {
		_ = ts.ptmx.Close()
	}

	// Kill the process if still running
	if ts.cmd != nil && ts.cmd.Process != nil {
		_ = ts.cmd.Process.Kill()
		_ = ts.cmd.Wait()
	}

	// Close WebSocket
	_ = ts.conn.Close()
}

// getSafeEnv returns a filtered set of environment variables
func (ts *terminalSession) getSafeEnv() []string {
	// Allowlist of safe environment variables to pass through
	allowedVars := map[string]bool{
		"PATH":            true,
		"HOME":            true,
		"USER":            true,
		"SHELL":           true,
		"TERM":            true,
		"LANG":            true,
		"LC_ALL":          true,
		"LC_CTYPE":        true,
		"COLORTERM":       true,
		"EDITOR":          true,
		"VISUAL":          true,
		"PAGER":           true,
		"LESS":            true,
		"TMPDIR":          true,
		"TZ":              true,
		"XDG_RUNTIME_DIR": true,
	}

	var env []string
	for _, e := range os.Environ() {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 && allowedVars[parts[0]] {
			env = append(env, e)
		}
	}

	// Set TERM if not present
	hasterm := false
	for _, e := range env {
		if strings.HasPrefix(e, "TERM=") {
			hasterm = true
			break
		}
	}
	if !hasterm {
		env = append(env, "TERM=xterm-256color")
	}

	return env
}
