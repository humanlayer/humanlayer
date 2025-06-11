package approval

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// Poller polls the HumanLayer API for pending approvals
type Poller struct {
	client            APIClient
	store             Store
	conversationStore store.ConversationStore
	eventBus          bus.EventBus
	interval          time.Duration
	maxBackoff        time.Duration
	backoffFactor     float64
	mu                sync.Mutex
	cancel            context.CancelFunc
	failureCount      int
}

// NewPoller creates a new approval poller
func NewPoller(client APIClient, store Store, conversationStore store.ConversationStore, interval time.Duration, eventBus bus.EventBus) *Poller {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &Poller{
		client:            client,
		store:             store,
		conversationStore: conversationStore,
		eventBus:          eventBus,
		interval:          interval,
		maxBackoff:        5 * time.Minute,
		backoffFactor:     2.0,
		failureCount:      0,
	}
}

// Start begins polling for approvals
func (p *Poller) Start(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancel != nil {
		return fmt.Errorf("poller already started")
	}

	ctx, cancel := context.WithCancel(ctx)
	p.cancel = cancel

	go p.pollLoop(ctx)
	slog.Info("approval poller started", "interval", p.interval)
	return nil
}

// Stop stops the polling loop
func (p *Poller) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
		slog.Info("approval poller stopped")
	}
}

// IsRunning returns true if the poller is currently running
func (p *Poller) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.cancel != nil
}

// pollLoop continuously polls for approvals
func (p *Poller) pollLoop(ctx context.Context) {
	// Poll immediately on start
	p.poll(ctx)

	for {
		// Calculate next poll interval based on failure count
		interval := p.calculateInterval()

		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			p.poll(ctx)
		}
	}
}

// calculateInterval returns the next polling interval with exponential backoff
func (p *Poller) calculateInterval() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.failureCount == 0 {
		return p.interval
	}

	// Calculate backoff: interval * (backoffFactor ^ failureCount)
	backoff := float64(p.interval)
	for i := 0; i < p.failureCount; i++ {
		backoff *= p.backoffFactor
		if time.Duration(backoff) > p.maxBackoff {
			return p.maxBackoff
		}
	}

	return time.Duration(backoff)
}

// poll fetches and stores pending approvals
func (p *Poller) poll(ctx context.Context) {
	// Create a timeout context for this poll
	pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var hadError bool

	// Fetch function calls
	functionCalls, err := p.client.GetPendingFunctionCalls(pollCtx)
	if err != nil {
		slog.Error("failed to fetch function calls", "error", err)
		hadError = true
	} else {
		newCount := 0
		for _, fc := range functionCalls {
			// Check if this is a new approval
			if existing, err := p.store.GetFunctionCall(fc.CallID); err != nil || existing == nil {
				newCount++
			}

			if err := p.store.StoreFunctionCall(fc); err != nil {
				slog.Error("failed to store function call", "call_id", fc.CallID, "error", err)
			}

			// Correlate with tool calls in the database
			if p.conversationStore != nil && fc.RunID != "" {
				p.correlateApproval(pollCtx, fc)
			}
		}
		slog.Debug("fetched function calls", "count", len(functionCalls), "new", newCount)

		// Publish event if we have new approvals
		if newCount > 0 && p.eventBus != nil {
			p.eventBus.Publish(bus.Event{
				Type: bus.EventNewApproval,
				Data: map[string]interface{}{
					"type":  "function_call",
					"count": newCount,
					"total": len(functionCalls),
				},
			})
		}
	}

	// Fetch human contacts
	humanContacts, err := p.client.GetPendingHumanContacts(pollCtx)
	if err != nil {
		slog.Error("failed to fetch human contacts", "error", err)
		hadError = true
	} else {
		newCount := 0
		for _, hc := range humanContacts {
			// Check if this is a new approval
			if existing, err := p.store.GetHumanContact(hc.CallID); err != nil || existing == nil {
				newCount++
			}

			if err := p.store.StoreHumanContact(hc); err != nil {
				slog.Error("failed to store human contact", "call_id", hc.CallID, "error", err)
			}
		}
		slog.Debug("fetched human contacts", "count", len(humanContacts), "new", newCount)

		// Publish event if we have new approvals
		if newCount > 0 && p.eventBus != nil {
			p.eventBus.Publish(bus.Event{
				Type: bus.EventNewApproval,
				Data: map[string]interface{}{
					"type":  "human_contact",
					"count": newCount,
					"total": len(humanContacts),
				},
			})
		}
	}

	// Update failure count based on results
	p.updateFailureCount(hadError)
}

// updateFailureCount updates the failure count for backoff calculation
func (p *Poller) updateFailureCount(hadError bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if hadError {
		p.failureCount++
		nextInterval := p.calculateIntervalLocked()
		slog.Warn("poll failed, backing off",
			"failure_count", p.failureCount,
			"next_interval", nextInterval)
	} else {
		if p.failureCount > 0 {
			slog.Info("poll succeeded, resetting backoff")
			p.failureCount = 0
		}
	}
}

// calculateIntervalLocked returns the next interval (must be called with lock held)
func (p *Poller) calculateIntervalLocked() time.Duration {
	if p.failureCount == 0 {
		return p.interval
	}

	// Calculate backoff: interval * (backoffFactor ^ failureCount)
	backoff := float64(p.interval)
	for i := 0; i < p.failureCount; i++ {
		backoff *= p.backoffFactor
		if time.Duration(backoff) > p.maxBackoff {
			return p.maxBackoff
		}
	}

	return time.Duration(backoff)
}

// correlateApproval attempts to match an approval with a pending tool call
func (p *Poller) correlateApproval(ctx context.Context, fc humanlayer.FunctionCall) {
	// Find the session with this run_id
	session, err := p.conversationStore.GetSessionByRunID(ctx, fc.RunID)
	if err != nil {
		slog.Error("failed to get session for correlation",
			"run_id", fc.RunID,
			"error", err)
		return
	}

	if session == nil {
		// This is expected for approvals that aren't from our Claude sessions
		slog.Debug("no matching session for approval",
			"run_id", fc.RunID,
			"approval_id", fc.CallID)
		return
	}

	toolName := fc.Spec.Fn
	// Try to find an uncorrelated pending tool call for this session and tool
	// Use the specialized method that only finds tool calls without approvals
	var toolCall *store.ConversationEvent
	
	// Check if the store has the GetUncorrelatedPendingToolCall method
	if uncorrelatedStore, ok := p.conversationStore.(*store.SQLiteStore); ok {
		toolCall, err = uncorrelatedStore.GetUncorrelatedPendingToolCall(ctx, session.ID, toolName)
	} else {
		// Fallback to regular GetPendingToolCall
		toolCall, err = p.conversationStore.GetPendingToolCall(ctx, session.ID, toolName)
	}
	
	if err != nil || toolCall == nil {
		slog.Debug("no matching pending tool call for approval",
			"session_id", session.ID,
			"run_id", fc.RunID,
			"tool_name", toolName,
			"approval_id", fc.CallID)
		return
	}

	// Found a matching tool call in one of our sessions - correlate it
	if err := p.conversationStore.CorrelateApproval(ctx, session.ID, toolName, fc.CallID); err != nil {
		slog.Error("failed to correlate approval with tool call",
			"approval_id", fc.CallID,
			"session_id", session.ID,
			"tool_name", toolName,
			"error", err)
		return
	}

	slog.Info("correlated approval with tool call",
		"approval_id", fc.CallID,
		"session_id", session.ID,
		"tool_name", toolName,
		"run_id", fc.RunID)

	// Publish event to notify that approval has been correlated
	if p.eventBus != nil {
		p.eventBus.Publish(bus.Event{
			Type: bus.EventApprovalResolved,
			Data: map[string]interface{}{
				"approval_id": fc.CallID,
				"session_id":  session.ID,
				"tool_name":   toolName,
				"run_id":      fc.RunID,
				"status":      "correlated",
			},
		})
	}

	// Update session status to waiting_input
	waitingStatus := store.SessionStatusWaitingInput
	update := store.SessionUpdate{
		Status: &waitingStatus,
	}
	if err := p.conversationStore.UpdateSession(ctx, session.ID, update); err != nil {
		slog.Error("failed to update session status to waiting_input",
			"session_id", session.ID,
			"error", err)
	}
}
