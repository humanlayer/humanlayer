package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

func TestSQLiteStore(t *testing.T) {
	// Create temp database
	tmpDir, err := os.MkdirTemp("", "hld-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()
	claudeSessionID := "claude-123" // Used across multiple tests

	t.Run("CreateAndGetSession", func(t *testing.T) {
		// Create a session
		session := &Session{
			ID:               "test-session-1",
			RunID:            "test-run-1",
			Query:            "Test query",
			Model:            "sonnet",
			Status:           SessionStatusStarting,
			CreatedAt:        time.Now(),
			LastActivityAt:   time.Now(),
		}

		err := store.CreateSession(ctx, session)
		require.NoError(t, err)

		// Get the session back
		retrieved, err := store.GetSession(ctx, session.ID)
		require.NoError(t, err)
		require.Equal(t, session.ID, retrieved.ID)
		require.Equal(t, session.RunID, retrieved.RunID)
		require.Equal(t, session.Query, retrieved.Query)
		require.Equal(t, session.Model, retrieved.Model)
		require.Equal(t, session.Status, retrieved.Status)
	})

	t.Run("UpdateSession", func(t *testing.T) {
		sessionID := "test-session-1"
		status := SessionStatusRunning

		update := SessionUpdate{
			ClaudeSessionID: &claudeSessionID,
			Status:          &status,
		}

		err := store.UpdateSession(ctx, sessionID, update)
		require.NoError(t, err)

		// Verify update
		retrieved, err := store.GetSession(ctx, sessionID)
		require.NoError(t, err)
		require.Equal(t, claudeSessionID, retrieved.ClaudeSessionID)
		require.Equal(t, SessionStatusRunning, retrieved.Status)
	})

	t.Run("ConversationEvents", func(t *testing.T) {
		// Add various events
		events := []*ConversationEvent{
			{
				SessionID:       "test-session-1",
				ClaudeSessionID: claudeSessionID,
				EventType:       EventTypeSystem,
				Role:            "system",
				Content:         "Session started",
			},
			{
				SessionID:       "test-session-1",
				ClaudeSessionID: claudeSessionID,
				EventType:       EventTypeMessage,
				Role:            "assistant",
				Content:         "Hello! How can I help you?",
			},
			{
				SessionID:       "test-session-1",
				ClaudeSessionID: claudeSessionID,
				EventType:       EventTypeToolCall,
				ToolID:          "tool-1",
				ToolName:        "calculate",
				ToolInputJSON:   `{"expression": "2+2"}`,
				// ApprovalStatus is NULL initially, will be set to 'pending' when approval comes in
			},
			{
				SessionID:         "test-session-1",
				ClaudeSessionID:   claudeSessionID,
				EventType:         EventTypeToolResult,
				Role:              "user",
				ToolResultForID:   "tool-1",
				ToolResultContent: "4",
			},
		}

		for _, event := range events {
			err := store.AddConversationEvent(ctx, event)
			require.NoError(t, err)
		}

		// Get conversation
		retrieved, err := store.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)
		require.Len(t, retrieved, 4)

		// Verify sequence numbers
		for i, event := range retrieved {
			require.Equal(t, i+1, event.Sequence)
		}

		// Verify content
		require.Equal(t, "Session started", retrieved[0].Content)
		require.Equal(t, "Hello! How can I help you?", retrieved[1].Content)
		require.Equal(t, "calculate", retrieved[2].ToolName)
		require.Equal(t, "4", retrieved[3].ToolResultContent)
	})

	t.Run("MCPServers", func(t *testing.T) {
		sessionID := "test-session-1"

		// Create MCP servers from config
		mcpConfig := map[string]claudecode.MCPServer{
			"test-server": {
				Command: "node",
				Args:    []string{"server.js"},
				Env:     map[string]string{"TEST": "value"},
			},
		}

		servers, err := MCPServersFromConfig(sessionID, mcpConfig)
		require.NoError(t, err)
		require.Len(t, servers, 1)

		// Store them
		err = store.StoreMCPServers(ctx, sessionID, servers)
		require.NoError(t, err)

		// Retrieve them
		retrieved, err := store.GetMCPServers(ctx, sessionID)
		require.NoError(t, err)
		require.Len(t, retrieved, 1)
		require.Equal(t, "test-server", retrieved[0].Name)
		require.Equal(t, "node", retrieved[0].Command)
	})

	t.Run("PendingToolCalls", func(t *testing.T) {
		// Check that we can find pending (uncompleted) tool calls
		pendingTool, err := store.GetPendingToolCall(ctx, "test-session-1", "calculate")
		require.NoError(t, err)
		require.NotNil(t, pendingTool)
		require.Equal(t, "calculate", pendingTool.ToolName)
		require.False(t, pendingTool.IsCompleted)
		require.Equal(t, "", pendingTool.ApprovalStatus) // Not correlated yet
	})

	t.Run("CorrelateApproval", func(t *testing.T) {
		// First, let's verify the tool call exists
		conv, err := store.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		// Find the calculate tool call
		var foundToolCall bool
		for _, event := range conv {
			if event.EventType == EventTypeToolCall && event.ToolName == "calculate" {
				foundToolCall = true
				t.Logf("Found tool call: ID=%d, SessionID=%s, EventType=%s, ToolName=%s, ApprovalStatus='%s', ApprovalID='%s'",
					event.ID, event.SessionID, event.EventType, event.ToolName, event.ApprovalStatus, event.ApprovalID)
			}
		}
		require.True(t, foundToolCall, "calculate tool call should exist")

		// Correlate an approval with the calculate tool call
		err = store.CorrelateApproval(ctx, "test-session-1", "calculate", "approval-123")
		require.NoError(t, err)

		// Check if the correlation worked by looking at the conversation again
		conv2, err := store.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		for _, event := range conv2 {
			if event.EventType == EventTypeToolCall && event.ToolName == "calculate" {
				t.Logf("After correlation: ID=%d, ApprovalStatus=%s, ApprovalID=%s",
					event.ID, event.ApprovalStatus, event.ApprovalID)
			}
		}

		// Check the conversation shows the pending approval
		conv3, err := store.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		var pendingCount int
		for _, event := range conv3 {
			if event.ApprovalStatus == ApprovalStatusPending {
				pendingCount++
				t.Logf("Pending approval found in conversation: ToolName=%s, ApprovalID=%s",
					event.ToolName, event.ApprovalID)
			}
		}
		require.Equal(t, 1, pendingCount, "Should have 1 pending approval in conversation")

		// Verify the tool call is now marked as pending approval
		updatedTool, err := store.GetPendingToolCall(ctx, "test-session-1", "calculate")
		require.NoError(t, err)
		require.NotNil(t, updatedTool)
		require.Equal(t, "calculate", updatedTool.ToolName)
		require.Equal(t, "approval-123", updatedTool.ApprovalID)
		require.Equal(t, ApprovalStatusPending, updatedTool.ApprovalStatus)
		require.False(t, updatedTool.IsCompleted) // Still not completed
	})

	t.Run("MarkToolCallCompleted", func(t *testing.T) {
		// Mark the calculate tool call as completed
		err := store.MarkToolCallCompleted(ctx, "tool-1", "test-session-1")
		require.NoError(t, err)

		// Now it should not be found as pending
		pendingTool, err := store.GetPendingToolCall(ctx, "test-session-1", "calculate")
		require.NoError(t, err)
		require.Nil(t, pendingTool, "Tool call should no longer be pending after completion")

		// Verify in conversation that it's marked as completed
		conv, err := store.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		for _, event := range conv {
			if event.EventType == EventTypeToolCall && event.ToolName == "calculate" {
				require.True(t, event.IsCompleted, "Tool call should be marked as completed")
				require.Equal(t, ApprovalStatusPending, event.ApprovalStatus) // Still has approval status
				require.Equal(t, "approval-123", event.ApprovalID)
			}
		}
	})

	t.Run("ListSessions", func(t *testing.T) {
		// Create another session
		session2 := &Session{
			ID:             "test-session-2",
			RunID:          "test-run-2",
			Query:          "Another test",
			Status:         SessionStatusRunning,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}
		err := store.CreateSession(ctx, session2)
		require.NoError(t, err)

		// List all sessions
		sessions, err := store.ListSessions(ctx)
		require.NoError(t, err)
		require.Len(t, sessions, 2)
	})
}
