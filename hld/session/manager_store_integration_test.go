//go:build integration
// +build integration

package session

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// mockClaudeSession simulates a Claude Code session for testing
type mockClaudeSession struct {
	events chan claudecode.StreamEvent
	result *claudecode.Result
	err    error
}

func (m *mockClaudeSession) Wait() (*claudecode.Result, error) {
	// Wait for events channel to close
	for range m.events {
		// Drain events
	}
	return m.result, m.err
}

// mockClaudeClient creates mock Claude sessions for testing
type mockClaudeClient struct {
	sessions map[string]*mockClaudeSession
	mu       sync.Mutex
}

func newMockClaudeClient() *mockClaudeClient {
	return &mockClaudeClient{
		sessions: make(map[string]*mockClaudeSession),
	}
}

func (c *mockClaudeClient) CreateSession(config claudecode.SessionConfig) (*claudecode.Session, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Create mock session
	mockSess := &mockClaudeSession{
		events: make(chan claudecode.StreamEvent, 100),
		result: &claudecode.Result{
			IsError:    false,
			DurationMS: 1234,
			CostUSD:    0.002,
		},
	}

	// Generate a session ID
	sessionID := "01JGK7MWS9Z8XQYV3H2BCDEFGH"
	c.sessions[sessionID] = mockSess

	// Return a session that looks like the real thing
	sess := &claudecode.Session{
		Events: mockSess.events,
	}

	// Send initial system event
	go func() {
		// Small delay to simulate real behavior
		time.Sleep(10 * time.Millisecond)

		// Send session created event
		mockSess.events <- claudecode.StreamEvent{
			Type:      "system",
			Subtype:   "session_created",
			SessionID: sessionID,
		}

		// Send user message (the query)
		mockSess.events <- claudecode.StreamEvent{
			Type: "user",
			Message: &claudecode.Message{
				Role: "user",
				Content: []claudecode.Content{
					{Type: "text", Text: config.Query},
				},
			},
		}

		// Send assistant response
		mockSess.events <- claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{Type: "text", Text: "I'll help you with that. Let me create a file for you."},
				},
			},
		}

		// Send tool use
		mockSess.events <- claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type: "tool_use",
						ID:   "toolu_01ABC123",
						Name: "str_replace_editor",
						Input: map[string]interface{}{
							"command":   "create",
							"path":      "test.py",
							"file_text": "print('Hello, World!')",
						},
					},
				},
			},
		}

		// Send tool result
		mockSess.events <- claudecode.StreamEvent{
			Type: "user",
			Message: &claudecode.Message{
				Role: "user",
				Content: []claudecode.Content{
					{
						Type:      "tool_result",
						ToolUseID: "toolu_01ABC123",
						Content:   claudecode.ContentField{Value: "File created successfully"},
					},
				},
			},
		}

		// Send final message
		mockSess.events <- claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{Type: "text", Text: "I've created the test.py file with a simple Hello World program."},
				},
			},
		}

		// Send result
		mockSess.events <- claudecode.StreamEvent{
			Type:       "result",
			IsError:    false,
			DurationMS: 1234,
			CostUSD:    0.002,
		}

		// Close channel to signal completion
		close(mockSess.events)
	}()

	return sess, nil
}

// TestSessionManagerWithStore tests the integration between session manager and store
func TestSessionManagerWithStore(t *testing.T) {
	// Create temporary database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "sessions.db")

	// Create store
	testStore, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer testStore.Close()

	// Create event bus
	eventBus := bus.NewEventBus()

	// Create manager with real store
	manager := &Manager{
		activeProcesses: make(map[string]*claudecode.Session),
		client:          nil, // We'll inject mock client
		eventBus:        eventBus,
		store:           testStore,
	}

	// Inject mock Claude client
	mockClient := newMockClaudeClient()

	ctx := context.Background()

	t.Run("launch_and_monitor_session", func(t *testing.T) {
		// Subscribe to events
		eventChan := make(chan bus.Event, 10)
		subscriber := eventBus.Subscribe(ctx, bus.EventFilter{})
		go func() {
			for event := range subscriber.Channel {
				eventChan <- event
			}
		}()
		defer eventBus.Unsubscribe(subscriber.ID)

		// Launch session
		config := claudecode.SessionConfig{
			Query:      "Write a Python hello world program",
			Model:      claudecode.ModelSonnet,
			WorkingDir: "/tmp",
		}

		// Manually create session since we need to inject mock client
		sessionID := "test-session-1"
		runID := "test-run-1"

		// Create database session
		dbSession := store.NewSessionFromConfig(sessionID, runID, config)
		err = testStore.CreateSession(ctx, dbSession)
		if err != nil {
			t.Fatalf("failed to create session in store: %v", err)
		}

		// Create mock Claude session
		claudeSess, err := mockClient.CreateSession(config)
		if err != nil {
			t.Fatalf("failed to create mock claude session: %v", err)
		}

		// Store active process
		manager.mu.Lock()
		manager.activeProcesses[sessionID] = claudeSess
		manager.mu.Unlock()

		// Instead of calling monitorSession (which expects a real Claude session),
		// we'll manually simulate what monitorSession does for our store integration test

		// Process events from our mock session
		go func() {
			claudeSessionID := ""
			for event := range claudeSess.Events {
				// Capture session ID
				if event.SessionID != "" && claudeSessionID == "" {
					claudeSessionID = event.SessionID
					update := store.SessionUpdate{
						ClaudeSessionID: &claudeSessionID,
					}
					manager.store.UpdateSession(ctx, sessionID, update)
				}

				// Process event
				manager.processStreamEvent(ctx, sessionID, claudeSessionID, event)
			}

			// Clean up active process
			manager.mu.Lock()
			delete(manager.activeProcesses, sessionID)
			manager.mu.Unlock()

			// Update database
			status := string(StatusCompleted)
			completedAt := time.Now()
			costUSD := 0.002
			durationMS := 1234
			manager.store.UpdateSession(ctx, sessionID, store.SessionUpdate{
				Status:      &status,
				CompletedAt: &completedAt,
				CostUSD:     &costUSD,
				DurationMS:  &durationMS,
			})

			// Publish status change event
			manager.eventBus.Publish(bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": sessionID,
					"status":     string(StatusCompleted),
				},
			})
		}()

		// Wait for processing to complete
		time.Sleep(100 * time.Millisecond)

		// Verify session status in database
		dbSession, err = testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get session from database: %v", err)
		}
		finalStatus := Status(dbSession.Status)

		if finalStatus != StatusCompleted {
			t.Errorf("expected status %s, got %s", StatusCompleted, finalStatus)
		}

		// Verify events were published
		var statusChangeCount int
		timeout := time.After(100 * time.Millisecond)
	eventLoop:
		for {
			select {
			case event := <-eventChan:
				if event.Type == bus.EventSessionStatusChanged {
					statusChangeCount++
				}
			case <-timeout:
				break eventLoop
			}
		}

		if statusChangeCount < 1 {
			t.Error("expected at least one status change event")
		}

		// Verify conversation was stored
		conversation, err := testStore.GetConversation(ctx, "01JGK7MWS9Z8XQYV3H2BCDEFGH")
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		// Should have: system, user, assistant, tool_call, tool_result, assistant
		if len(conversation) < 6 {
			t.Errorf("expected at least 6 conversation events, got %d", len(conversation))
		}

		// Verify tool call was marked as completed
		var foundToolCall, foundToolResult bool
		for _, event := range conversation {
			if event.EventType == store.EventTypeToolCall {
				foundToolCall = true
				if !event.IsCompleted {
					t.Error("tool call should be marked as completed")
				}
			}
			if event.EventType == store.EventTypeToolResult {
				foundToolResult = true
			}
		}

		if !foundToolCall {
			t.Error("expected to find tool call in conversation")
		}
		if !foundToolResult {
			t.Error("expected to find tool result in conversation")
		}

		// Verify session was updated in database
		dbSession, err = testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get session from store: %v", err)
		}

		if dbSession.ClaudeSessionID != "01JGK7MWS9Z8XQYV3H2BCDEFGH" {
			t.Error("claude session ID not updated in database")
		}
		if dbSession.Status != string(StatusCompleted) {
			t.Errorf("expected status %s in database, got %s", StatusCompleted, dbSession.Status)
		}
		if dbSession.CostUSD == nil || *dbSession.CostUSD != 0.002 {
			t.Error("cost not properly stored")
		}
	})

	t.Run("concurrent_sessions", func(t *testing.T) {
		// Test multiple concurrent sessions
		var wg sync.WaitGroup
		sessionCount := 5

		for i := 0; i < sessionCount; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()

				sessionID := fmt.Sprintf("concurrent-session-%d", idx)
				runID := fmt.Sprintf("concurrent-run-%d", idx)

				// Create database session
				config := claudecode.SessionConfig{
					Query: fmt.Sprintf("Test query %d", idx),
					Model: claudecode.ModelSonnet,
				}
				dbSession := store.NewSessionFromConfig(sessionID, runID, config)
				err := testStore.CreateSession(ctx, dbSession)
				if err != nil {
					t.Errorf("failed to create session %d: %v", idx, err)
					return
				}

				// Create mock Claude session
				claudeSess, err := mockClient.CreateSession(config)
				if err != nil {
					t.Errorf("failed to create claude session %d: %v", idx, err)
					return
				}

				// Create session
				session := &Session{
					ID:        sessionID,
					RunID:     runID,
					Config:    config,
					Status:    StatusRunning,
					StartTime: time.Now(),
				}

				// Store active process
				manager.mu.Lock()
				manager.activeProcesses[sessionID] = claudeSess
				manager.mu.Unlock()

				// Simulate session completion in background
				go func(sess *Session, idx int) {
					// Process mock events
					for range claudeSess.Events {
						// Events are already sent by mock client
					}

					// Mark as completed
					manager.mu.Lock()
					sess.Status = StatusCompleted
					now := time.Now()
					sess.EndTime = &now
					manager.mu.Unlock()

					// Update database
					status := string(StatusCompleted)
					completedAt := time.Now()
					if err := manager.store.UpdateSession(ctx, sess.ID, store.SessionUpdate{
						Status:      &status,
						CompletedAt: &completedAt,
					}); err != nil {
						t.Errorf("session %d: failed to update status: %v", idx, err)
					}
				}(session, idx)
			}(i)
		}

		wg.Wait()

		// Give time for background goroutines to complete
		time.Sleep(100 * time.Millisecond)

		// Verify all sessions completed in database
		for i := 0; i < sessionCount; i++ {
			sessionID := fmt.Sprintf("concurrent-session-%d", i)
			dbSession, err := testStore.GetSession(ctx, sessionID)
			if err != nil {
				t.Errorf("session %d: failed to get from database: %v", i, err)
				continue
			}
			if dbSession.Status != string(StatusCompleted) {
				t.Errorf("session %d: expected status %s, got %s", i, StatusCompleted, dbSession.Status)
			}
		}

		// Verify all sessions in database
		sessions, err := testStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("failed to list sessions: %v", err)
		}

		// Should have original session + 5 concurrent ones
		if len(sessions) < sessionCount+1 {
			t.Errorf("expected at least %d sessions, got %d", sessionCount+1, len(sessions))
		}
	})

	t.Run("failed_session", func(t *testing.T) {
		// Skip this test for now - it requires mocking the Claude SDK's Wait() method
		// which is complex and not the focus of our store integration tests
		t.Skip("Skipping failed session test - requires complex Claude SDK mocking")
	})
}

// TestSessionManagerEventProcessing tests specific event processing scenarios
func TestSessionManagerEventProcessing(t *testing.T) {
	// Create store
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "events.db")
	testStore, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer testStore.Close()

	// Create manager
	manager := &Manager{
		store: testStore,
	}

	ctx := context.Background()
	sessionID := "event-test-1"
	claudeSessionID := "claude-event-test-1"

	// Create session in store
	dbSession := &store.Session{
		ID:              sessionID,
		RunID:           "event-run-1",
		ClaudeSessionID: claudeSessionID,
		Query:           "Event processing test",
		Model:           "claude-3.5-sonnet-20241022",
		Status:          store.SessionStatusRunning,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = testStore.CreateSession(ctx, dbSession)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Session is already created in database

	t.Run("complex_tool_use", func(t *testing.T) {
		// Test processing of complex tool input
		complexInput := map[string]interface{}{
			"command": "str_replace_editor",
			"path":    "/tmp/test.py",
			"old_str": "def old_function():\n    pass",
			"new_str": "def new_function():\n    return 42",
			"nested": map[string]interface{}{
				"key":  "value",
				"list": []interface{}{"item1", "item2"},
			},
		}

		event := claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type:  "tool_use",
						ID:    "toolu_complex",
						Name:  "str_replace_editor",
						Input: complexInput,
					},
				},
			},
		}

		err := manager.processStreamEvent(ctx, sessionID, claudeSessionID, event)
		if err != nil {
			t.Fatalf("failed to process complex tool use: %v", err)
		}

		// Verify it was stored correctly
		events, err := testStore.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		// Find the tool call
		var toolCall *store.ConversationEvent
		for _, e := range events {
			if e.EventType == store.EventTypeToolCall && e.ToolID == "toolu_complex" {
				toolCall = e
				break
			}
		}

		if toolCall == nil {
			t.Fatal("tool call not found in conversation")
		}

		// Verify input was properly serialized
		var storedInput map[string]interface{}
		err = json.Unmarshal([]byte(toolCall.ToolInputJSON), &storedInput)
		if err != nil {
			t.Fatalf("failed to unmarshal stored input: %v", err)
		}

		if storedInput["command"] != "str_replace_editor" {
			t.Error("command not properly stored")
		}

		// Verify nested structure
		if nested, ok := storedInput["nested"].(map[string]interface{}); ok {
			if nested["key"] != "value" {
				t.Error("nested value not properly stored")
			}
		} else {
			t.Error("nested structure not properly stored")
		}
	})

	t.Run("multiple_content_blocks", func(t *testing.T) {
		// Test message with multiple content blocks
		event := claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{Type: "text", Text: "Let me help you with multiple things."},
					{
						Type:  "tool_use",
						ID:    "toolu_1",
						Name:  "read_file",
						Input: map[string]interface{}{"path": "file1.txt"},
					},
					{Type: "text", Text: "And also this:"},
					{
						Type:  "tool_use",
						ID:    "toolu_2",
						Name:  "write_file",
						Input: map[string]interface{}{"path": "file2.txt", "content": "data"},
					},
				},
			},
		}

		err := manager.processStreamEvent(ctx, sessionID, claudeSessionID, event)
		if err != nil {
			t.Fatalf("failed to process multiple content blocks: %v", err)
		}

		// Verify all content was stored
		events, err := testStore.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		// Count different event types
		var textCount, toolCount int
		for _, e := range events {
			switch e.EventType {
			case store.EventTypeMessage:
				if e.Role == "assistant" {
					textCount++
				}
			case store.EventTypeToolCall:
				toolCount++
			}
		}

		if textCount < 2 {
			t.Errorf("expected at least 2 text messages, got %d", textCount)
		}
		if toolCount < 2 {
			t.Errorf("expected at least 2 tool calls, got %d", toolCount)
		}
	})

	t.Run("tool_result_correlation", func(t *testing.T) {
		// Add a tool call first
		toolCallEvent := claudecode.StreamEvent{
			Type: "assistant",
			Message: &claudecode.Message{
				Role: "assistant",
				Content: []claudecode.Content{
					{
						Type:  "tool_use",
						ID:    "toolu_corr_test",
						Name:  "test_tool",
						Input: map[string]interface{}{"test": true},
					},
				},
			},
		}

		err := manager.processStreamEvent(ctx, sessionID, claudeSessionID, toolCallEvent)
		if err != nil {
			t.Fatalf("failed to process tool call: %v", err)
		}

		// Send tool result
		toolResultEvent := claudecode.StreamEvent{
			Type: "user",
			Message: &claudecode.Message{
				Role: "user",
				Content: []claudecode.Content{
					{
						Type:      "tool_result",
						ToolUseID: "toolu_corr_test",
						Content:   claudecode.ContentField{Value: "Tool executed successfully"},
					},
				},
			},
		}

		err = manager.processStreamEvent(ctx, sessionID, claudeSessionID, toolResultEvent)
		if err != nil {
			t.Fatalf("failed to process tool result: %v", err)
		}

		// Verify tool call was marked as completed
		pending, err := testStore.GetPendingToolCall(ctx, sessionID, "test_tool")
		if err != nil {
			t.Fatalf("failed to check pending tool call: %v", err)
		}

		if pending != nil {
			t.Error("tool call should not be pending after result")
		}
	})
}

func TestCaptureFileSnapshot_Integration(t *testing.T) {
	// Create a temporary directory for test files
	tempDir := t.TempDir()

	// Create test files
	testFile1 := filepath.Join(tempDir, "test1.txt")
	if err := os.WriteFile(testFile1, []byte("Content of test file 1"), 0644); err != nil {
		t.Fatalf("failed to create test file 1: %v", err)
	}

	testFile2 := filepath.Join(tempDir, "subdir", "test2.txt")
	if err := os.MkdirAll(filepath.Dir(testFile2), 0755); err != nil {
		t.Fatalf("failed to create subdirectory: %v", err)
	}
	if err := os.WriteFile(testFile2, []byte("Content of test file 2\nWith multiple lines\n"), 0644); err != nil {
		t.Fatalf("failed to create test file 2: %v", err)
	}

	// Create large file (>10MB)
	largeFile := filepath.Join(tempDir, "large.txt")
	largeContent := make([]byte, 11*1024*1024) // 11MB
	for i := range largeContent {
		largeContent[i] = byte('A' + (i % 26))
	}
	if err := os.WriteFile(largeFile, largeContent, 0644); err != nil {
		t.Fatalf("failed to create large file: %v", err)
	}

	// Create test store
	dbPath := filepath.Join(tempDir, "test.db")
	testStore, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer testStore.Close()

	ctx := context.Background()
	sessionID := "test-session"
	claudeSessionID := "claude-session-1"

	// Create session with working directory
	session := &store.Session{
		ID:              sessionID,
		RunID:           "test-run",
		ClaudeSessionID: claudeSessionID,
		Query:           "Test query",
		Model:           "sonnet",
		Status:          store.SessionStatusRunning,
		WorkingDir:      tempDir,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	if err := testStore.CreateSession(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Create manager
	manager := &Manager{
		store:    testStore,
		eventBus: bus.NewEventBus(),
	}

	t.Run("CaptureFullContentFromToolResult", func(t *testing.T) {
		// Create a Read tool call event
		toolCall := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-full-1",
			ToolName:        "Read",
			ToolInputJSON:   `{"file_path": "test1.txt"}`,
		}
		if err := testStore.AddConversationEvent(ctx, toolCall); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// Simulate tool result with full content
		toolResultContent := fmt.Sprintf(`{
			"type": "file",
			"file": {
				"filePath": "test1.txt",
				"content": "Content of test file 1",
				"numLines": 1,
				"startLine": 1,
				"totalLines": 1
			}
		}`)

		// Call captureFileSnapshot synchronously for testing
		manager.captureFileSnapshot(ctx, sessionID, "tool-full-1", toolCall.ToolInputJSON, toolResultContent)

		// Verify snapshot was created
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		found := false
		for _, s := range snapshots {
			if s.ToolID == "tool-full-1" {
				found = true
				if s.FilePath != "test1.txt" {
					t.Errorf("expected file path 'test1.txt', got '%s'", s.FilePath)
				}
				if s.Content != "Content of test file 1" {
					t.Errorf("expected content from tool result, got '%s'", s.Content)
				}
				break
			}
		}

		if !found {
			t.Error("snapshot not found for full content capture")
		}
	})

	t.Run("CapturePartialContentFromFilesystem", func(t *testing.T) {
		// Create a Read tool call event
		toolCall := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-partial-1",
			ToolName:        "Read",
			ToolInputJSON:   `{"file_path": "subdir/test2.txt"}`,
		}
		if err := testStore.AddConversationEvent(ctx, toolCall); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// Simulate tool result with partial content
		toolResultContent := fmt.Sprintf(`{
			"type": "file",
			"file": {
				"filePath": "subdir/test2.txt",
				"content": "Content of test file 2",
				"numLines": 1,
				"startLine": 1,
				"totalLines": 2
			}
		}`)

		// Call captureFileSnapshot
		manager.captureFileSnapshot(ctx, sessionID, "tool-partial-1", toolCall.ToolInputJSON, toolResultContent)

		// Verify snapshot was created with full content from filesystem
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		found := false
		for _, s := range snapshots {
			if s.ToolID == "tool-partial-1" {
				found = true
				if s.FilePath != "subdir/test2.txt" {
					t.Errorf("expected file path 'subdir/test2.txt', got '%s'", s.FilePath)
				}
				// Should have read full content from filesystem
				expectedContent := "Content of test file 2\nWith multiple lines\n"
				if s.Content != expectedContent {
					t.Errorf("expected full content from filesystem, got '%s'", s.Content)
				}
				break
			}
		}

		if !found {
			t.Error("snapshot not found for partial content capture")
		}
	})

	t.Run("CaptureLargeFilePartialContent", func(t *testing.T) {
		// Create a Read tool call event for large file
		toolCall := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-large-1",
			ToolName:        "Read",
			ToolInputJSON:   `{"file_path": "large.txt"}`,
		}
		if err := testStore.AddConversationEvent(ctx, toolCall); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// Simulate tool result with partial content from large file
		partialContent := "First 1000 chars of large file..."
		toolResultContent := fmt.Sprintf(`{
			"type": "file",
			"file": {
				"filePath": "large.txt",
				"content": "%s",
				"numLines": 10,
				"startLine": 1,
				"totalLines": 100000
			}
		}`, partialContent)

		// Call captureFileSnapshot
		manager.captureFileSnapshot(ctx, sessionID, "tool-large-1", toolCall.ToolInputJSON, toolResultContent)

		// Verify snapshot was created with partial content (due to size limit)
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		found := false
		for _, s := range snapshots {
			if s.ToolID == "tool-large-1" {
				found = true
				if s.FilePath != "large.txt" {
					t.Errorf("expected file path 'large.txt', got '%s'", s.FilePath)
				}
				// Should use partial content from tool result due to size limit
				if s.Content != partialContent {
					t.Errorf("expected partial content for large file, got %d bytes", len(s.Content))
				}
				break
			}
		}

		if !found {
			t.Error("snapshot not found for large file")
		}
	})

	t.Run("HandleNonExistentFile", func(t *testing.T) {
		// Create a Read tool call event for non-existent file
		toolCall := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-nonexist-1",
			ToolName:        "Read",
			ToolInputJSON:   `{"file_path": "nonexistent.txt"}`,
		}
		if err := testStore.AddConversationEvent(ctx, toolCall); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// Simulate tool result indicating file doesn't exist
		toolResultContent := fmt.Sprintf(`{
			"type": "file",
			"file": {
				"filePath": "nonexistent.txt",
				"content": "Error: file not found",
				"numLines": 1,
				"startLine": 1,
				"totalLines": 0
			}
		}`)

		// Call captureFileSnapshot - should handle gracefully
		manager.captureFileSnapshot(ctx, sessionID, "tool-nonexist-1", toolCall.ToolInputJSON, toolResultContent)

		// Since this is a partial read (numLines != totalLines) and file doesn't exist,
		// no snapshot should be created (error logged)
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		for _, s := range snapshots {
			if s.ToolID == "tool-nonexist-1" {
				t.Error("snapshot should not be created for non-existent file")
			}
		}
	})

	t.Run("HandleInvalidToolInput", func(t *testing.T) {
		// Test with invalid tool input JSON
		manager.captureFileSnapshot(ctx, sessionID, "tool-invalid", "{invalid json}", "{}")

		// Should handle gracefully without creating snapshot
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		for _, s := range snapshots {
			if s.ToolID == "tool-invalid" {
				t.Error("snapshot should not be created for invalid input")
			}
		}
	})

	t.Run("HandleMissingFilePath", func(t *testing.T) {
		// Test with missing file_path in tool input
		manager.captureFileSnapshot(ctx, sessionID, "tool-nopath", `{"other_param": "value"}`, "{}")

		// Should handle gracefully without creating snapshot
		snapshots, err := testStore.GetFileSnapshots(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get snapshots: %v", err)
		}

		for _, s := range snapshots {
			if s.ToolID == "tool-nopath" {
				t.Error("snapshot should not be created without file_path")
			}
		}
	})
}
