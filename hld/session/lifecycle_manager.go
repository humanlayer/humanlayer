package session

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// LifecycleManager manages session state transitions and lifecycle events
type LifecycleManager struct {
	store             store.ConversationStore
	eventBus          bus.EventBus
	activeProcesses   map[string]*claudecode.Session
	activeProcessesMu *sync.RWMutex
	pendingQueries    *sync.Map
}

// NewLifecycleManager creates a new lifecycle manager
func NewLifecycleManager(
	store store.ConversationStore,
	eventBus bus.EventBus,
	activeProcesses map[string]*claudecode.Session,
	activeProcessesMu *sync.RWMutex,
	pendingQueries *sync.Map,
) *LifecycleManager {
	return &LifecycleManager{
		store:             store,
		eventBus:          eventBus,
		activeProcesses:   activeProcesses,
		activeProcessesMu: activeProcessesMu,
		pendingQueries:    pendingQueries,
	}
}

// TransitionToRunning transitions a session to running state
func (m *LifecycleManager) TransitionToRunning(ctx context.Context, sessionID, runID string) error {
	statusRunning := string(StatusRunning)
	now := time.Now()
	update := store.SessionUpdate{
		Status:         &statusRunning,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		return fmt.Errorf("failed to update session status to running: %w", err)
	}

	// Publish status change event
	if m.eventBus != nil {
		event := bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"run_id":     runID,
				"old_status": string(StatusStarting),
				"new_status": string(StatusRunning),
			},
		}
		slog.Info("publishing session status changed event",
			"session_id", sessionID,
			"run_id", runID,
			"event_type", event.Type,
			"event_data", event.Data,
		)
		m.eventBus.Publish(event)
	}

	return nil
}

// UpdateSessionStatus updates the status of a session with optional error message
func (m *LifecycleManager) UpdateSessionStatus(ctx context.Context, sessionID string, status Status, errorMsg string) error {
	// Update database
	dbStatus := string(status)
	update := store.SessionUpdate{
		Status: &dbStatus,
	}
	if errorMsg != "" {
		update.ErrorMessage = &errorMsg
	}
	if status == StatusCompleted || status == StatusFailed {
		now := time.Now()
		update.CompletedAt = &now

		// Clean up active process if exists
		m.activeProcessesMu.Lock()
		delete(m.activeProcesses, sessionID)
		m.activeProcessesMu.Unlock()

		// Clean up any pending queries
		m.pendingQueries.Delete(sessionID)
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		return fmt.Errorf("failed to update session status in database: %w", err)
	}

	// Note: We can't publish status change events without knowing the old status
	// This would require a database read. For now, we'll skip the event.
	return nil
}

// CompleteSession handles session completion with result
func (m *LifecycleManager) CompleteSession(ctx context.Context, sessionID, runID string, result *claudecode.Result, startTime time.Time) error {
	endTime := time.Now()

	// Check current session state first
	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	oldStatus := session.Status

	// Update database with completion status
	statusCompleted := string(StatusCompleted)
	duration := int(endTime.Sub(startTime).Milliseconds())
	update := store.SessionUpdate{
		Status:      &statusCompleted,
		CompletedAt: &endTime,
		DurationMS:  &duration,
	}
	if result != nil {
		if result.CostUSD > 0 {
			update.CostUSD = &result.CostUSD
		}
		if result.NumTurns > 0 {
			update.NumTurns = &result.NumTurns
		}
		if result.Result != "" {
			update.ResultContent = &result.Result
		}
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		return fmt.Errorf("failed to update session completion in database: %w", err)
	}

	// Publish status change event
	if m.eventBus != nil {
		event := bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"run_id":     runID,
				"old_status": oldStatus,
				"new_status": string(StatusCompleted),
			},
		}
		slog.Info("publishing session completion event",
			"session_id", sessionID,
			"run_id", runID,
			"event_type", event.Type,
			"event_data", event.Data,
		)
		m.eventBus.Publish(event)
	}

	slog.Info("session completed",
		"session_id", sessionID,
		"status", StatusCompleted,
		"duration", endTime.Sub(startTime))

	// Clean up resources
	m.CleanupSession(sessionID)

	return nil
}

// HandleSessionError handles session failure
func (m *LifecycleManager) HandleSessionError(ctx context.Context, sessionID string, err error) error {
	// Check if this was an intentional interrupt
	session, dbErr := m.store.GetSession(ctx, sessionID)
	if dbErr == nil && session != nil && session.Status == string(StatusCompleting) {
		// This was an interrupted session, not a failure
		// Let it transition to completed naturally
		slog.Debug("session was interrupted, not marking as failed",
			"session_id", sessionID,
			"status", session.Status)
		return nil
	}

	return m.UpdateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
}

// HandleSessionResultError handles session completion with error result
func (m *LifecycleManager) HandleSessionResultError(ctx context.Context, sessionID string, result *claudecode.Result) error {
	return m.UpdateSessionStatus(ctx, sessionID, StatusFailed, result.Error)
}

// TransitionToCompleting transitions a session to completing state (interrupted)
func (m *LifecycleManager) TransitionToCompleting(ctx context.Context, sessionID string) error {
	// Get current session state for the event
	session, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	oldStatus := session.Status

	// Update database to show session is completing after interrupt
	status := string(StatusCompleting)
	errorMsg := "Session interrupt requested, shutting down gracefully"
	now := time.Now()
	update := store.SessionUpdate{
		Status:         &status,
		ErrorMessage:   &errorMsg,
		CompletedAt:    &now,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		return fmt.Errorf("failed to update session status after interrupt: %w", err)
	}

	// Publish status change event
	if m.eventBus != nil {
		m.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"old_status": oldStatus,
				"new_status": string(StatusCompleting),
			},
		})
	}

	return nil
}

// CleanupSession cleans up resources for a session
func (m *LifecycleManager) CleanupSession(sessionID string) {
	// Clean up active process
	m.activeProcessesMu.Lock()
	delete(m.activeProcesses, sessionID)
	m.activeProcessesMu.Unlock()

	// Clean up any pending queries that weren't injected
	m.pendingQueries.Delete(sessionID)
}
