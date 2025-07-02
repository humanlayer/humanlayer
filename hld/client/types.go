package client

import (
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/store"
)

// Client defines the interface for communicating with the HumanLayer daemon
type Client interface {
	// Health checks if the daemon is healthy
	Health() error

	// LaunchSession launches a new Claude Code session
	LaunchSession(req rpc.LaunchSessionRequest) (*rpc.LaunchSessionResponse, error)

	// ListSessions lists all active sessions
	ListSessions() (*rpc.ListSessionsResponse, error)

	// GetSessionLeaves gets only the leaf sessions (sessions with no children)
	GetSessionLeaves() (*rpc.GetSessionLeavesResponse, error)

	// InterruptSession interrupts a running session
	InterruptSession(sessionID string) error

	// ContinueSession continues an existing completed session with a new query
	ContinueSession(req rpc.ContinueSessionRequest) (*rpc.ContinueSessionResponse, error)

	// FetchApprovals fetches pending approvals from the daemon
	FetchApprovals(sessionID string) ([]*store.Approval, error)

	// SendDecision sends a decision (approve/deny) for an approval
	SendDecision(approvalID, decision, comment string) error

	// Type-safe approval methods
	ApproveToolCall(approvalID, comment string) error
	DenyToolCall(approvalID, reason string) error

	// GetConversation fetches the conversation history for a session
	GetConversation(sessionID string) (*rpc.GetConversationResponse, error)

	// GetConversationByClaudeSessionID fetches the conversation history by Claude session ID
	GetConversationByClaudeSessionID(claudeSessionID string) (*rpc.GetConversationResponse, error)

	// GetSessionState fetches the current state of a session
	GetSessionState(sessionID string) (*rpc.GetSessionStateResponse, error)

	// Subscribe subscribes to events from the daemon
	Subscribe(req rpc.SubscribeRequest) (<-chan rpc.EventNotification, error)

	// Close closes the connection to the daemon
	Close() error
}

// Factory creates new daemon clients
type Factory interface {
	// NewClient creates a new client connected to the daemon
	NewClient(socketPath string) (Client, error)

	// Connect attempts to connect with retries
	Connect(socketPath string, maxRetries int, retryDelay time.Duration) (Client, error)
}
