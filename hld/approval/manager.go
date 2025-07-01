package approval

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/humanlayer/humanlayer/hld/bus"
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
		return "", fmt.Errorf("failed to get session by run_id: %w", err)
	}
	if session == nil {
		return "", fmt.Errorf("session not found for run_id: %s", runID)
	}

	// Create approval
	approval := &store.Approval{
		ID:        "local-" + uuid.New().String(),
		RunID:     runID,
		SessionID: session.ID,
		Status:    store.ApprovalStatusLocalPending,
		CreatedAt: time.Now(),
		ToolName:  toolName,
		ToolInput: toolInput,
	}

	// Store it
	if err := m.store.CreateApproval(ctx, approval); err != nil {
		return "", fmt.Errorf("failed to store approval: %w", err)
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

	// Update session status to waiting_input
	if err := m.updateSessionStatus(ctx, session.ID, store.SessionStatusWaitingInput); err != nil {
		slog.Warn("failed to update session status",
			"error", err,
			"session_id", session.ID)
	}

	slog.Info("created local approval",
		"approval_id", approval.ID,
		"session_id", session.ID,
		"tool_name", toolName)

	return approval.ID, nil
}

// GetPendingApprovals retrieves pending approvals for a session
func (m *manager) GetPendingApprovals(ctx context.Context, sessionID string) ([]*store.Approval, error) {
	approvals, err := m.store.GetPendingApprovals(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pending approvals: %w", err)
	}
	return approvals, nil
}

// ApproveToolCall approves a tool call
func (m *manager) ApproveToolCall(ctx context.Context, id string, comment string) error {
	// Get the approval first
	approval, err := m.store.GetApproval(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get approval: %w", err)
	}

	// Update approval status
	if err := m.store.UpdateApprovalResponse(ctx, id, store.ApprovalStatusLocalApproved, comment); err != nil {
		return fmt.Errorf("failed to update approval: %w", err)
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
		return fmt.Errorf("failed to get approval: %w", err)
	}

	// Update approval status
	if err := m.store.UpdateApprovalResponse(ctx, id, store.ApprovalStatusLocalDenied, reason); err != nil {
		return fmt.Errorf("failed to update approval: %w", err)
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
		return fmt.Errorf("failed to find pending tool call: %w", err)
	}
	if toolCall == nil {
		return fmt.Errorf("no matching tool call found")
	}

	// Correlate by tool ID
	if err := m.store.CorrelateApprovalByToolID(ctx, approval.SessionID, toolCall.ToolID, approval.ID); err != nil {
		return fmt.Errorf("failed to correlate approval: %w", err)
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
