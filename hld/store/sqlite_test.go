package store

import (
	"context"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/stretchr/testify/require"
)

func TestSQLiteStore(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	claudeSessionID := "claude-123" // Used across multiple tests

	t.Run("CreateAndGetSession", func(t *testing.T) {
		// Create a session
		session := &Session{
			ID:             "test-session-1",
			RunID:          "test-run-1",
			Query:          "Test query",
			Model:          "sonnet",
			Status:         SessionStatusStarting,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
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

	t.Run("GetRecentWorkingDirs", func(t *testing.T) {
		// Create sessions with different working directories
		testSessions := []struct {
			id         string
			workingDir string
			timestamp  time.Time
		}{
			{"test-recent-1", "/home/user/project1", time.Now()},
			{"test-recent-2", "/home/user/project2", time.Now().Add(-1 * time.Hour)},
			{"test-recent-3", "/home/user/project1", time.Now().Add(-2 * time.Hour)}, // duplicate path
			{"test-recent-4", "/home/user/project3", time.Now().Add(-3 * time.Hour)},
			{"test-recent-5", "", time.Now()},  // empty path, should be filtered
			{"test-recent-6", ".", time.Now()}, // current dir, should be filtered
		}

		// Create test sessions
		for _, ts := range testSessions {
			session := &Session{
				ID:             ts.id,
				RunID:          "run-" + ts.id,
				Query:          "Test query",
				WorkingDir:     ts.workingDir,
				Status:         SessionStatusCompleted,
				CreatedAt:      ts.timestamp,
				LastActivityAt: ts.timestamp,
			}
			err := store.CreateSession(ctx, session)
			require.NoError(t, err)
		}

		// Test with default limit
		paths, err := store.GetRecentWorkingDirs(ctx, 0)
		require.NoError(t, err)
		require.Len(t, paths, 3, "Should return 3 unique non-empty paths")

		// Verify ordering (most recent first)
		require.Equal(t, "/home/user/project1", paths[0].Path)
		require.Equal(t, "/home/user/project2", paths[1].Path)
		require.Equal(t, "/home/user/project3", paths[2].Path)

		// Verify usage count
		require.Equal(t, 2, paths[0].UsageCount, "project1 should have usage count of 2")
		require.Equal(t, 1, paths[1].UsageCount, "project2 should have usage count of 1")
		require.Equal(t, 1, paths[2].UsageCount, "project3 should have usage count of 1")

		// Test with explicit limit
		limitedPaths, err := store.GetRecentWorkingDirs(ctx, 2)
		require.NoError(t, err)
		require.Len(t, limitedPaths, 2, "Should respect the limit")
		require.Equal(t, "/home/user/project1", limitedPaths[0].Path)
		require.Equal(t, "/home/user/project2", limitedPaths[1].Path)

		// Test with no sessions having working dirs
		// Create a new store to test empty case
		dbPath2 := testutil.DatabasePath(t, "sqlite-empty")
		store2, err := NewSQLiteStore(dbPath2)
		require.NoError(t, err)
		defer func() { _ = store2.Close() }()

		emptyPaths, err := store2.GetRecentWorkingDirs(ctx, 10)
		require.NoError(t, err)
		require.Empty(t, emptyPaths, "Should return empty slice when no sessions exist")
	})
}

func TestGetSessionConversationWithParentChain(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite-parent")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create parent session
	parentSession := &Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "claude-parent",
		Query:           "Tell me about Go",
		Status:          SessionStatusCompleted,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = store.CreateSession(ctx, parentSession)
	require.NoError(t, err)

	// Add events to parent session
	parentEvents := []*ConversationEvent{
		{
			SessionID:       "parent-1",
			ClaudeSessionID: "claude-parent",
			Sequence:        1,
			EventType:       EventTypeMessage,
			Role:            "user",
			Content:         "Tell me about Go",
			CreatedAt:       time.Now(),
		},
		{
			SessionID:       "parent-1",
			ClaudeSessionID: "claude-parent",
			Sequence:        2,
			EventType:       EventTypeMessage,
			Role:            "assistant",
			Content:         "Go is a statically typed programming language...",
			CreatedAt:       time.Now().Add(1 * time.Second),
		},
	}
	for _, event := range parentEvents {
		err = store.AddConversationEvent(ctx, event)
		require.NoError(t, err)
	}

	// Create child session
	childSession := &Session{
		ID:              "child-1",
		RunID:           "run-2",
		ClaudeSessionID: "claude-child",
		ParentSessionID: "parent-1",
		Query:           "Tell me more about goroutines",
		Status:          SessionStatusCompleted,
		CreatedAt:       time.Now().Add(5 * time.Second),
		LastActivityAt:  time.Now().Add(5 * time.Second),
	}
	err = store.CreateSession(ctx, childSession)
	require.NoError(t, err)

	// Add events to child session
	childEvents := []*ConversationEvent{
		{
			SessionID:       "child-1",
			ClaudeSessionID: "claude-child",
			Sequence:        1,
			EventType:       EventTypeMessage,
			Role:            "user",
			Content:         "Tell me more about goroutines",
			CreatedAt:       time.Now().Add(10 * time.Second),
		},
		{
			SessionID:       "child-1",
			ClaudeSessionID: "claude-child",
			Sequence:        2,
			EventType:       EventTypeMessage,
			Role:            "assistant",
			Content:         "Goroutines are lightweight threads...",
			CreatedAt:       time.Now().Add(11 * time.Second),
		},
	}
	for _, event := range childEvents {
		err = store.AddConversationEvent(ctx, event)
		require.NoError(t, err)
	}

	// Create grandchild session
	grandchildSession := &Session{
		ID:              "grandchild-1",
		RunID:           "run-3",
		ClaudeSessionID: "claude-grandchild",
		ParentSessionID: "child-1",
		Query:           "How do channels work?",
		Status:          SessionStatusRunning,
		CreatedAt:       time.Now().Add(20 * time.Second),
		LastActivityAt:  time.Now().Add(20 * time.Second),
	}
	err = store.CreateSession(ctx, grandchildSession)
	require.NoError(t, err)

	// Add events to grandchild session
	grandchildEvents := []*ConversationEvent{
		{
			SessionID:       "grandchild-1",
			ClaudeSessionID: "claude-grandchild",
			Sequence:        1,
			EventType:       EventTypeMessage,
			Role:            "user",
			Content:         "How do channels work?",
			CreatedAt:       time.Now().Add(25 * time.Second),
		},
		{
			SessionID:       "grandchild-1",
			ClaudeSessionID: "claude-grandchild",
			Sequence:        2,
			EventType:       EventTypeMessage,
			Role:            "assistant",
			Content:         "Channels are Go's way of communication...",
			CreatedAt:       time.Now().Add(26 * time.Second),
		},
	}
	for _, event := range grandchildEvents {
		err = store.AddConversationEvent(ctx, event)
		require.NoError(t, err)
	}

	t.Run("GetSessionConversation_IncludesFullHistory", func(t *testing.T) {
		// Get conversation for grandchild - should include all parent events
		events, err := store.GetSessionConversation(ctx, "grandchild-1")
		require.NoError(t, err)
		require.Len(t, events, 6) // 2 from parent + 2 from child + 2 from grandchild

		// Verify chronological order
		expectedContents := []string{
			"Tell me about Go",
			"Go is a statically typed programming language...",
			"Tell me more about goroutines",
			"Goroutines are lightweight threads...",
			"How do channels work?",
			"Channels are Go's way of communication...",
		}

		for i, event := range events {
			require.Equal(t, expectedContents[i], event.Content)
		}
	})

	t.Run("GetSessionConversation_SessionWithoutClaudeID", func(t *testing.T) {
		// Create session without claude_session_id yet
		newSession := &Session{
			ID:             "new-session",
			RunID:          "run-4",
			Query:          "New query",
			Status:         SessionStatusStarting,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}
		err = store.CreateSession(ctx, newSession)
		require.NoError(t, err)

		// Should return empty events
		events, err := store.GetSessionConversation(ctx, "new-session")
		require.NoError(t, err)
		require.Len(t, events, 0)
	})

	t.Run("GetSessionConversation_NonExistentSession", func(t *testing.T) {
		// Should return error for non-existent session
		_, err := store.GetSessionConversation(ctx, "does-not-exist")
		require.Error(t, err)
		require.Contains(t, err.Error(), "session not found: does-not-exist")
	})

	t.Run("GetSessionConversation_NoParent", func(t *testing.T) {
		// Get conversation for parent session (no parents)
		events, err := store.GetSessionConversation(ctx, "parent-1")
		require.NoError(t, err)
		require.Len(t, events, 2) // Only parent's events
	})

	t.Run("GetSessionConversation_MiddleOfChain", func(t *testing.T) {
		// Get conversation for child (middle of chain)
		events, err := store.GetSessionConversation(ctx, "child-1")
		require.NoError(t, err)
		require.Len(t, events, 4) // Parent's 2 + child's 2

		// Verify we get parent events first, then child
		require.Equal(t, "Tell me about Go", events[0].Content)
		require.Equal(t, "Go is a statically typed programming language...", events[1].Content)
		require.Equal(t, "Tell me more about goroutines", events[2].Content)
		require.Equal(t, "Goroutines are lightweight threads...", events[3].Content)
	})
}

func TestGetToolCallByID(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite-toolcall")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session
	session := &Session{
		ID:              "test-session",
		RunID:           "test-run",
		ClaudeSessionID: "claude-session-1",
		Query:           "Test query",
		Model:           "sonnet",
		Status:          SessionStatusRunning,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	require.NoError(t, store.CreateSession(ctx, session))

	// Add a tool call event
	toolCall := &ConversationEvent{
		SessionID:       session.ID,
		ClaudeSessionID: session.ClaudeSessionID,
		EventType:       EventTypeToolCall,
		ToolID:          "tool-123",
		ToolName:        "Read",
		ToolInputJSON:   `{"file_path": "test.txt"}`,
		ParentToolUseID: "",
	}
	require.NoError(t, store.AddConversationEvent(ctx, toolCall))

	// Add another tool call with different ID
	toolCall2 := &ConversationEvent{
		SessionID:       session.ID,
		ClaudeSessionID: session.ClaudeSessionID,
		EventType:       EventTypeToolCall,
		ToolID:          "tool-456",
		ToolName:        "Write",
		ToolInputJSON:   `{"file_path": "output.txt"}`,
	}
	require.NoError(t, store.AddConversationEvent(ctx, toolCall2))

	t.Run("GetExistingToolCall", func(t *testing.T) {
		result, err := store.GetToolCallByID(ctx, "tool-123")
		require.NoError(t, err)
		require.NotNil(t, result)
		require.Equal(t, "tool-123", result.ToolID)
		require.Equal(t, "Read", result.ToolName)
		require.Equal(t, `{"file_path": "test.txt"}`, result.ToolInputJSON)
	})

	t.Run("GetNonExistentToolCall", func(t *testing.T) {
		result, err := store.GetToolCallByID(ctx, "non-existent")
		require.NoError(t, err)
		require.Nil(t, result)
	})

	t.Run("GetCorrectToolCall", func(t *testing.T) {
		// Ensure we get the right tool call when multiple exist
		result, err := store.GetToolCallByID(ctx, "tool-456")
		require.NoError(t, err)
		require.NotNil(t, result)
		require.Equal(t, "tool-456", result.ToolID)
		require.Equal(t, "Write", result.ToolName)
	})
}

func TestFileSnapshots(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite-snapshots")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session
	session := &Session{
		ID:             "test-session",
		RunID:          "test-run",
		Query:          "Test query",
		Model:          "sonnet",
		Status:         SessionStatusRunning,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
	require.NoError(t, store.CreateSession(ctx, session))

	t.Run("CreateAndGetSnapshots", func(t *testing.T) {
		// Create snapshots
		snapshot1 := &FileSnapshot{
			ToolID:    "tool-1",
			SessionID: session.ID,
			FilePath:  "src/main.go",
			Content:   "package main\n\nfunc main() {}\n",
		}
		require.NoError(t, store.CreateFileSnapshot(ctx, snapshot1))

		// Small delay to ensure different timestamps
		time.Sleep(10 * time.Millisecond)

		snapshot2 := &FileSnapshot{
			ToolID:    "tool-2",
			SessionID: session.ID,
			FilePath:  "src/utils.go",
			Content:   "package utils\n\nfunc Helper() {}\n",
		}
		require.NoError(t, store.CreateFileSnapshot(ctx, snapshot2))

		// Get snapshots for session
		snapshots, err := store.GetFileSnapshots(ctx, session.ID)
		require.NoError(t, err)
		require.Len(t, snapshots, 2)

		// Find snapshots by file path (order may vary due to timestamp precision)
		var mainSnapshot, utilsSnapshot FileSnapshot
		for _, s := range snapshots {
			switch s.FilePath {
			case "src/main.go":
				mainSnapshot = s
			case "src/utils.go":
				utilsSnapshot = s
			}
		}

		// Verify content
		require.Equal(t, "package main\n\nfunc main() {}\n", mainSnapshot.Content)
		require.Equal(t, "package utils\n\nfunc Helper() {}\n", utilsSnapshot.Content)

		// Verify other fields
		require.Equal(t, "tool-1", mainSnapshot.ToolID)
		require.Equal(t, "tool-2", utilsSnapshot.ToolID)
		require.NotZero(t, mainSnapshot.ID)
		require.NotZero(t, utilsSnapshot.ID)
		require.NotZero(t, mainSnapshot.CreatedAt)
		require.NotZero(t, utilsSnapshot.CreatedAt)
	})

	t.Run("GetSnapshotsForNonExistentSession", func(t *testing.T) {
		snapshots, err := store.GetFileSnapshots(ctx, "non-existent-session")
		require.NoError(t, err)
		require.Empty(t, snapshots)
	})

	t.Run("CreateSnapshotWithLargeContent", func(t *testing.T) {
		// Test with larger content (simulate a real file)
		largeContent := ""
		for i := 0; i < 1000; i++ {
			largeContent += "// This is line " + string(rune(i)) + " of a large file\n"
		}

		snapshot := &FileSnapshot{
			ToolID:    "tool-large",
			SessionID: session.ID,
			FilePath:  "large_file.txt",
			Content:   largeContent,
		}
		require.NoError(t, store.CreateFileSnapshot(ctx, snapshot))

		// Verify it was stored correctly
		snapshots, err := store.GetFileSnapshots(ctx, session.ID)
		require.NoError(t, err)

		var found bool
		for _, s := range snapshots {
			if s.FilePath == "large_file.txt" {
				found = true
				require.Equal(t, largeContent, s.Content)
				break
			}
		}
		require.True(t, found, "Large file snapshot not found")
	})

	t.Run("CreateSnapshotWithSpecialCharacters", func(t *testing.T) {
		// Test with special characters in path and content
		snapshot := &FileSnapshot{
			ToolID:    "tool-special",
			SessionID: session.ID,
			FilePath:  "path/with spaces/and-special_chars!.txt",
			Content:   "Content with 'quotes' and \"double quotes\" and\nnewlines\nand\ttabs",
		}
		require.NoError(t, store.CreateFileSnapshot(ctx, snapshot))

		snapshots, err := store.GetFileSnapshots(ctx, session.ID)
		require.NoError(t, err)

		var found bool
		for _, s := range snapshots {
			if s.ToolID == "tool-special" {
				found = true
				require.Equal(t, snapshot.FilePath, s.FilePath)
				require.Equal(t, snapshot.Content, s.Content)
				break
			}
		}
		require.True(t, found, "Special character snapshot not found")
	})
}

func TestSearchSessionsByTitle(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite-search")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create test sessions with various titles
	sessions := []*Session{
		{
			ID:             "sess1",
			RunID:          "run1",
			Title:          "Implement authentication",
			Query:          "Help with auth",
			Status:         SessionStatusCompleted,
			CreatedAt:      time.Now().Add(-2 * time.Hour),
			LastActivityAt: time.Now().Add(-1 * time.Hour),
		},
		{
			ID:             "sess2",
			RunID:          "run2",
			Title:          "Fix authentication bug",
			Query:          "Debug auth issue",
			Status:         SessionStatusCompleted,
			CreatedAt:      time.Now().Add(-3 * time.Hour),
			LastActivityAt: time.Now().Add(-2 * time.Hour),
		},
		{
			ID:             "sess3",
			RunID:          "run3",
			Title:          "Add user profile",
			Query:          "Create profile page",
			Status:         SessionStatusCompleted,
			CreatedAt:      time.Now().Add(-1 * time.Hour),
			LastActivityAt: time.Now().Add(-100 * time.Millisecond),
		},
		{
			ID:             "sess4",
			RunID:          "run4",
			Title:          "", // Empty title
			Query:          "Some query",
			Status:         SessionStatusCompleted,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		},
	}

	for _, s := range sessions {
		err := store.CreateSession(ctx, s)
		require.NoError(t, err)
	}

	t.Run("search by partial title", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "auth", 10)
		require.NoError(t, err)
		require.Len(t, results, 2, "Should find both authentication sessions")

		// Should be ordered by last_activity_at DESC
		require.Equal(t, "sess1", results[0].ID)
		require.Equal(t, "sess2", results[1].ID)
	})

	t.Run("case insensitive search", func(t *testing.T) {
		// SQL LIKE is case-insensitive by default in SQLite
		results, err := store.SearchSessionsByTitle(ctx, "AUTH", 10)
		require.NoError(t, err)
		require.Len(t, results, 2, "Should find sessions with case-insensitive search")
	})

	t.Run("empty query returns recent sessions", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "", 10)
		require.NoError(t, err)
		require.Len(t, results, 4, "Should return all sessions")

		// Should be ordered by last_activity_at DESC
		require.Equal(t, "sess4", results[0].ID, "Most recent session first")
		require.Equal(t, "sess3", results[1].ID)
		require.Equal(t, "sess1", results[2].ID)
		require.Equal(t, "sess2", results[3].ID)
	})

	t.Run("respects limit", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "", 2)
		require.NoError(t, err)
		require.Len(t, results, 2, "Should respect the limit")

		// Should get the 2 most recent sessions
		require.Equal(t, "sess4", results[0].ID)
		require.Equal(t, "sess3", results[1].ID)
	})

	t.Run("no results", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "nonexistent", 10)
		require.NoError(t, err)
		require.Empty(t, results, "Should return empty for non-matching query")
	})

	t.Run("special characters in search", func(t *testing.T) {
		// Create a session with special characters in title
		specialSession := &Session{
			ID:             "sess-special",
			RunID:          "run-special",
			Title:          "Fix SQL injection' OR '1'='1",
			Query:          "Security fix",
			Status:         SessionStatusCompleted,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}
		err := store.CreateSession(ctx, specialSession)
		require.NoError(t, err)

		// Search with special characters (they should be escaped by the LIKE query)
		results, err := store.SearchSessionsByTitle(ctx, "SQL injection", 10)
		require.NoError(t, err)
		require.Len(t, results, 1)
		require.Equal(t, "sess-special", results[0].ID)
	})

	t.Run("handles maximum limit", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "", 50)
		require.NoError(t, err)
		require.Len(t, results, 5, "Should return all 5 sessions when limit is 50")
	})

	t.Run("handles zero limit", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "auth", 0)
		require.NoError(t, err)
		// Zero limit should use default of 10
		require.Len(t, results, 2, "Should return matching sessions with default limit")
	})

	t.Run("handles excessive limit", func(t *testing.T) {
		results, err := store.SearchSessionsByTitle(ctx, "", 100)
		require.NoError(t, err)
		// Should be capped at 50 in the implementation
		require.Len(t, results, 5, "Should return all sessions but respect max limit")
	})
}
