package session

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/store"
)

// QueryInjector handles injection of user queries into Claude sessions
type QueryInjector struct {
	store          store.ConversationStore
	pendingQueries *sync.Map
}

// NewQueryInjector creates a new query injector
func NewQueryInjector(store store.ConversationStore, pendingQueries *sync.Map) *QueryInjector {
	return &QueryInjector{
		store:          store,
		pendingQueries: pendingQueries,
	}
}

// StorePendingQuery stores a query for later injection
func (i *QueryInjector) StorePendingQuery(sessionID, query string) {
	i.pendingQueries.Store(sessionID, query)
}

// InjectPendingQuery injects a pending query when Claude session ID becomes available
func (i *QueryInjector) InjectPendingQuery(ctx context.Context, sessionID, claudeSessionID string) error {
	// Load and delete the pending query atomically
	queryVal, ok := i.pendingQueries.LoadAndDelete(sessionID)
	if !ok {
		return nil // No pending query
	}

	query, ok := queryVal.(string)
	if !ok || query == "" {
		return nil // Invalid or empty query
	}

	slog.Debug("injecting pending query",
		"session_id", sessionID,
		"claude_session_id", claudeSessionID,
		"query_length", len(query))

	return i.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
}

// InjectQueryAsFirstEvent adds the user's query as the first conversation event
func (i *QueryInjector) InjectQueryAsFirstEvent(ctx context.Context, sessionID, claudeSessionID, query string) error {
	// Check if we already have a user message as the first event (deduplication)
	events, err := i.store.GetConversation(ctx, claudeSessionID)
	if err == nil && len(events) > 0 && events[0].Role == "user" {
		slog.Debug("query already injected, skipping",
			"session_id", sessionID,
			"claude_session_id", claudeSessionID)
		return nil // Query already injected
	}

	event := &store.ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        1, // Start at 1, not 0 (matches existing pattern)
		EventType:       store.EventTypeMessage,
		CreatedAt:       time.Now(),
		Role:            "user",
		Content:         query,
	}

	if err := i.store.AddConversationEvent(ctx, event); err != nil {
		return fmt.Errorf("failed to inject query as first event: %w", err)
	}

	slog.Info("successfully injected query as first event",
		"session_id", sessionID,
		"claude_session_id", claudeSessionID,
		"query_length", len(query))

	return nil
}

// ClearPendingQuery removes a pending query without injecting it
func (i *QueryInjector) ClearPendingQuery(sessionID string) {
	i.pendingQueries.Delete(sessionID)
}
