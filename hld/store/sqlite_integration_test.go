//go:build integration
// +build integration

package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// TestSQLiteStoreIntegration tests the SQLite store with real database operations
func TestSQLiteStoreIntegration(t *testing.T) {
	// Create temporary database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Create store
	store, err := NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	// Verify database file was created
	if _, err := os.Stat(dbPath); err != nil {
		t.Errorf("database file not created: %v", err)
	}

	ctx := context.Background()

	t.Run("session_lifecycle", func(t *testing.T) {
		// Create a session
		session := &Session{
			ID:              "sess-1",
			RunID:           "run-1",
			ClaudeSessionID: "claude-sess-1",
			Query:           "Write a function to calculate fibonacci",
			Model:           "claude-3.5-sonnet-20241022",
			WorkingDir:      "/tmp/work",
			Status:          SessionStatusStarting,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Create session
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Get session
		retrieved, err := store.GetSession(ctx, session.ID)
		if err != nil {
			t.Fatalf("failed to get session: %v", err)
		}

		if retrieved.ID != session.ID {
			t.Errorf("expected ID %s, got %s", session.ID, retrieved.ID)
		}
		if retrieved.Query != session.Query {
			t.Errorf("expected query %s, got %s", session.Query, retrieved.Query)
		}

		// Update session
		claudeID := "claude-sess-123"
		status := SessionStatusRunning
		now := time.Now()
		err = store.UpdateSession(ctx, session.ID, SessionUpdate{
			ClaudeSessionID: &claudeID,
			Status:          &status,
			LastActivityAt:  &now,
		})
		if err != nil {
			t.Fatalf("failed to update session: %v", err)
		}

		// Verify update
		updated, err := store.GetSession(ctx, session.ID)
		if err != nil {
			t.Fatalf("failed to get updated session: %v", err)
		}

		if updated.ClaudeSessionID != claudeID {
			t.Errorf("expected claude session ID %s, got %s", claudeID, updated.ClaudeSessionID)
		}
		if updated.Status != status {
			t.Errorf("expected status %s, got %s", status, updated.Status)
		}

		// List sessions
		sessions, err := store.ListSessions(ctx)
		if err != nil {
			t.Fatalf("failed to list sessions: %v", err)
		}

		if len(sessions) != 1 {
			t.Errorf("expected 1 session, got %d", len(sessions))
		}
	})

	t.Run("conversation_events", func(t *testing.T) {
		sessionID := "sess-2"
		claudeSessionID := "claude-sess-2"

		// Create session first
		session := &Session{
			ID:              sessionID,
			RunID:           "run-2",
			ClaudeSessionID: claudeSessionID,
			Query:           "Test conversation",
			Model:           "claude-3.5-sonnet-20241022",
			Status:          SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Add conversation events
		events := []*ConversationEvent{
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        1,
				EventType:       EventTypeMessage,
				Role:            "user",
				Content:         "Write a fibonacci function",
				CreatedAt:       time.Now(),
			},
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        2,
				EventType:       EventTypeMessage,
				Role:            "assistant",
				Content:         "I'll help you write a fibonacci function.",
				CreatedAt:       time.Now(),
			},
			{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        3,
				EventType:       EventTypeToolCall,
				ToolID:          "tool-1",
				ToolName:        "write_file",
				ToolInputJSON:   `{"path": "fib.py", "content": "def fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)"}`,
				CreatedAt:       time.Now(),
			},
			{
				SessionID:         sessionID,
				ClaudeSessionID:   claudeSessionID,
				Sequence:          4,
				EventType:         EventTypeToolResult,
				ToolResultForID:   "tool-1",
				ToolResultContent: "File written successfully",
				CreatedAt:         time.Now(),
			},
		}

		for _, event := range events {
			err := store.AddConversationEvent(ctx, event)
			if err != nil {
				t.Fatalf("failed to add conversation event: %v", err)
			}
		}

		// Get conversation by claude session ID
		conversation, err := store.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		if len(conversation) != 4 {
			t.Errorf("expected 4 events, got %d", len(conversation))
		}

		// Verify order
		for i, event := range conversation {
			if event.Sequence != i+1 {
				t.Errorf("expected sequence %d, got %d", i+1, event.Sequence)
			}
		}

		// Get conversation by session ID
		sessionConv, err := store.GetSessionConversation(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get session conversation: %v", err)
		}

		if len(sessionConv) != len(conversation) {
			t.Errorf("expected same number of events, got %d vs %d", len(conversation), len(sessionConv))
		}
	})

	t.Run("tool_call_tracking", func(t *testing.T) {
		sessionID := "sess-3"
		claudeSessionID := "claude-sess-3"

		// Create session
		session := &Session{
			ID:              sessionID,
			RunID:           "run-3",
			ClaudeSessionID: claudeSessionID,
			Query:           "Test tool calls",
			Model:           "claude-3.5-sonnet-20241022",
			Status:          SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Add tool call
		toolCall := &ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			Sequence:        1,
			EventType:       EventTypeToolCall,
			ToolID:          "tool-2",
			ToolName:        "dangerous_function",
			ToolInputJSON:   `{"action": "delete_all"}`,
			IsCompleted:     false,
			CreatedAt:       time.Now(),
		}
		err = store.AddConversationEvent(ctx, toolCall)
		if err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// Get pending tool call
		pending, err := store.GetPendingToolCall(ctx, sessionID, "dangerous_function")
		if err != nil {
			t.Fatalf("failed to get pending tool call: %v", err)
		}

		if pending == nil {
			t.Fatal("expected pending tool call, got nil")
		}
		if pending.ToolName != "dangerous_function" {
			t.Errorf("expected tool name dangerous_function, got %s", pending.ToolName)
		}

		// Correlate approval
		approvalID := "approval-123"
		err = store.CorrelateApproval(ctx, sessionID, "dangerous_function", approvalID)
		if err != nil {
			t.Fatalf("failed to correlate approval: %v", err)
		}

		// Update approval status
		err = store.UpdateApprovalStatus(ctx, approvalID, ApprovalStatusApproved)
		if err != nil {
			t.Fatalf("failed to update approval status: %v", err)
		}

		// Mark tool call completed
		err = store.MarkToolCallCompleted(ctx, "tool-2", sessionID)
		if err != nil {
			t.Fatalf("failed to mark tool call completed: %v", err)
		}

		// Verify no more pending tool calls
		pending, err = store.GetPendingToolCall(ctx, sessionID, "dangerous_function")
		if err != nil {
			t.Fatalf("failed to get pending tool call: %v", err)
		}
		if pending != nil {
			t.Error("expected no pending tool call after completion")
		}
	})

	t.Run("mcp_servers", func(t *testing.T) {
		sessionID := "sess-4"

		// Create session
		session := &Session{
			ID:             sessionID,
			RunID:          "run-4",
			Query:          "Test MCP servers",
			Model:          "claude-3.5-sonnet-20241022",
			Status:         SessionStatusStarting,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Store MCP servers
		servers := []MCPServer{
			{
				SessionID: sessionID,
				Name:      "filesystem",
				Command:   "npx",
				ArgsJSON:  `["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]`,
				EnvJSON:   `{"ALLOW_WRITES": "true"}`,
			},
			{
				SessionID: sessionID,
				Name:      "humanlayer",
				Command:   "npx",
				ArgsJSON:  `["humanlayer", "mcp", "serve"]`,
				EnvJSON:   `{"HUMANLAYER_RUN_ID": "run-4"}`,
			},
		}

		err = store.StoreMCPServers(ctx, sessionID, servers)
		if err != nil {
			t.Fatalf("failed to store MCP servers: %v", err)
		}

		// Get MCP servers
		retrieved, err := store.GetMCPServers(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get MCP servers: %v", err)
		}

		if len(retrieved) != 2 {
			t.Fatalf("expected 2 servers, got %d", len(retrieved))
		}

		// Verify server data
		for i, server := range retrieved {
			if server.Name != servers[i].Name {
				t.Errorf("expected server name %s, got %s", servers[i].Name, server.Name)
			}
			if server.Command != servers[i].Command {
				t.Errorf("expected command %s, got %s", servers[i].Command, server.Command)
			}
		}
	})

	t.Run("raw_events", func(t *testing.T) {
		sessionID := "sess-5"

		// Create session
		session := &Session{
			ID:             sessionID,
			RunID:          "run-5",
			Query:          "Test raw events",
			Model:          "claude-3.5-sonnet-20241022",
			Status:         SessionStatusRunning,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Store raw events
		rawEvent := `{"type": "assistant", "message": {"role": "assistant", "content": "Hello!"}}`
		err = store.StoreRawEvent(ctx, sessionID, rawEvent)
		if err != nil {
			t.Fatalf("failed to store raw event: %v", err)
		}

		// Verify by checking database directly (since we don't have a getter)
		db, err := sql.Open("sqlite3", dbPath)
		if err != nil {
			t.Fatalf("failed to open database: %v", err)
		}
		defer db.Close()

		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM raw_events WHERE session_id = ?", sessionID).Scan(&count)
		if err != nil {
			t.Fatalf("failed to count raw events: %v", err)
		}

		if count != 1 {
			t.Errorf("expected 1 raw event, got %d", count)
		}
	})

	t.Run("concurrent_operations", func(t *testing.T) {
		// Test concurrent writes don't cause "database is locked" errors
		sessionID := "sess-concurrent"
		claudeSessionID := "claude-concurrent"

		// Create session
		session := &Session{
			ID:              sessionID,
			RunID:           "run-concurrent",
			ClaudeSessionID: claudeSessionID,
			Query:           "Test concurrent access",
			Model:           "claude-3.5-sonnet-20241022",
			Status:          SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Run concurrent operations
		var wg sync.WaitGroup
		errors := make(chan error, 100)

		// Add 20 events concurrently
		for i := 0; i < 20; i++ {
			wg.Add(1)
			go func(seq int) {
				defer wg.Done()
				event := &ConversationEvent{
					SessionID:       sessionID,
					ClaudeSessionID: claudeSessionID,
					Sequence:        seq,
					EventType:       EventTypeMessage,
					Role:            "assistant",
					Content:         "Concurrent message",
					CreatedAt:       time.Now(),
				}
				if err := store.AddConversationEvent(ctx, event); err != nil {
					errors <- err
				}
			}(i + 1)
		}

		// Update session status concurrently
		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				now := time.Now()
				if err := store.UpdateSession(ctx, sessionID, SessionUpdate{
					LastActivityAt: &now,
				}); err != nil {
					errors <- err
				}
			}()
		}

		wg.Wait()
		close(errors)

		// Check for errors
		var errCount int
		for err := range errors {
			t.Errorf("concurrent operation error: %v", err)
			errCount++
		}

		if errCount > 0 {
			t.Errorf("had %d errors during concurrent operations", errCount)
		}

		// Verify all events were stored
		events, err := store.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		if len(events) != 20 {
			t.Errorf("expected 20 events, got %d", len(events))
		}
	})

	t.Run("performance", func(t *testing.T) {
		// Test performance with 1000 events
		sessionID := "sess-perf"
		claudeSessionID := "claude-perf"

		// Create session
		session := &Session{
			ID:              sessionID,
			RunID:           "run-perf",
			ClaudeSessionID: claudeSessionID,
			Query:           "Performance test",
			Model:           "claude-3.5-sonnet-20241022",
			Status:          SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		err := store.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// Add 1000 events
		start := time.Now()
		for i := 0; i < 1000; i++ {
			event := &ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        i + 1,
				EventType:       EventTypeMessage,
				Role:            "assistant",
				Content:         "Test message for performance",
				CreatedAt:       time.Now(),
			}
			if err := store.AddConversationEvent(ctx, event); err != nil {
				t.Fatalf("failed to add event %d: %v", i, err)
			}
		}
		insertDuration := time.Since(start)

		// Query all events
		start = time.Now()
		events, err := store.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}
		queryDuration := time.Since(start)

		if len(events) != 1000 {
			t.Errorf("expected 1000 events, got %d", len(events))
		}

		// Check performance
		if queryDuration > 100*time.Millisecond {
			t.Errorf("query took too long: %v (should be < 100ms)", queryDuration)
		}

		t.Logf("Performance: inserted 1000 events in %v, queried in %v", insertDuration, queryDuration)
	})

	t.Run("error_handling", func(t *testing.T) {
		// Test various error conditions

		// Try to get non-existent session
		_, err := store.GetSession(ctx, "non-existent")
		if err == nil {
			t.Error("expected error for non-existent session")
		}

		// Try to update non-existent session
		status := SessionStatusCompleted
		err = store.UpdateSession(ctx, "non-existent", SessionUpdate{
			Status: &status,
		})
		if err == nil {
			t.Error("expected error for updating non-existent session")
		}

		// Try to add event for non-existent session (should succeed - foreign keys not enforced)
		event := &ConversationEvent{
			SessionID:       "non-existent",
			ClaudeSessionID: "non-existent",
			Sequence:        1,
			EventType:       EventTypeMessage,
			Role:            "user",
			Content:         "Test",
			CreatedAt:       time.Now(),
		}
		err = store.AddConversationEvent(ctx, event)
		// This might succeed due to SQLite foreign key enforcement settings
		// Just log the result
		t.Logf("Adding event for non-existent session: %v", err)
	})
}

// TestSQLiteStorePersistence verifies data persists across store instances
func TestSQLiteStorePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "persist.db")
	ctx := context.Background()

	// Create first store instance
	store1, err := NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store1: %v", err)
	}

	// Add data
	session := &Session{
		ID:              "persist-1",
		RunID:           "run-persist-1",
		ClaudeSessionID: "claude-persist-1",
		Query:           "Test persistence",
		Model:           "claude-3.5-sonnet-20241022",
		Status:          SessionStatusCompleted,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = store1.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	event := &ConversationEvent{
		SessionID:       session.ID,
		ClaudeSessionID: session.ClaudeSessionID,
		Sequence:        1,
		EventType:       EventTypeMessage,
		Role:            "user",
		Content:         "Persistent message",
		CreatedAt:       time.Now(),
	}
	err = store1.AddConversationEvent(ctx, event)
	if err != nil {
		t.Fatalf("failed to add event: %v", err)
	}

	// Close first store
	store1.Close()

	// Create second store instance
	store2, err := NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store2: %v", err)
	}
	defer store2.Close()

	// Verify data persisted
	retrieved, err := store2.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if retrieved.Query != session.Query {
		t.Errorf("expected query %s, got %s", session.Query, retrieved.Query)
	}

	events, err := store2.GetConversation(ctx, session.ClaudeSessionID)
	if err != nil {
		t.Fatalf("failed to get conversation: %v", err)
	}

	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}

	if events[0].Content != event.Content {
		t.Errorf("expected content %s, got %s", event.Content, events[0].Content)
	}
}

// TestSQLiteStoreWithMockSession tests store integration with mock claude sessions
func TestSQLiteStoreWithMockSession(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "mock_session.db")
	ctx := context.Background()

	store, err := NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	// Simulate a Claude Code session
	sessionID := "mock-sess-1"
	runID := "mock-run-1"
	claudeSessionID := "" // Not set initially

	// Create session from config (like session manager would)
	config := claudecode.SessionConfig{
		Query:      "Write a Python script to analyze CSV files",
		Model:      claudecode.ModelSonnet,
		WorkingDir: "/tmp/work",
		MaxTurns:   10,
	}
	session := NewSessionFromConfig(sessionID, runID, config)

	err = store.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Simulate receiving streaming events
	// 1. System event with session ID
	claudeSessionID = "01JGK7MWS9Z8XQYV3H2BCDEFGH"
	claudeID := claudeSessionID
	status := SessionStatusRunning
	err = store.UpdateSession(ctx, sessionID, SessionUpdate{
		ClaudeSessionID: &claudeID,
		Status:          &status,
	})
	if err != nil {
		t.Fatalf("failed to update session with claude ID: %v", err)
	}

	// 2. User message (initial query)
	userMsg := &ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        1,
		EventType:       EventTypeMessage,
		Role:            "user",
		Content:         config.Query,
		CreatedAt:       time.Now(),
	}
	err = store.AddConversationEvent(ctx, userMsg)
	if err != nil {
		t.Fatalf("failed to add user message: %v", err)
	}

	// 3. Assistant message with tool use
	assistantMsg := &ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        2,
		EventType:       EventTypeMessage,
		Role:            "assistant",
		Content:         "I'll help you create a Python script to analyze CSV files. Let me start by creating a script with the necessary functionality.",
		CreatedAt:       time.Now(),
	}
	err = store.AddConversationEvent(ctx, assistantMsg)
	if err != nil {
		t.Fatalf("failed to add assistant message: %v", err)
	}

	// 4. Tool call
	toolCall := &ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        3,
		EventType:       EventTypeToolCall,
		ToolID:          "toolu_01ABC123",
		ToolName:        "str_replace_editor",
		ToolInputJSON:   `{"command": "create", "path": "csv_analyzer.py", "file_text": "import pandas as pd\nimport sys\n\ndef analyze_csv(filepath):\n    df = pd.read_csv(filepath)\n    print(f\"Shape: {df.shape}\")\n    print(f\"Columns: {list(df.columns)}\")\n    print(f\"\\nFirst 5 rows:\\n{df.head()}\")\n\nif __name__ == '__main__':\n    if len(sys.argv) > 1:\n        analyze_csv(sys.argv[1])\n    else:\n        print(\"Usage: python csv_analyzer.py <csv_file>\")\n"}`,
		IsCompleted:     false,
		CreatedAt:       time.Now(),
	}
	err = store.AddConversationEvent(ctx, toolCall)
	if err != nil {
		t.Fatalf("failed to add tool call: %v", err)
	}

	// 5. Check pending tool call (approval might be needed)
	pending, err := store.GetPendingToolCall(ctx, sessionID, "str_replace_editor")
	if err != nil {
		t.Fatalf("failed to get pending tool call: %v", err)
	}
	if pending == nil || pending.ToolID != toolCall.ToolID {
		t.Error("expected to find pending tool call")
	}

	// 6. Tool result
	toolResult := &ConversationEvent{
		SessionID:         sessionID,
		ClaudeSessionID:   claudeSessionID,
		Sequence:          4,
		EventType:         EventTypeToolResult,
		ToolResultForID:   "toolu_01ABC123",
		ToolResultContent: "File created successfully at csv_analyzer.py",
		CreatedAt:         time.Now(),
	}
	err = store.AddConversationEvent(ctx, toolResult)
	if err != nil {
		t.Fatalf("failed to add tool result: %v", err)
	}

	// 7. Mark tool call completed
	err = store.MarkToolCallCompleted(ctx, toolCall.ToolID, sessionID)
	if err != nil {
		t.Fatalf("failed to mark tool call completed: %v", err)
	}

	// 8. Final assistant message
	finalMsg := &ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        5,
		EventType:       EventTypeMessage,
		Role:            "assistant",
		Content:         "I've created a Python script called `csv_analyzer.py` that can analyze CSV files...",
		CreatedAt:       time.Now(),
	}
	err = store.AddConversationEvent(ctx, finalMsg)
	if err != nil {
		t.Fatalf("failed to add final message: %v", err)
	}

	// 9. Update session as completed
	completedStatus := SessionStatusCompleted
	completedAt := time.Now()
	costUSD := 0.0025
	totalTokens := 1234
	durationMS := 5678
	err = store.UpdateSession(ctx, sessionID, SessionUpdate{
		Status:      &completedStatus,
		CompletedAt: &completedAt,
		CostUSD:     &costUSD,
		TotalTokens: &totalTokens,
		DurationMS:  &durationMS,
	})
	if err != nil {
		t.Fatalf("failed to update session as completed: %v", err)
	}

	// Verify the complete conversation
	conversation, err := store.GetConversation(ctx, claudeSessionID)
	if err != nil {
		t.Fatalf("failed to get conversation: %v", err)
	}

	if len(conversation) != 5 {
		t.Errorf("expected 5 events, got %d", len(conversation))
	}

	// Verify session state
	finalSession, err := store.GetSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("failed to get final session: %v", err)
	}

	if finalSession.Status != SessionStatusCompleted {
		t.Errorf("expected status %s, got %s", SessionStatusCompleted, finalSession.Status)
	}
	if finalSession.CostUSD == nil || *finalSession.CostUSD != costUSD {
		t.Error("cost not properly stored")
	}
	if finalSession.TotalTokens == nil || *finalSession.TotalTokens != totalTokens {
		t.Error("tokens not properly stored")
	}
}
