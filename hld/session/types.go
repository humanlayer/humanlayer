package session

import (
	"context"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// Status represents the current state of a session
type Status string

const (
	StatusStarting  Status = "starting"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

// Session represents a Claude Code session managed by the daemon
type Session struct {
	ID        string                   `json:"id"`
	RunID     string                   `json:"run_id"`
	Status    Status                   `json:"status"`
	StartTime time.Time                `json:"start_time"`
	EndTime   *time.Time               `json:"end_time,omitempty"`
	Error     string                   `json:"error,omitempty"`
	Config    claudecode.SessionConfig `json:"config"`
	Result    *claudecode.Result       `json:"result,omitempty"`
}

// Info provides a JSON-safe view of the session
type Info struct {
	ID              string             `json:"id"`
	RunID           string             `json:"run_id"`
	ClaudeSessionID string             `json:"claude_session_id,omitempty"`
	Status          Status             `json:"status"`
	StartTime       time.Time          `json:"start_time"`
	EndTime         *time.Time         `json:"end_time,omitempty"`
	LastActivityAt  time.Time          `json:"last_activity_at"`
	Error           string             `json:"error,omitempty"`
	Query           string             `json:"query"`
	Model           string             `json:"model,omitempty"`
	WorkingDir      string             `json:"working_dir,omitempty"`
	Result          *claudecode.Result `json:"result,omitempty"`
}

// ContinueSessionConfig contains the configuration for continuing a session
type ContinueSessionConfig struct {
	ParentSessionID      string                // The parent session to resume from
	Query                string                // The new query
	SystemPrompt         string                // Optional system prompt override
	AppendSystemPrompt   string                // Optional append to system prompt
	MCPConfig            *claudecode.MCPConfig // Optional MCP config override
	PermissionPromptTool string                // Optional permission prompt tool
	AllowedTools         []string              // Optional allowed tools override
	DisallowedTools      []string              // Optional disallowed tools override
	CustomInstructions   string                // Optional custom instructions
	MaxTurns             int                   // Optional max turns override
}

// SessionManager defines the interface for managing Claude Code sessions
type SessionManager interface {
	// LaunchSession starts a new Claude Code session
	LaunchSession(ctx context.Context, config claudecode.SessionConfig) (*Session, error)

	// ContinueSession resumes an existing completed session with a new query and optional config overrides
	ContinueSession(ctx context.Context, req ContinueSessionConfig) (*Session, error)

	// GetSessionInfo returns session info from the database by ID
	GetSessionInfo(sessionID string) (*Info, error)

	// ListSessions returns all sessions from the database
	ListSessions() []Info
}
