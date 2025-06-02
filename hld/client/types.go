package client

import (
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// Client defines the interface for communicating with the HumanLayer daemon
type Client interface {
	// Health checks if the daemon is healthy
	Health() error

	// LaunchSession launches a new Claude Code session
	LaunchSession(req rpc.LaunchSessionRequest) (*rpc.LaunchSessionResponse, error)

	// ListSessions lists all active sessions
	ListSessions() (*rpc.ListSessionsResponse, error)

	// FetchApprovals fetches pending approvals from the daemon
	FetchApprovals(sessionID string) ([]approval.PendingApproval, error)

	// SendDecision sends a decision (approve/deny/respond) for an approval
	SendDecision(callID, approvalType, decision, comment string) error

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
