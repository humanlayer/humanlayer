package session

import (
	"context"
	"sync"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestQueryInjector_StorePendingQuery(t *testing.T) {
	pendingQueries := &sync.Map{}
	injector := NewQueryInjector(nil, pendingQueries)
	sessionID := "test-session"
	query := "Test query"

	t.Run("stores pending query", func(t *testing.T) {
		injector.StorePendingQuery(sessionID, query)

		// Verify query was stored
		storedValue, exists := pendingQueries.Load(sessionID)
		assert.True(t, exists)
		storedQuery, ok := storedValue.(string)
		assert.True(t, ok)
		assert.Equal(t, query, storedQuery)
	})

	t.Run("overwrites existing query", func(t *testing.T) {
		// Store first query
		injector.StorePendingQuery(sessionID, "First query")

		// Store second query
		newQuery := "Second query"
		injector.StorePendingQuery(sessionID, newQuery)

		// Verify second query overwrote first
		storedValue, exists := pendingQueries.Load(sessionID)
		assert.True(t, exists)
		storedQuery, ok := storedValue.(string)
		assert.True(t, ok)
		assert.Equal(t, newQuery, storedQuery)
	})
}

func TestQueryInjector_InjectPendingQuery(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	pendingQueries := &sync.Map{}
	injector := NewQueryInjector(mockStore, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"
	claudeSessionID := "claude-session-123"

	t.Run("injects pending query successfully", func(t *testing.T) {
		query := "Test query to inject"
		pendingQueries.Store(sessionID, query)

		// Mock GetConversation to return empty (no existing events)
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return([]*store.ConversationEvent{}, nil)

		// Expect query to be added as first event
		mockStore.EXPECT().AddConversationEvent(ctx, gomock.Any()).Do(func(_ context.Context, event *store.ConversationEvent) {
			assert.Equal(t, sessionID, event.SessionID)
			assert.Equal(t, claudeSessionID, event.ClaudeSessionID)
			assert.Equal(t, 1, event.Sequence)
			assert.Equal(t, store.EventTypeMessage, event.EventType)
			assert.Equal(t, "user", event.Role)
			assert.Equal(t, query, event.Content)
		}).Return(nil)

		err := injector.InjectPendingQuery(ctx, sessionID, claudeSessionID)
		assert.NoError(t, err)

		// Verify query was removed from pending
		_, exists := pendingQueries.Load(sessionID)
		assert.False(t, exists)
	})

	t.Run("skips injection if no pending query", func(t *testing.T) {
		// No pending query stored
		// No store expectations - should return early

		err := injector.InjectPendingQuery(ctx, sessionID, claudeSessionID)
		assert.NoError(t, err)
	})

	t.Run("skips injection if query already exists", func(t *testing.T) {
		query := "Test query"
		pendingQueries.Store(sessionID, query)

		// Mock GetConversation to return existing user message
		existingEvents := []*store.ConversationEvent{
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "Already injected query",
			},
		}
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return(existingEvents, nil)

		// No AddConversationEvent expectation - should skip injection

		err := injector.InjectPendingQuery(ctx, sessionID, claudeSessionID)
		assert.NoError(t, err)

		// Verify query was still removed from pending
		_, exists := pendingQueries.Load(sessionID)
		assert.False(t, exists)
	})

	t.Run("handles empty query", func(t *testing.T) {
		pendingQueries.Store(sessionID, "")

		// No store expectations - should return early on empty query

		err := injector.InjectPendingQuery(ctx, sessionID, claudeSessionID)
		assert.NoError(t, err)

		// Verify query was removed
		_, exists := pendingQueries.Load(sessionID)
		assert.False(t, exists)
	})

	t.Run("handles non-string value in map", func(t *testing.T) {
		// Store non-string value
		pendingQueries.Store(sessionID, 12345)

		// No store expectations - should return early

		err := injector.InjectPendingQuery(ctx, sessionID, claudeSessionID)
		assert.NoError(t, err)

		// Verify value was removed
		_, exists := pendingQueries.Load(sessionID)
		assert.False(t, exists)
	})
}

func TestQueryInjector_InjectQueryAsFirstEvent(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	pendingQueries := &sync.Map{}
	injector := NewQueryInjector(mockStore, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"
	claudeSessionID := "claude-session-123"
	query := "Test query content"

	t.Run("injects query as first event", func(t *testing.T) {
		// Mock GetConversation to return empty
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return([]*store.ConversationEvent{}, nil)

		// Expect event to be added
		mockStore.EXPECT().AddConversationEvent(ctx, gomock.Any()).Do(func(_ context.Context, event *store.ConversationEvent) {
			assert.Equal(t, sessionID, event.SessionID)
			assert.Equal(t, claudeSessionID, event.ClaudeSessionID)
			assert.Equal(t, 1, event.Sequence)
			assert.Equal(t, store.EventTypeMessage, event.EventType)
			assert.Equal(t, "user", event.Role)
			assert.Equal(t, query, event.Content)
			assert.NotZero(t, event.CreatedAt)
		}).Return(nil)

		err := injector.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
		assert.NoError(t, err)
	})

	t.Run("skips if user message already exists", func(t *testing.T) {
		// Mock GetConversation to return existing user message
		existingEvents := []*store.ConversationEvent{
			{
				Role:    "user",
				Content: "Existing query",
			},
		}
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return(existingEvents, nil)

		// No AddConversationEvent expectation

		err := injector.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
		assert.NoError(t, err)
	})

	t.Run("injects if first event is not user message", func(t *testing.T) {
		// Mock GetConversation to return assistant message first
		existingEvents := []*store.ConversationEvent{
			{
				Role:    "assistant",
				Content: "Assistant response",
			},
		}
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return(existingEvents, nil)

		// Expect event to be added
		mockStore.EXPECT().AddConversationEvent(ctx, gomock.Any()).Return(nil)

		err := injector.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
		assert.NoError(t, err)
	})

	t.Run("handles GetConversation error gracefully", func(t *testing.T) {
		// Mock GetConversation to return error
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return(nil, assert.AnError)

		// Still expect event to be added
		mockStore.EXPECT().AddConversationEvent(ctx, gomock.Any()).Return(nil)

		err := injector.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
		assert.NoError(t, err)
	})

	t.Run("returns error on AddConversationEvent failure", func(t *testing.T) {
		mockStore.EXPECT().GetConversation(ctx, claudeSessionID).Return([]*store.ConversationEvent{}, nil)
		mockStore.EXPECT().AddConversationEvent(ctx, gomock.Any()).Return(assert.AnError)

		err := injector.InjectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to inject query as first event")
	})
}

func TestQueryInjector_ClearPendingQuery(t *testing.T) {
	pendingQueries := &sync.Map{}
	injector := NewQueryInjector(nil, pendingQueries)
	sessionID := "test-session"

	t.Run("clears existing pending query", func(t *testing.T) {
		// Store a query
		pendingQueries.Store(sessionID, "Test query")

		// Verify it exists
		_, exists := pendingQueries.Load(sessionID)
		assert.True(t, exists)

		// Clear it
		injector.ClearPendingQuery(sessionID)

		// Verify it's gone
		_, exists = pendingQueries.Load(sessionID)
		assert.False(t, exists)
	})

	t.Run("handles clearing non-existent query", func(t *testing.T) {
		// Should not panic when query doesn't exist
		injector.ClearPendingQuery(sessionID)
	})
}
