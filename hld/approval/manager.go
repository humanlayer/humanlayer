package approval

import (
	"context"
	"fmt"
	"time"

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
	Client APIClient
	Store  Store
	Poller *Poller
}

// NewManager creates a new approval manager
func NewManager(cfg Config) (Manager, error) {
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
	poller := NewPoller(client, store, cfg.PollInterval)
	poller.maxBackoff = cfg.MaxBackoff
	poller.backoffFactor = cfg.BackoffFactor

	return &DefaultManager{
		Client: client,
		Store:  store,
		Poller: poller,
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
	if sessionID != "" {
		// In the future, we'll need to look up the run_id for this session
		// For now, return empty since we don't have session->run_id mapping yet
		return []PendingApproval{}, nil
	}
	return m.Store.GetAllPending()
}

// GetPendingApprovalsByRunID returns pending approvals for a specific run_id
func (m *DefaultManager) GetPendingApprovalsByRunID(runID string) ([]PendingApproval, error) {
	return m.Store.GetPendingByRunID(runID)
}

// ApproveFunctionCall approves a function call
func (m *DefaultManager) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	// First check if we have this function call
	_, err := m.Store.GetFunctionCall(callID)
	if err != nil {
		return fmt.Errorf("function call not found: %w", err)
	}

	// Send approval to API
	if err := m.Client.ApproveFunctionCall(ctx, callID, comment); err != nil {
		return fmt.Errorf("failed to approve function call: %w", err)
	}

	// Mark as responded in local store
	if err := m.Store.MarkFunctionCallResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	return nil
}

// DenyFunctionCall denies a function call
func (m *DefaultManager) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	// First check if we have this function call
	_, err := m.Store.GetFunctionCall(callID)
	if err != nil {
		return fmt.Errorf("function call not found: %w", err)
	}

	// Send denial to API
	if err := m.Client.DenyFunctionCall(ctx, callID, reason); err != nil {
		return fmt.Errorf("failed to deny function call: %w", err)
	}

	// Mark as responded in local store
	if err := m.Store.MarkFunctionCallResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	return nil
}

// RespondToHumanContact sends a response to a human contact request
func (m *DefaultManager) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	// First check if we have this human contact
	_, err := m.Store.GetHumanContact(callID)
	if err != nil {
		return fmt.Errorf("human contact not found: %w", err)
	}

	// Send response to API
	if err := m.Client.RespondToHumanContact(ctx, callID, response); err != nil {
		return fmt.Errorf("failed to respond to human contact: %w", err)
	}

	// Mark as responded in local store
	if err := m.Store.MarkHumanContactResponded(callID); err != nil {
		return fmt.Errorf("failed to update local state: %w", err)
	}

	return nil
}
