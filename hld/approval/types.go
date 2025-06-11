package approval

import (
	"context"

	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// PendingApproval wraps either a function call or human contact
type PendingApproval struct {
	Type         string                   `json:"type"` // "function_call" or "human_contact"
	FunctionCall *humanlayer.FunctionCall `json:"function_call,omitempty"`
	HumanContact *humanlayer.HumanContact `json:"human_contact,omitempty"`
}

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

	// Recovery methods
	ReconcileApprovalsForSession(ctx context.Context, runID string) error
}

// Store manages approval storage and correlation
type Store interface {
	// Storage methods
	StoreFunctionCall(fc humanlayer.FunctionCall) error
	StoreHumanContact(hc humanlayer.HumanContact) error

	// Retrieval methods
	GetFunctionCall(callID string) (*humanlayer.FunctionCall, error)
	GetHumanContact(callID string) (*humanlayer.HumanContact, error)
	GetAllPending() ([]PendingApproval, error)
	GetPendingByRunID(runID string) ([]PendingApproval, error)
	GetAllCachedFunctionCalls() ([]humanlayer.FunctionCall, error)
	GetAllCachedHumanContacts() ([]humanlayer.HumanContact, error)

	// Update methods
	MarkFunctionCallResponded(callID string) error
	MarkHumanContactResponded(callID string) error
	RemoveFunctionCall(callID string) error
	RemoveHumanContact(callID string) error
}

// APIClient defines the interface for interacting with the HumanLayer API
type APIClient interface {
	GetPendingFunctionCalls(ctx context.Context) ([]humanlayer.FunctionCall, error)
	GetPendingHumanContacts(ctx context.Context) ([]humanlayer.HumanContact, error)
	ApproveFunctionCall(ctx context.Context, callID string, comment string) error
	DenyFunctionCall(ctx context.Context, callID string, reason string) error
	RespondToHumanContact(ctx context.Context, callID string, response string) error
}
