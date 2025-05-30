package session

import (
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