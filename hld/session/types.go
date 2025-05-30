package session

import (
	"context"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// Status represents the current state of a session
type Status string

const (
	StatusStarting Status = "starting"
	StatusRunning  Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

// Session represents a Claude Code session managed by the daemon
type Session struct {
	ID        string                    `json:"id"`
	RunID     string                    `json:"run_id"`
	Status    Status                    `json:"status"`
	StartTime time.Time                 `json:"start_time"`
	EndTime   *time.Time                `json:"end_time,omitempty"`
	Error     string                    `json:"error,omitempty"`
	Config    claudecode.SessionConfig  `json:"config"`

	// Process tracking
	claude    *claudecode.Session       // The actual Claude session
}

// Info provides a JSON-safe view of the session
type Info struct {
	ID        string                    `json:"id"`
	RunID     string                    `json:"run_id"`
	Status    Status                    `json:"status"`
	StartTime time.Time                 `json:"start_time"`
	EndTime   *time.Time                `json:"end_time,omitempty"`
	Error     string                    `json:"error,omitempty"`
	Prompt    string                    `json:"prompt"`
	Model     string                    `json:"model,omitempty"`
}

// SessionManager defines the interface for managing Claude Code sessions
type SessionManager interface {
	// LaunchSession starts a new Claude Code session
	LaunchSession(ctx context.Context, config claudecode.SessionConfig) (*Session, error)

	// GetSession returns a session by ID
	GetSession(sessionID string) (*Session, error)

	// ListSessions returns all sessions
	ListSessions() []*Session

	// GetSessionInfo returns a JSON-safe view of a session
	GetSessionInfo(sessionID string) (*Info, error)

	// ListSessionInfo returns JSON-safe views of all sessions
	ListSessionInfo() []Info
}
