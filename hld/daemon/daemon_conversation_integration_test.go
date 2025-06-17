//go:build integration
// +build integration

package daemon

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetConversationIntegration tests fetching conversation data through the daemon
func TestGetConversationIntegration(t *testing.T) {
	socketPath := testutil.SocketPath(t, "conversation")

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", ":memory:") // Use in-memory database for tests
	defer func() {
		os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
		os.Unsetenv("HUMANLAYER_DATABASE_PATH")
	}()

	// Create and start daemon
	daemon, err := New()
	require.NoError(t, err, "Failed to create daemon")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	errCh := make(chan error, 1)
	go func() {
		errCh <- daemon.Run(ctx)
	}()

	// Wait for daemon to be ready
	deadline := time.Now().Add(5 * time.Second)
	var daemonClient client.Client
	for time.Now().Before(deadline) {
		daemonClient, err = client.New(socketPath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	require.NoError(t, err, "Failed to connect to daemon")
	defer daemonClient.Close()

	// Verify daemon is healthy
	err = daemonClient.Health()
	require.NoError(t, err, "Daemon health check failed")

	t.Run("GetConversation with mock data", func(t *testing.T) {
		// Since we can't easily launch a real Claude session in tests,
		// we'll directly insert test data into the store
		ctx := context.Background()

		// Create test session
		sessionID := "test-session-1"
		claudeSessionID := "claude-test-1"

		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-1",
			ClaudeSessionID: claudeSessionID,
			Query:           "Test query",
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		err := daemon.store.CreateSession(ctx, session)
		require.NoError(t, err)

		// Add conversation events
		events := []*store.ConversationEvent{
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "Hello Claude!",
			},
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            "assistant",
				Content:         "Hello! How can I help you today?",
			},
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeToolCall,
				ToolID:          "tool-1",
				ToolName:        "calculator",
				ToolInputJSON:   `{"operation": "add", "a": 5, "b": 3}`,
			},
		}

		for _, event := range events {
			err := daemon.store.AddConversationEvent(ctx, event)
			require.NoError(t, err)
		}

		// Test GetConversation by session ID
		resp, err := daemonClient.GetConversation(sessionID)
		require.NoError(t, err)
		assert.Len(t, resp.Events, 3)
		assert.Equal(t, "user", resp.Events[0].Role)
		assert.Equal(t, "Hello Claude!", resp.Events[0].Content)
		assert.Equal(t, "assistant", resp.Events[1].Role)
		assert.Equal(t, "calculator", resp.Events[2].ToolName)

		// Test GetConversation by Claude session ID
		resp2, err := daemonClient.GetConversationByClaudeSessionID(claudeSessionID)
		require.NoError(t, err)
		assert.Equal(t, resp.Events, resp2.Events)
	})

	t.Run("GetSessionState", func(t *testing.T) {
		// Create a completed session
		sessionID := "test-session-2"
		now := time.Now()
		completedAt := now.Add(5 * time.Minute)
		costUSD := 0.02
		totalTokens := 500
		durationMS := 300000

		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-2",
			ClaudeSessionID: "claude-test-2",
			Query:           "Write a poem",
			Model:           "claude-3-sonnet",
			Status:          store.SessionStatusRunning,
			CreatedAt:       now,
			LastActivityAt:  now,
		}

		err := daemon.store.CreateSession(context.Background(), session)
		require.NoError(t, err)

		// Update the session with completion data (mimicking what happens in real usage)
		statusCompleted := store.SessionStatusCompleted
		update := store.SessionUpdate{
			Status:         &statusCompleted,
			LastActivityAt: &completedAt,
			CompletedAt:    &completedAt,
			CostUSD:        &costUSD,
			TotalTokens:    &totalTokens,
			DurationMS:     &durationMS,
		}
		err = daemon.store.UpdateSession(context.Background(), sessionID, update)
		require.NoError(t, err)

		// Verify the session was stored correctly by reading it back directly
		storedSession, err := daemon.store.GetSession(context.Background(), sessionID)
		require.NoError(t, err)
		require.NotNil(t, storedSession.CostUSD, "CostUSD should not be nil")
		require.NotNil(t, storedSession.TotalTokens, "TotalTokens should not be nil")
		require.NotNil(t, storedSession.CompletedAt, "CompletedAt should not be nil")
		t.Logf("Stored session - CostUSD: %v, TotalTokens: %v",
			*storedSession.CostUSD, *storedSession.TotalTokens)

		// Get session state via RPC
		resp, err := daemonClient.GetSessionState(sessionID)
		require.NoError(t, err)
		assert.Equal(t, sessionID, resp.Session.ID)
		assert.Equal(t, "test-run-2", resp.Session.RunID)
		assert.Equal(t, "claude-test-2", resp.Session.ClaudeSessionID)
		assert.Equal(t, store.SessionStatusCompleted, resp.Session.Status)
		assert.Equal(t, "Write a poem", resp.Session.Query)
		assert.Equal(t, "claude-3-sonnet", resp.Session.Model)

		// Check optional fields
		assert.InDelta(t, 0.02, resp.Session.CostUSD, 0.001)
		assert.Equal(t, 500, resp.Session.TotalTokens)
		assert.Equal(t, 300000, resp.Session.DurationMS)
		assert.NotEmpty(t, resp.Session.CompletedAt)
	})

	t.Run("GetConversation for nonexistent session", func(t *testing.T) {
		// When a session doesn't exist, GetSessionConversation returns an error
		// because it needs to look up the claude_session_id first
		_, err := daemonClient.GetConversation("nonexistent-session")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get conversation")
	})

	t.Run("GetSessionState for nonexistent session", func(t *testing.T) {
		_, err := daemonClient.GetSessionState("nonexistent-session")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get session")
	})

	// Test with approval correlation
	t.Run("GetConversation with approval", func(t *testing.T) {
		sessionID := "test-session-3"
		claudeSessionID := "claude-test-3"

		// Create session
		session := &store.Session{
			ID:              sessionID,
			RunID:           "test-run-3",
			ClaudeSessionID: claudeSessionID,
			Query:           "Delete important file",
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		err := daemon.store.CreateSession(context.Background(), session)
		require.NoError(t, err)

		// Add tool call with approval
		event := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-2",
			ToolName:        "file_delete",
			ToolInputJSON:   `{"path": "/important/file.txt"}`,
			ApprovalStatus:  store.ApprovalStatusPending,
			ApprovalID:      "approval-123",
		}
		err = daemon.store.AddConversationEvent(context.Background(), event)
		require.NoError(t, err)

		// Get conversation
		resp, err := daemonClient.GetConversation(sessionID)
		require.NoError(t, err)
		assert.Len(t, resp.Events, 1)
		assert.Equal(t, "file_delete", resp.Events[0].ToolName)
		assert.Equal(t, store.ApprovalStatusPending, resp.Events[0].ApprovalStatus)
		assert.Equal(t, "approval-123", resp.Events[0].ApprovalID)
	})

	// Shutdown daemon
	cancel()

	// Wait for daemon to exit
	select {
	case err := <-errCh:
		assert.NoError(t, err, "Daemon exited with error")
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not exit in time")
	}
}

// TestConversationRealtime tests real-time updates to conversations
func TestConversationRealtime(t *testing.T) {
	socketPath := testutil.SocketPath(t, "realtime")

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", ":memory:")
	defer func() {
		os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
		os.Unsetenv("HUMANLAYER_DATABASE_PATH")
	}()

	// Create and start daemon
	daemon, err := New()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon
	go daemon.Run(ctx)

	// Wait for daemon to be ready
	deadline := time.Now().Add(5 * time.Second)
	var daemonClient client.Client
	for time.Now().Before(deadline) {
		daemonClient, err = client.New(socketPath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	require.NoError(t, err)
	defer daemonClient.Close()

	// Create a session
	sessionID := "realtime-session"
	claudeSessionID := "claude-realtime"

	session := &store.Session{
		ID:              sessionID,
		RunID:           "realtime-run",
		ClaudeSessionID: claudeSessionID,
		Query:           "Realtime test",
		Status:          store.SessionStatusRunning,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = daemon.store.CreateSession(context.Background(), session)
	require.NoError(t, err)

	// Initially empty
	resp, err := daemonClient.GetConversation(sessionID)
	require.NoError(t, err)
	assert.Len(t, resp.Events, 0)

	// Add first event
	event1 := &store.ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		EventType:       store.EventTypeMessage,
		Role:            "user",
		Content:         "First message",
	}
	err = daemon.store.AddConversationEvent(context.Background(), event1)
	require.NoError(t, err)

	// Check conversation has one event
	resp, err = daemonClient.GetConversation(sessionID)
	require.NoError(t, err)
	assert.Len(t, resp.Events, 1)
	assert.Equal(t, "First message", resp.Events[0].Content)

	// Add more events
	event2 := &store.ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		EventType:       store.EventTypeMessage,
		Role:            "assistant",
		Content:         "Response message",
	}
	err = daemon.store.AddConversationEvent(context.Background(), event2)
	require.NoError(t, err)

	// Check conversation has two events
	resp, err = daemonClient.GetConversation(sessionID)
	require.NoError(t, err)
	assert.Len(t, resp.Events, 2)
	assert.Equal(t, "Response message", resp.Events[1].Content)
}
