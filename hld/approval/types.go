package approval

import (
	"context"
	"encoding/json"

	"github.com/humanlayer/humanlayer/hld/store"
)

// Manager defines the interface for managing local approvals
type Manager interface {
	// Create a new approval
	CreateApproval(ctx context.Context, runID, toolName string, toolInput json.RawMessage) (string, error)

	// Retrieval methods
	GetPendingApprovals(ctx context.Context, sessionID string) ([]*store.Approval, error)

	// Decision methods
	ApproveToolCall(ctx context.Context, id string, comment string) error
	DenyToolCall(ctx context.Context, id string, reason string) error
}
