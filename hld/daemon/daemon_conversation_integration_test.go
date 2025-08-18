//go:build integration

package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetConversationIntegration tests fetching conversation data through the daemon
func TestGetConversationIntegration(t *testing.T) {
	// Create test database path
	dbPath := testutil.DatabasePath(t, "conversation")
	httpPort := getFreePort(t)

	// Set environment variables for daemon config
	oldDBPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	oldHTTPPort := os.Getenv("HUMANLAYER_DAEMON_HTTP_PORT")
	oldHTTPHost := os.Getenv("HUMANLAYER_DAEMON_HTTP_HOST")

	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	defer func() {
		if oldDBPath != "" {
			os.Setenv("HUMANLAYER_DATABASE_PATH", oldDBPath)
		} else {
			os.Unsetenv("HUMANLAYER_DATABASE_PATH")
		}
		if oldHTTPPort != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", oldHTTPPort)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
		}
		if oldHTTPHost != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", oldHTTPHost)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
		}
	}()

	// Create daemon using New() which properly initializes everything
	daemon, err := New()
	require.NoError(t, err, "Failed to create daemon")

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- daemon.Run(ctx)
	}()

	// Wait for HTTP server to start
	baseURL := fmt.Sprintf("http://127.0.0.1:%d/api/v1", httpPort)
	var httpReady bool
	for i := 0; i < 50; i++ { // 5 seconds timeout
		resp, err := http.Get(fmt.Sprintf("%s/health", baseURL))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				httpReady = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	require.True(t, httpReady, "HTTP server failed to start")

	// Create HTTP client
	client := &http.Client{}

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
		resp, err := client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, 200, resp.StatusCode)

		var messagesResp api.ConversationResponse
		err = json.NewDecoder(resp.Body).Decode(&messagesResp)
		require.NoError(t, err)
		assert.Len(t, messagesResp.Data, 3)
		assert.Equal(t, api.ConversationEventRole("user"), *messagesResp.Data[0].Role)
		assert.Equal(t, "Hello Claude!", *messagesResp.Data[0].Content)
		assert.Equal(t, api.ConversationEventRole("assistant"), *messagesResp.Data[1].Role)
		assert.Equal(t, "calculator", *messagesResp.Data[2].ToolName)

		// Note: GetConversationByClaudeSessionID is not available in REST API
		// The REST API only supports getting messages by session ID
	})

	t.Run("GetSessionState", func(t *testing.T) {
		// Create a completed session
		sessionID := "test-session-2"
		now := time.Now()
		completedAt := now.Add(5 * time.Minute)
		costUSD := 0.02
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
			DurationMS:     &durationMS,
		}
		err = daemon.store.UpdateSession(context.Background(), sessionID, update)
		require.NoError(t, err)

		// Verify the session was stored correctly by reading it back directly
		storedSession, err := daemon.store.GetSession(context.Background(), sessionID)
		require.NoError(t, err)
		require.NotNil(t, storedSession.CostUSD, "CostUSD should not be nil")
		require.NotNil(t, storedSession.CompletedAt, "CompletedAt should not be nil")
		t.Logf("Stored session - CostUSD: %v",
			*storedSession.CostUSD)

		// Get session state via REST API
		resp, err := client.Get(fmt.Sprintf("%s/sessions/%s", baseURL, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, 200, resp.StatusCode)

		var sessionResp api.SessionResponse
		err = json.NewDecoder(resp.Body).Decode(&sessionResp)
		require.NoError(t, err)
		assert.Equal(t, sessionID, sessionResp.Data.Id)
		assert.Equal(t, "test-run-2", sessionResp.Data.RunId)
		assert.Equal(t, "claude-test-2", *sessionResp.Data.ClaudeSessionId)
		assert.Equal(t, api.SessionStatus("completed"), sessionResp.Data.Status)
		assert.Equal(t, "Write a poem", sessionResp.Data.Query)
		assert.Equal(t, "claude-3-sonnet", *sessionResp.Data.Model)

		// Check optional fields
		assert.NotNil(t, sessionResp.Data.CostUsd)
		assert.InDelta(t, 0.02, *sessionResp.Data.CostUsd, 0.001)
		assert.NotNil(t, sessionResp.Data.DurationMs)
		assert.Equal(t, 300000, *sessionResp.Data.DurationMs)
		assert.NotNil(t, sessionResp.Data.CompletedAt)
	})

	t.Run("GetConversation for nonexistent session", func(t *testing.T) {
		// When a session doesn't exist, the REST API returns 500 (due to current implementation)
		resp, err := client.Get(fmt.Sprintf("%s/sessions/nonexistent-session/messages", baseURL))
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, 500, resp.StatusCode)
	})

	t.Run("GetSessionState for nonexistent session", func(t *testing.T) {
		resp, err := client.Get(fmt.Sprintf("%s/sessions/nonexistent-session", baseURL))
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, 500, resp.StatusCode)
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
		resp, err := client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, sessionID))
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, 200, resp.StatusCode)

		var messagesResp api.ConversationResponse
		err = json.NewDecoder(resp.Body).Decode(&messagesResp)
		require.NoError(t, err)
		assert.Len(t, messagesResp.Data, 1)
		assert.Equal(t, "file_delete", *messagesResp.Data[0].ToolName)
		assert.Equal(t, api.ConversationEventApprovalStatus("pending"), *messagesResp.Data[0].ApprovalStatus)
		assert.Equal(t, "approval-123", *messagesResp.Data[0].ApprovalId)
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
	// Create test database path
	dbPath := testutil.DatabasePath(t, "realtime")
	httpPort := getFreePort(t)

	// Set environment variables for daemon config
	oldDBPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	oldHTTPPort := os.Getenv("HUMANLAYER_DAEMON_HTTP_PORT")
	oldHTTPHost := os.Getenv("HUMANLAYER_DAEMON_HTTP_HOST")

	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	defer func() {
		if oldDBPath != "" {
			os.Setenv("HUMANLAYER_DATABASE_PATH", oldDBPath)
		} else {
			os.Unsetenv("HUMANLAYER_DATABASE_PATH")
		}
		if oldHTTPPort != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", oldHTTPPort)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
		}
		if oldHTTPHost != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", oldHTTPHost)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
		}
	}()

	// Create daemon using New() which properly initializes everything
	daemon, err := New()
	require.NoError(t, err)

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- daemon.Run(ctx)
	}()

	// Wait for HTTP server to start
	baseURL := fmt.Sprintf("http://127.0.0.1:%d/api/v1", httpPort)
	var httpReady bool
	for i := 0; i < 50; i++ { // 5 seconds timeout
		resp, err := http.Get(fmt.Sprintf("%s/health", baseURL))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				httpReady = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	require.True(t, httpReady, "HTTP server failed to start")

	// Create HTTP client
	client := &http.Client{}

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
	resp, err := client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, sessionID))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, 200, resp.StatusCode)

	var messagesResp api.ConversationResponse
	err = json.NewDecoder(resp.Body).Decode(&messagesResp)
	require.NoError(t, err)
	assert.Len(t, messagesResp.Data, 0)

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
	resp, err = client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, sessionID))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, 200, resp.StatusCode)

	err = json.NewDecoder(resp.Body).Decode(&messagesResp)
	require.NoError(t, err)
	assert.Len(t, messagesResp.Data, 1)
	assert.Equal(t, "First message", *messagesResp.Data[0].Content)

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
	resp, err = client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, sessionID))
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, 200, resp.StatusCode)

	err = json.NewDecoder(resp.Body).Decode(&messagesResp)
	require.NoError(t, err)
	assert.Len(t, messagesResp.Data, 2)
	assert.Equal(t, "Response message", *messagesResp.Data[1].Content)

	// Shutdown daemon
	cancel()

	// Wait for daemon to exit
	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled {
			t.Errorf("daemon error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon shutdown timeout")
	}
}
