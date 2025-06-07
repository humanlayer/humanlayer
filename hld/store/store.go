package store

import (
	"context"
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
	MarkToolCallCompleted(ctx context.Context, toolID string, sessionID string) error
	CorrelateApproval(ctx context.Context, sessionID string, toolName string, approvalID string) error
	UpdateApprovalStatus(ctx context.Context, approvalID string, status string) error

	// MCP server operations
	StoreMCPServers(ctx context.Context, sessionID string, servers []MCPServer) error
	GetMCPServers(ctx context.Context, sessionID string) ([]MCPServer, error)

	// Raw event storage (for debugging)
	StoreRawEvent(ctx context.Context, sessionID string, eventJSON string) error

	// Database lifecycle
	Close() error
}

// Session represents a Claude Code session
type Session struct {
	ID                 string
	RunID              string
	ClaudeSessionID    string
	ParentSessionID    string
	Query              string
	Model              string
	WorkingDir         string
	MaxTurns           int
	SystemPrompt       string
	CustomInstructions string
	Status             string
	CreatedAt          time.Time
	LastActivityAt     time.Time
	CompletedAt        *time.Time
	CostUSD            *float64
	TotalTokens        *int
	DurationMS         *int
	ErrorMessage       string
}

// SessionUpdate contains fields that can be updated
type SessionUpdate struct {
	ClaudeSessionID *string
	Status          *string
	LastActivityAt  *time.Time
	CompletedAt     *time.Time
	CostUSD         *float64
	TotalTokens     *int
	DurationMS      *int
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
	ToolID        string
	ToolName      string
	ToolInputJSON string

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
)

// SessionStatus constants
const (
	SessionStatusStarting     = "starting"
	SessionStatusRunning      = "running"
	SessionStatusCompleted    = "completed"
	SessionStatusFailed       = "failed"
	SessionStatusWaitingInput = "waiting_input"
)

// Helper functions for converting between store types and Claude types

// NewSessionFromConfig creates a Session from Claude SessionConfig
func NewSessionFromConfig(id, runID string, config claudecode.SessionConfig) *Session {
	return &Session{
		ID:                 id,
		RunID:              runID,
		Query:              config.Query,
		Model:              string(config.Model),
		WorkingDir:         config.WorkingDir,
		MaxTurns:           config.MaxTurns,
		SystemPrompt:       config.SystemPrompt,
		CustomInstructions: config.CustomInstructions,
		Status:             SessionStatusStarting,
		CreatedAt:          time.Now(),
		LastActivityAt:     time.Now(),
	}
}
