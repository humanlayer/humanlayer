package store

import (
	"context"
	"encoding/json"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// ConversationStore defines the interface for storing conversation data
type ConversationStore interface {
	// Session operations
	CreateSession(ctx context.Context, session *Session) error
	UpdateSession(ctx context.Context, sessionID string, updates SessionUpdate) error
	GetSession(ctx context.Context, sessionID string) (*Session, error)
	GetSessionByRunID(ctx context.Context, runID string) (*Session, error)
	ListSessions(ctx context.Context) ([]*Session, error)

	// Conversation operations
	AddConversationEvent(ctx context.Context, event *ConversationEvent) error
	GetConversation(ctx context.Context, claudeSessionID string) ([]*ConversationEvent, error)
	GetSessionConversation(ctx context.Context, sessionID string) ([]*ConversationEvent, error)

	// Tool call operations
	GetPendingToolCall(ctx context.Context, sessionID string, toolName string) (*ConversationEvent, error)
	GetUncorrelatedPendingToolCall(ctx context.Context, sessionID string, toolName string) (*ConversationEvent, error)
	GetPendingToolCalls(ctx context.Context, sessionID string) ([]*ConversationEvent, error)
	MarkToolCallCompleted(ctx context.Context, toolID string, sessionID string) error
	CorrelateApproval(ctx context.Context, sessionID string, toolName string, approvalID string) error
	CorrelateApprovalByToolID(ctx context.Context, sessionID string, toolID string, approvalID string) error
	UpdateApprovalStatus(ctx context.Context, approvalID string, status string) error

	// MCP server operations
	StoreMCPServers(ctx context.Context, sessionID string, servers []MCPServer) error
	GetMCPServers(ctx context.Context, sessionID string) ([]MCPServer, error)

	// Raw event storage (for debugging)
	StoreRawEvent(ctx context.Context, sessionID string, eventJSON string) error

	// Approval operations for local approvals
	CreateApproval(ctx context.Context, approval *Approval) error
	GetApproval(ctx context.Context, id string) (*Approval, error)
	GetPendingApprovals(ctx context.Context, sessionID string) ([]*Approval, error)
	UpdateApprovalResponse(ctx context.Context, id string, status ApprovalStatus, comment string) error

	// Database lifecycle
	Close() error
}

// Session represents a Claude Code session
type Session struct {
	ID                   string
	RunID                string
	ClaudeSessionID      string
	ParentSessionID      string
	Query                string
	Summary              string
	Model                string
	WorkingDir           string
	MaxTurns             int
	SystemPrompt         string
	AppendSystemPrompt   string // NEW: Append to system prompt
	CustomInstructions   string
	PermissionPromptTool string // NEW: MCP tool for permission prompts
	AllowedTools         string // NEW: JSON array of allowed tools
	DisallowedTools      string // NEW: JSON array of disallowed tools
	Status               string
	CreatedAt            time.Time
	LastActivityAt       time.Time
	CompletedAt          *time.Time
	CostUSD              *float64
	TotalTokens          *int
	DurationMS           *int
	NumTurns             *int
	ResultContent        string
	ErrorMessage         string
}

// SessionUpdate contains fields that can be updated
type SessionUpdate struct {
	ClaudeSessionID *string
	Summary         *string
	Status          *string
	LastActivityAt  *time.Time
	CompletedAt     *time.Time
	CostUSD         *float64
	TotalTokens     *int
	DurationMS      *int
	NumTurns        *int
	ResultContent   *string
	ErrorMessage    *string
}

// ConversationEvent represents a single event in a conversation
type ConversationEvent struct {
	ID              int64
	SessionID       string
	ClaudeSessionID string
	Sequence        int
	EventType       string // 'message', 'tool_call', 'tool_result', 'system'
	CreatedAt       time.Time

	// Message fields
	Role    string // user, assistant, system
	Content string

	// Tool call fields
	ToolID          string
	ToolName        string
	ToolInputJSON   string
	ParentToolUseID string

	// Tool result fields
	ToolResultForID   string
	ToolResultContent string

	// Tool call tracking
	IsCompleted    bool   // TRUE when tool result received
	ApprovalStatus string // NULL, 'pending', 'approved', 'denied'
	ApprovalID     string // HumanLayer approval ID when correlated
}

// MCPServer represents an MCP server configuration
type MCPServer struct {
	ID        int64
	SessionID string
	Name      string
	Command   string
	ArgsJSON  string // JSON array
	EnvJSON   string // JSON object
}

// ApprovalStatus represents the status of an approval
type ApprovalStatus string

// Valid approval statuses
const (
	ApprovalStatusLocalPending  ApprovalStatus = "pending"
	ApprovalStatusLocalApproved ApprovalStatus = "approved"
	ApprovalStatusLocalDenied   ApprovalStatus = "denied"
)

// String returns the string representation of the status
func (s ApprovalStatus) String() string {
	return string(s)
}

// IsValid checks if the status is valid
func (s ApprovalStatus) IsValid() bool {
	switch s {
	case ApprovalStatusLocalPending, ApprovalStatusLocalApproved, ApprovalStatusLocalDenied:
		return true
	default:
		return false
	}
}

// Approval represents a local approval request
type Approval struct {
	ID          string          `json:"id"`
	RunID       string          `json:"run_id"`
	SessionID   string          `json:"session_id"`
	Status      ApprovalStatus  `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	RespondedAt *time.Time      `json:"responded_at,omitempty"`
	ToolName    string          `json:"tool_name"`
	ToolInput   json.RawMessage `json:"tool_input"`
	Comment     string          `json:"comment,omitempty"`
}

// EventType constants
const (
	EventTypeMessage    = "message"
	EventTypeToolCall   = "tool_call"
	EventTypeToolResult = "tool_result"
	EventTypeSystem     = "system"
)

// ApprovalStatus constants
const (
	ApprovalStatusPending  = "pending"
	ApprovalStatusApproved = "approved"
	ApprovalStatusDenied   = "denied"
	ApprovalStatusResolved = "resolved" // Generic resolved status for external resolutions
)

// SessionStatus constants
const (
	SessionStatusStarting     = "starting"
	SessionStatusRunning      = "running"
	SessionStatusCompleted    = "completed"
	SessionStatusFailed       = "failed"
	SessionStatusWaitingInput = "waiting_input"
	SessionStatusCompleting   = "completing" // Session received interrupt signal and is shutting down
)

// Helper functions for converting between store types and Claude types

// NewSessionFromConfig creates a Session from Claude SessionConfig
func NewSessionFromConfig(id, runID string, config claudecode.SessionConfig) *Session {
	// Convert slices to JSON for storage
	allowedToolsJSON, _ := json.Marshal(config.AllowedTools)
	disallowedToolsJSON, _ := json.Marshal(config.DisallowedTools)

	return &Session{
		ID:                   id,
		RunID:                runID,
		Query:                config.Query,
		Model:                string(config.Model),
		WorkingDir:           config.WorkingDir,
		MaxTurns:             config.MaxTurns,
		SystemPrompt:         config.SystemPrompt,
		AppendSystemPrompt:   config.AppendSystemPrompt,
		CustomInstructions:   config.CustomInstructions,
		PermissionPromptTool: config.PermissionPromptTool,
		AllowedTools:         string(allowedToolsJSON),
		DisallowedTools:      string(disallowedToolsJSON),
		Status:               SessionStatusStarting,
		CreatedAt:            time.Now(),
		LastActivityAt:       time.Now(),
	}
}
