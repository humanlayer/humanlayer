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

	// Create approval with tool_use_id (Phase 4)
	CreateApprovalWithToolUseID(ctx context.Context, sessionID, toolName string, toolInput json.RawMessage, toolUseID string) (*store.Approval, error)

	// Retrieval methods
	GetPendingApprovals(ctx context.Context, sessionID string) ([]*store.Approval, error)
	GetApproval(ctx context.Context, id string) (*store.Approval, error)

	// Decision methods
	ApproveToolCall(ctx context.Context, id string, comment string) error
	DenyToolCall(ctx context.Context, id string, reason string) error
}
