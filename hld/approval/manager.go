package approval

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/humanlayer/humanlayer/hld/bus"
	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
	"github.com/humanlayer/humanlayer/hld/store"
)

// manager manages approvals locally without HumanLayer API
type manager struct {
	store    store.ConversationStore
	eventBus bus.EventBus
}

// NewManager creates a new local approval manager
func NewManager(store store.ConversationStore, eventBus bus.EventBus) Manager {
	return &manager{
		store:    store,
		eventBus: eventBus,
	}
}

// CreateApproval creates a new local approval
func (m *manager) CreateApproval(ctx context.Context, runID, toolName string, toolInput json.RawMessage) (string, error) {
	// Look up session by run_id
	session, err := m.store.GetSessionByRunID(ctx, runID)
	if err != nil {
		return "", hlderrors.NewSessionError("get_session_by_run_id", "", err)
	}
	if session == nil {
		return "", hlderrors.NewSessionError("get_session_by_run_id", "", hlderrors.ErrSessionNotFound)
	}

	// Check if this is an edit tool and auto-accept is enabled
	status := store.ApprovalStatusLocalPending
	comment := ""
	if session.AutoAcceptEdits && isEditTool(toolName) {
		status = store.ApprovalStatusLocalApproved
		comment = "Auto-accepted (auto-accept mode enabled)"
	}

	// Create approval
	approval := &store.Approval{
		ID:        "local-" + uuid.New().String(),
		RunID:     runID,
		SessionID: session.ID,
		Status:    status,
		CreatedAt: time.Now(),
		ToolName:  toolName,
		ToolInput: toolInput,
		Comment:   comment,
	}

	// Store it
	if err := m.store.CreateApproval(ctx, approval); err != nil {
		return "", hlderrors.NewApprovalError("create_approval", approval.ID, err)
	}

	// Try to correlate with the most recent uncorrelated tool call
	if err := m.correlateApproval(ctx, approval); err != nil {
		// Log but don't fail - correlation is best effort
		slog.Warn("failed to correlate approval with tool call",
			"error", err,
			"approval_id", approval.ID,
			"session_id", session.ID)
	}

	// Publish event for real-time updates
	m.publishNewApprovalEvent(approval)

	// Handle status-specific post-creation tasks
	switch status {
	case store.ApprovalStatusLocalPending:
		// Update session status to waiting_input for pending approvals
		if err := m.updateSessionStatus(ctx, session.ID, store.SessionStatusWaitingInput); err != nil {
			slog.Warn("failed to update session status",
				"error", err,
				"session_id", session.ID)
		}
	case store.ApprovalStatusLocalApproved:
		// For auto-approved, update correlation status immediately
		if err := m.store.UpdateApprovalStatus(ctx, approval.ID, store.ApprovalStatusApproved); err != nil {
			slog.Warn("failed to update approval status in conversation events",
				"error", err,
				"approval_id", approval.ID)
		}
		// Publish resolved event for auto-approved
		m.publishApprovalResolvedEvent(approval, true, comment)
	}

	logLevel := slog.LevelInfo
	if status == store.ApprovalStatusLocalApproved {
		logLevel = slog.LevelDebug // Less noise for auto-approved
	}
	slog.Log(ctx, logLevel, "created local approval",
		"approval_id", approval.ID,
		"session_id", session.ID,
		"tool_name", toolName,
		"status", status,
		"auto_accepted", status == store.ApprovalStatusLocalApproved)

	return approval.ID, nil
}

// GetPendingApprovals retrieves pending approvals for a session
func (m *manager) GetPendingApprovals(ctx context.Context, sessionID string) ([]*store.Approval, error) {
	approvals, err := m.store.GetPendingApprovals(ctx, sessionID)
	if err != nil {
		return nil, hlderrors.NewSessionError("get_pending_approvals", sessionID, err)
	}
	return approvals, nil
}

// GetApproval retrieves a specific approval by ID
func (m *manager) GetApproval(ctx context.Context, id string) (*store.Approval, error) {
	approval, err := m.store.GetApproval(ctx, id)
	if err != nil {
		return nil, hlderrors.NewApprovalError("get_approval", id, err)
	}
	if approval == nil {
		return nil, hlderrors.NewApprovalError("get_approval", id, hlderrors.ErrApprovalNotFound)
	}
	return approval, nil
}

// ApproveToolCall approves a tool call
func (m *manager) ApproveToolCall(ctx context.Context, id string, comment string) error {
	// Get the approval first
	approval, err := m.store.GetApproval(ctx, id)
	if err != nil {
		return hlderrors.NewApprovalError("approve_tool_call", id, err)
	}
	if approval == nil {
		return hlderrors.NewApprovalError("approve_tool_call", id, hlderrors.ErrApprovalNotFound)
	}

	// Check if already resolved
	if approval.Status == store.ApprovalStatusLocalApproved || approval.Status == store.ApprovalStatusLocalDenied {
		return hlderrors.NewApprovalError("approve_tool_call", id, hlderrors.ErrApprovalAlreadyResolved)
	}

	// Update approval status
	if err := m.store.UpdateApprovalResponse(ctx, id, store.ApprovalStatusLocalApproved, comment); err != nil {
		return hlderrors.NewApprovalError("update_approval_response", id, err)
	}

	// Update correlation status in conversation events
	if err := m.store.UpdateApprovalStatus(ctx, id, store.ApprovalStatusApproved); err != nil {
		slog.Warn("failed to update approval status in conversation events",
			"error", err,
			"approval_id", id)
	}

	// Publish event
	m.publishApprovalResolvedEvent(approval, true, comment)

	// Update session status back to running
	if err := m.updateSessionStatus(ctx, approval.SessionID, store.SessionStatusRunning); err != nil {
		slog.Warn("failed to update session status",
			"error", err,
			"session_id", approval.SessionID)
	}

	slog.Info("approved tool call",
		"approval_id", id,
		"comment", comment)

	return nil
}

// DenyToolCall denies a tool call
func (m *manager) DenyToolCall(ctx context.Context, id string, reason string) error {
	// Get the approval first
	approval, err := m.store.GetApproval(ctx, id)
	if err != nil {
		return hlderrors.NewApprovalError("deny_tool_call", id, err)
	}
	if approval == nil {
		return hlderrors.NewApprovalError("deny_tool_call", id, hlderrors.ErrApprovalNotFound)
	}

	// Check if already resolved
	if approval.Status == store.ApprovalStatusLocalApproved || approval.Status == store.ApprovalStatusLocalDenied {
		return hlderrors.NewApprovalError("deny_tool_call", id, hlderrors.ErrApprovalAlreadyResolved)
	}

	// Update approval status
	if err := m.store.UpdateApprovalResponse(ctx, id, store.ApprovalStatusLocalDenied, reason); err != nil {
		return hlderrors.NewApprovalError("update_approval_response", id, err)
	}

	// Update correlation status in conversation events
	if err := m.store.UpdateApprovalStatus(ctx, id, store.ApprovalStatusDenied); err != nil {
		slog.Warn("failed to update approval status in conversation events",
			"error", err,
			"approval_id", id)
	}

	// Publish event
	m.publishApprovalResolvedEvent(approval, false, reason)

	// Update session status back to running
	if err := m.updateSessionStatus(ctx, approval.SessionID, store.SessionStatusRunning); err != nil {
		slog.Warn("failed to update session status",
			"error", err,
			"session_id", approval.SessionID)
	}

	slog.Info("denied tool call",
		"approval_id", id,
		"reason", reason)

	return nil
}

// correlateApproval tries to correlate an approval with a tool call
func (m *manager) correlateApproval(ctx context.Context, approval *store.Approval) error {
	// Find the most recent uncorrelated pending tool call
	toolCall, err := m.store.GetUncorrelatedPendingToolCall(ctx, approval.SessionID, approval.ToolName)
	if err != nil {
		return hlderrors.NewApprovalError("get_uncorrelated_tool_call", approval.ID, err)
	}
	if toolCall == nil {
		return hlderrors.NewApprovalError("correlate_approval", approval.ID, hlderrors.ErrNoMatchingToolCall)
	}

	// Correlate by tool ID
	if err := m.store.CorrelateApprovalByToolID(ctx, approval.SessionID, toolCall.ToolID, approval.ID); err != nil {
		return hlderrors.NewApprovalError("correlate_by_tool_id", approval.ID, err)
	}

	return nil
}

// publishNewApprovalEvent publishes an event when a new approval is created
func (m *manager) publishNewApprovalEvent(approval *store.Approval) {
	if m.eventBus != nil {
		event := bus.Event{
			Type:      bus.EventNewApproval,
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"approval_id": approval.ID,
				"session_id":  approval.SessionID,
				"tool_name":   approval.ToolName,
			},
		}
		m.eventBus.Publish(event)
	}
}

// publishApprovalResolvedEvent publishes an event when an approval is resolved
func (m *manager) publishApprovalResolvedEvent(approval *store.Approval, approved bool, responseText string) {
	if m.eventBus != nil {
		event := bus.Event{
			Type:      bus.EventApprovalResolved,
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"approval_id":   approval.ID,
				"session_id":    approval.SessionID,
				"approved":      approved,
				"response_text": responseText,
			},
		}
		m.eventBus.Publish(event)
	}
}

// updateSessionStatus updates the session status
func (m *manager) updateSessionStatus(ctx context.Context, sessionID, status string) error {
	updates := store.SessionUpdate{
		Status:         &status,
		LastActivityAt: &[]time.Time{time.Now()}[0],
	}
	return m.store.UpdateSession(ctx, sessionID, updates)
}

// isEditTool checks if a tool name is one of the edit tools
func isEditTool(toolName string) bool {
	return toolName == "Edit" || toolName == "Write" || toolName == "MultiEdit"
}
