package session

import (
	"context"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/store"
)

// ApprovalReconciler interface for reconciling approvals after session restart
type ApprovalReconciler interface {
	ReconcileApprovalsForSession(ctx context.Context, runID string) error
}

// Status represents the current state of a session
type Status string

const (
	StatusStarting     Status = "starting"
	StatusRunning      Status = "running"
	StatusCompleted    Status = "completed"
	StatusFailed       Status = "failed"
	StatusInterrupting Status = "interrupting" // Session received interrupt signal and is shutting down
	StatusInterrupted  Status = "interrupted"  // Session was interrupted but can be resumed
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
	ParentSessionID string             `json:"parent_session_id,omitempty"`
	Status          Status             `json:"status"`
	StartTime       time.Time          `json:"start_time"`
	EndTime         *time.Time         `json:"end_time,omitempty"`
	LastActivityAt  time.Time          `json:"last_activity_at"`
	Error           string             `json:"error,omitempty"`
	Query           string             `json:"query"`
	Summary         string             `json:"summary"`
	Title           string             `json:"title"`
	Model           string             `json:"model,omitempty"`
	WorkingDir      string             `json:"working_dir,omitempty"`
	Result          *claudecode.Result `json:"result,omitempty"`
	AutoAcceptEdits bool               `json:"auto_accept_edits"`
	Archived        bool               `json:"archived"`
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

	// InterruptSession interrupts a running session
	InterruptSession(ctx context.Context, sessionID string) error
}

// ReadToolResult represents the JSON structure of a Read tool result
type ReadToolResult struct {
	Type string `json:"type"`
	File struct {
		FilePath   string `json:"filePath"`
		Content    string `json:"content"`
		NumLines   int    `json:"numLines"`
		StartLine  int    `json:"startLine"`
		TotalLines int    `json:"totalLines"`
	} `json:"file"`
}

// SessionToInfo converts a store.Session to Info for RPC responses
func SessionToInfo(s store.Session) Info {
	info := Info{
		ID:              s.ID,
		RunID:           s.RunID,
		ClaudeSessionID: s.ClaudeSessionID,
		ParentSessionID: s.ParentSessionID,
		Status:          Status(s.Status),
		StartTime:       s.CreatedAt,
		LastActivityAt:  s.LastActivityAt,
		Error:           s.ErrorMessage,
		Query:           s.Query,
		Summary:         s.Summary,
		Title:           s.Title,
		Model:           s.Model,
		WorkingDir:      s.WorkingDir,
		AutoAcceptEdits: s.AutoAcceptEdits,
		Archived:        s.Archived,
	}

	if s.CompletedAt != nil {
		info.EndTime = s.CompletedAt
	}

	// Populate Result field if we have result data
	if s.ResultContent != "" || s.NumTurns != nil || s.CostUSD != nil || s.DurationMS != nil {
		result := &claudecode.Result{
			Type:      "result",
			Subtype:   "session_completed",
			Result:    s.ResultContent,
			SessionID: s.ClaudeSessionID, // Use Claude session ID for consistency
		}

		if s.CostUSD != nil {
			result.CostUSD = *s.CostUSD
		}
		if s.NumTurns != nil {
			result.NumTurns = *s.NumTurns
		}
		if s.DurationMS != nil {
			result.DurationMS = *s.DurationMS
		}
		if s.ErrorMessage != "" {
			result.Error = s.ErrorMessage
			result.IsError = true
		}

		info.Result = result
	}

	return info
}
