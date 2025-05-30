package approval

import (
	"context"
)

// Manager defines the interface for managing approvals
type Manager interface {
	// Lifecycle methods
	Start(ctx context.Context) error
	Stop()

	// Retrieval methods
	GetPendingApprovals(sessionID string) ([]PendingApproval, error)
	GetPendingApprovalsByRunID(runID string) ([]PendingApproval, error)

	// Decision methods
	ApproveFunctionCall(ctx context.Context, callID string, comment string) error
	DenyFunctionCall(ctx context.Context, callID string, reason string) error
	RespondToHumanContact(ctx context.Context, callID string, response string) error
}
