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

const (
	maxCorrelationRetries = 3
	correlationRetryDelay = 50 * time.Millisecond
)

// manager manages approvals locally without HumanLayer API
type manager struct {
	store           store.ConversationStore
	eventBus        bus.EventBus
	eventSub        *bus.Subscriber
	correlationChan chan correlationRequest
}

type correlationRequest struct {
	sessionID string
	toolName  string
	toolID    string
}

// NewManager creates a new local approval manager
func NewManager(store store.ConversationStore, eventBus bus.EventBus) Manager {
	m := &manager{
		store:           store,
		eventBus:        eventBus,
		correlationChan: make(chan correlationRequest, 100),
	}
	
	if eventBus != nil {
		ctx := context.Background()
		m.eventSub = eventBus.Subscribe(ctx, bus.EventFilter{
			Types: []bus.EventType{bus.EventToolCallStored},
		})
		go m.processCorrelationEvents()
	}
	
	return m
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
		return "", fmt.Errorf("failed to store approval: %w", err)
	}

	// Try to correlate with the most recent uncorrelated tool call
	if err := m.correlateApproval(ctx, approval); err != nil {
		// Log but don't fail - correlation is best effort
		slog.Warn("failed to correlate approval with tool call",
			"error", err,
			"approval_id", approval.ID,
			"session_id", approval.SessionID,
			"tool_name", approval.ToolName,
			"retries", maxCorrelationRetries)
	} else {
		slog.Debug("successfully correlated approval",
			"approval_id", approval.ID,
			"session_id", approval.SessionID,
			"tool_name", approval.ToolName)
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
		"run_id", runID,
		"tool_name", toolName,
		"tool_input", string(toolInput),
		"status", status,
		"auto_accepted", status == store.ApprovalStatusLocalApproved)

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

// GetApproval retrieves a specific approval by ID
func (m *manager) GetApproval(ctx context.Context, id string) (*store.Approval, error) {
	approval, err := m.store.GetApproval(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get approval: %w", err)
	}
	return approval, nil
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
	var lastErr error
	delay := correlationRetryDelay
	
	for i := 0; i <= maxCorrelationRetries; i++ {
		// Find the most recent uncorrelated pending tool call
		toolCall, err := m.store.GetUncorrelatedPendingToolCall(ctx, approval.SessionID, approval.ToolName)
		if err != nil {
			return fmt.Errorf("failed to find pending tool call: %w", err)
		}
		
		if toolCall != nil {
			// Correlate by tool ID
			if err := m.store.CorrelateApprovalByToolID(ctx, approval.SessionID, toolCall.ToolID, approval.ID); err != nil {
				return fmt.Errorf("failed to correlate approval: %w", err)
			}
			return nil // Success
		}
		
		lastErr = fmt.Errorf("no matching tool call found")
		
		// Don't sleep on the last iteration
		if i < maxCorrelationRetries {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
				delay *= 2 // Exponential backoff
			}
		}
	}
	
	return lastErr
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

// processCorrelationEvents processes tool call stored events and attempts correlation
func (m *manager) processCorrelationEvents() {
	if m.eventSub == nil {
		return
	}
	
	for event := range m.eventSub.Channel {
		if event.Type == bus.EventToolCallStored {
			sessionID, _ := event.Data["session_id"].(string)
			toolName, _ := event.Data["tool_name"].(string)
			toolID, _ := event.Data["tool_id"].(string)
			
			select {
			case m.correlationChan <- correlationRequest{
				sessionID: sessionID,
				toolName:  toolName,
				toolID:    toolID,
			}:
				// Request queued
			default:
				slog.Warn("correlation channel full, dropping event")
			}
			
			// Immediately attempt correlation for this event
			go m.attemptPendingCorrelations(context.Background(), correlationRequest{
				sessionID: sessionID,
				toolName:  toolName,
				toolID:    toolID,
			})
		}
	}
}

// attemptPendingCorrelations attempts to correlate pending approvals with a tool call
func (m *manager) attemptPendingCorrelations(ctx context.Context, req correlationRequest) {
	// Find any uncorrelated approvals for this tool
	approvals, err := m.store.GetPendingApprovals(ctx, req.sessionID)
	if err != nil {
		slog.Error("failed to get pending approvals", "error", err)
		return
	}
	
	for _, approval := range approvals {
		// Check if this approval matches the tool call
		// We attempt correlation for all matching approvals - the store will handle
		// checking if it's already correlated
		if approval.ToolName == req.toolName {
			if err := m.store.CorrelateApprovalByToolID(ctx, req.sessionID, req.toolID, approval.ID); err != nil {
				// This is expected if the approval is already correlated
				slog.Debug("correlation attempt via event", 
					"error", err,
					"approval_id", approval.ID,
					"tool_id", req.toolID)
			} else {
				slog.Info("correlated approval via event",
					"approval_id", approval.ID,
					"tool_id", req.toolID,
					"session_id", req.sessionID,
					"tool_name", req.toolName)
			}
		}
	}
}
