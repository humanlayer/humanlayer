package approval

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// Config holds configuration for the approval manager
type Config struct {
	APIKey        string
	BaseURL       string
	PollInterval  time.Duration
	MaxBackoff    time.Duration
	BackoffFactor float64
}

// DefaultManager is the default implementation of Manager
type DefaultManager struct {
	Client            APIClient
	Store             Store
	Poller            *Poller
	EventBus          bus.EventBus
	ConversationStore store.ConversationStore
}

// NewManager creates a new approval manager
func NewManager(cfg Config, eventBus bus.EventBus, conversationStore store.ConversationStore) (Manager, error) {
	// Set defaults
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 5 * time.Second
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = 5 * time.Minute
	}
	if cfg.BackoffFactor <= 0 {
		cfg.BackoffFactor = 2.0
	}

	// Create HumanLayer client
	opts := []humanlayer.ClientOption{
		humanlayer.WithAPIKey(cfg.APIKey),
	}

	// Add base URL if provided
	if cfg.BaseURL != "" {
		opts = append(opts, humanlayer.WithBaseURL(cfg.BaseURL))
	}

	client, err := humanlayer.NewClient(opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create HumanLayer client: %w", err)
	}

	// Create in-memory store
	store := NewMemoryStore()

	// Create poller with configured interval
	poller := NewPoller(client, store, conversationStore, cfg.PollInterval, eventBus)
	poller.maxBackoff = cfg.MaxBackoff
	poller.backoffFactor = cfg.BackoffFactor

	return &DefaultManager{
		Client:            client,
		Store:             store,
		Poller:            poller,
		EventBus:          eventBus,
		ConversationStore: conversationStore,
	}, nil
}

// Start begins polling for approvals
func (m *DefaultManager) Start(ctx context.Context) error {
	return m.Poller.Start(ctx)
}

// Stop stops the approval manager
func (m *DefaultManager) Stop() {
	m.Poller.Stop()
}

// GetPendingApprovals returns all pending approvals, optionally filtered by session
func (m *DefaultManager) GetPendingApprovals(sessionID string) ([]PendingApproval, error) {
	if sessionID != "" && m.ConversationStore != nil {
		// Look up the session to get its run_id
		ctx := context.Background()
		session, err := m.ConversationStore.GetSession(ctx, sessionID)
		if err != nil {
			slog.Debug("session not found for approval filter", "session_id", sessionID, "error", err)
			return []PendingApproval{}, nil
		}
		// Get approvals by run_id
		return m.Store.GetPendingByRunID(session.RunID)
	}
	return m.Store.GetAllPending()
}

// GetPendingApprovalsByRunID returns pending approvals for a specific run_id
func (m *DefaultManager) GetPendingApprovalsByRunID(runID string) ([]PendingApproval, error) {
	return m.Store.GetPendingByRunID(runID)
}

// ErrAlreadyResponded is returned when an approval has already been responded to
var ErrAlreadyResponded = errors.New("this approval has already been responded to")

// handleConflictError checks if an error is a conflict and handles it appropriately
func (m *DefaultManager) handleConflictError(ctx context.Context, err error, callID string, approvalType string) error {
	var apiErr *humanlayer.APIError
	if errors.As(err, &apiErr) && apiErr.IsConflict() {
		slog.Info("approval already responded externally",
			"type", approvalType,
			"call_id", callID,
			"error", apiErr.Body)

		// Remove from local cache
		if approvalType == "function_call" {
			if err := m.Store.RemoveFunctionCall(callID); err != nil {
				slog.Error("failed to remove function call from cache", "call_id", callID, "error", err)
			}
		} else {
			if err := m.Store.RemoveHumanContact(callID); err != nil {
				slog.Error("failed to remove human contact from cache", "call_id", callID, "error", err)
			}
		}

		// Update database status if we have a conversation store
		if m.ConversationStore != nil {
			if err := m.ConversationStore.UpdateApprovalStatus(ctx, callID, store.ApprovalStatusResolved); err != nil {
				slog.Error("failed to update approval status in database", "error", err)
			}
		}

		// Return a specific error to indicate it was already responded
		return ErrAlreadyResponded
	}
	return err
}

// ApproveFunctionCall approves a function call
func (m *DefaultManager) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	// First check if we have this function call
	fc, err := m.Store.GetFunctionCall(callID)
	if err != nil {
		return fmt.Errorf("function call not found: %w", err)
	}

	// Send approval to API
	if err := m.Client.ApproveFunctionCall(ctx, callID, comment); err != nil {
		// Handle conflict error specially
		conflictErr := m.handleConflictError(ctx, err, callID, "function_call")
		if errors.Is(conflictErr, ErrAlreadyResponded) {
			// Return the already responded error directly
			return conflictErr
		}
		if conflictErr != nil {
			return fmt.Errorf("failed to approve function call: %w", conflictErr)
		}
	}

	// Mark as responded in local store
	if err := m.Store.MarkFunctionCallResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	// Update approval status in database if we have a conversation store
	if m.ConversationStore != nil && fc != nil {
		if err := m.ConversationStore.UpdateApprovalStatus(ctx, callID, store.ApprovalStatusApproved); err != nil {
			slog.Error("failed to update approval status in database", "error", err)
			// Don't fail the whole operation for this
		}

		// Update session status back to running since approval is resolved
		if fc.RunID != "" {
			// Look up the session by run_id
			session, err := m.ConversationStore.GetSessionByRunID(ctx, fc.RunID)
			if err == nil && session != nil && session.Status == store.SessionStatusWaitingInput {
				runningStatus := store.SessionStatusRunning
				update := store.SessionUpdate{
					Status: &runningStatus,
				}
				if err := m.ConversationStore.UpdateSession(ctx, session.ID, update); err != nil {
					slog.Error("failed to update session status to running",
						"session_id", session.ID,
						"error", err)
				} else {
					slog.Info("updated session status back to running after approval",
						"session_id", session.ID,
						"approval_id", callID)

					// Publish session status change event
					if m.EventBus != nil {
						m.EventBus.Publish(bus.Event{
							Type: bus.EventSessionStatusChanged,
                                                          // TODO(4): Can this be a static type later on? Why isn't it currently? Is this because of JSON RPC or a go thing?
							Data: map[string]interface{}{
								"session_id": session.ID,
								"run_id":     fc.RunID,
								"old_status": string(store.SessionStatusWaitingInput),
								"new_status": string(store.SessionStatusRunning),
							},
						})
					}
				}
			}
		}
	}

	// Publish event
	if m.EventBus != nil && fc != nil {
		m.EventBus.Publish(bus.Event{
			Type: bus.EventApprovalResolved,
			Data: map[string]interface{}{
				"type":     "function_call",
				"call_id":  callID,
				"run_id":   fc.RunID,
				"decision": "approved",
				"comment":  comment,
			},
		})
	}

	return nil
}

// DenyFunctionCall denies a function call
func (m *DefaultManager) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	// First check if we have this function call
	fc, err := m.Store.GetFunctionCall(callID)
	if err != nil {
		return fmt.Errorf("function call not found: %w", err)
	}

	// Send denial to API
	if err := m.Client.DenyFunctionCall(ctx, callID, reason); err != nil {
		// Handle conflict error specially
		conflictErr := m.handleConflictError(ctx, err, callID, "function_call")
		if errors.Is(conflictErr, ErrAlreadyResponded) {
			// Return the already responded error directly
			return conflictErr
		}
		if conflictErr != nil {
			return fmt.Errorf("failed to deny function call: %w", conflictErr)
		}
	}

	// Mark as responded in local store
	if err := m.Store.MarkFunctionCallResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	// Update approval status in database if we have a conversation store
	if m.ConversationStore != nil && fc != nil {
		if err := m.ConversationStore.UpdateApprovalStatus(ctx, callID, store.ApprovalStatusDenied); err != nil {
			slog.Error("failed to update approval status in database", "error", err)
			// Don't fail the whole operation for this
		}

		// Update session status back to running since approval is resolved (denied)
		if fc.RunID != "" {
			// Look up the session by run_id
			session, err := m.ConversationStore.GetSessionByRunID(ctx, fc.RunID)
			if err == nil && session != nil && session.Status == store.SessionStatusWaitingInput {
				runningStatus := store.SessionStatusRunning
				update := store.SessionUpdate{
					Status: &runningStatus,
				}
				if err := m.ConversationStore.UpdateSession(ctx, session.ID, update); err != nil {
					slog.Error("failed to update session status to running",
						"session_id", session.ID,
						"error", err)
				} else {
					slog.Info("updated session status back to running after denial",
						"session_id", session.ID,
						"approval_id", callID)

					// Publish session status change event
					if m.EventBus != nil {
						m.EventBus.Publish(bus.Event{
							Type: bus.EventSessionStatusChanged,
							Data: map[string]interface{}{
								"session_id": session.ID,
								"run_id":     fc.RunID,
								"old_status": string(store.SessionStatusWaitingInput),
								"new_status": string(store.SessionStatusRunning),
							},
						})
					}
				}
			}
		}
	}

	// Publish event
	if m.EventBus != nil && fc != nil {
		m.EventBus.Publish(bus.Event{
			Type: bus.EventApprovalResolved,
			Data: map[string]interface{}{
				"type":     "function_call",
				"call_id":  callID,
				"run_id":   fc.RunID,
				"decision": "denied",
				"reason":   reason,
			},
		})
	}

	return nil
}

// RespondToHumanContact sends a response to a human contact request
func (m *DefaultManager) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	// First check if we have this human contact
	hc, err := m.Store.GetHumanContact(callID)
	if err != nil {
		return fmt.Errorf("human contact not found: %w", err)
	}

	// Send response to API
	if err := m.Client.RespondToHumanContact(ctx, callID, response); err != nil {
		// Handle conflict error specially
		conflictErr := m.handleConflictError(ctx, err, callID, "human_contact")
		if errors.Is(conflictErr, ErrAlreadyResponded) {
			// Return the already responded error directly
			return conflictErr
		}
		if conflictErr != nil {
			return fmt.Errorf("failed to respond to human contact: %w", conflictErr)
		}
	}

	// Mark as responded in local store
	if err := m.Store.MarkHumanContactResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	// Publish event
	if m.EventBus != nil && hc != nil {
		m.EventBus.Publish(bus.Event{
			Type: bus.EventApprovalResolved,
			Data: map[string]interface{}{
				"type":     "human_contact",
				"call_id":  callID,
				"run_id":   hc.RunID,
				"decision": "responded",
				"response": response,
			},
		})
	}

	return nil
}

// ReconcileApprovalsForSession reconciles approvals for a session after restart
func (m *DefaultManager) ReconcileApprovalsForSession(ctx context.Context, runID string) error {
	if m.Poller == nil {
		return nil // No poller configured
	}
	return m.Poller.ReconcileApprovalsForSession(ctx, runID)
}
