package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestIntegrationContinueSession(t *testing.T) {
	// Use test-specific socket path
	socketPath := testutil.SocketPath(t, "continue-session")

	// Create daemon components
	eventBus := bus.NewEventBus()
	sqliteStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer func() { _ = sqliteStore.Close() }()

	sessionManager, err := session.NewManager(eventBus, sqliteStore, "")
	if err != nil {
		t.Fatalf("Failed to create session manager: %v", err)
	}

	// Create daemon
	d := &Daemon{
		socketPath: socketPath,
		config:     &config.Config{SocketPath: socketPath, DatabasePath: ":memory:"},
		eventBus:   eventBus,
		store:      sqliteStore,
		sessions:   sessionManager,
		rpcServer:  rpc.NewServer(),
	}

	// Register RPC handlers
	// Pass nil for approval manager since this test doesn't test approval functionality
	sessionHandlers := rpc.NewSessionHandlers(sessionManager, sqliteStore, nil)
	sessionHandlers.Register(d.rpcServer)

	// Start daemon
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := d.Run(ctx); err != nil {
			t.Logf("daemon run error: %v", err)
		}
	}()

	// Wait for daemon to be ready
	time.Sleep(200 * time.Millisecond)

	// Create helper function to send RPC requests
	sendRPC := func(t *testing.T, method string, params interface{}) (json.RawMessage, error) {
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("failed to connect to daemon: %v", err)
		}
		defer func() { _ = conn.Close() }()

		request := map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  method,
			"params":  params,
			"id":      1,
		}

		data, err := json.Marshal(request)
		if err != nil {
			t.Fatalf("failed to marshal request: %v", err)
		}

		if _, err := conn.Write(append(data, '\n')); err != nil {
			t.Fatalf("failed to write request: %v", err)
		}

		scanner := bufio.NewScanner(conn)
		if !scanner.Scan() {
			t.Fatal("no response received")
		}

		var response map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if errObj, ok := response["error"]; ok {
			if errMap, ok := errObj.(map[string]interface{}); ok {
				if msg, ok := errMap["message"].(string); ok {
					return nil, fmt.Errorf("%s", msg)
				}
			}
			return nil, fmt.Errorf("RPC error: %v", errObj)
		}

		if result, ok := response["result"]; ok {
			resultBytes, err := json.Marshal(result)
			if err != nil {
				t.Fatalf("failed to marshal result: %v", err)
			}
			return resultBytes, nil
		}

		return nil, fmt.Errorf("no result in response")
	}

	t.Run("ContinueSession_RequiresCompletedOrRunningParent", func(t *testing.T) {
		// Create a parent session that's failed (should be rejected)
		parentSessionID := "parent-failed"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-parent",
			ClaudeSessionID: "claude-parent",
			Status:          store.SessionStatusFailed, // Neither completed nor running
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Insert parent session directly into database
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Try to continue the failed session
		req := rpc.ContinueSessionRequest{
			SessionID: parentSessionID,
			Query:     "continue this",
		}

		_, err := sendRPC(t, "continueSession", req)
		if err == nil {
			t.Error("Expected error when continuing failed session")
		}
		if err.Error() != "cannot continue session with status failed (must be completed or running)" {
			t.Errorf("Unexpected error: %v", err)
		}
	})

	t.Run("ContinueSession_RequiresClaudeSessionID", func(t *testing.T) {
		// Create a parent session without claude_session_id
		parentSessionID := "parent-no-claude"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-no-claude",
			ClaudeSessionID: "", // Missing
			Status:          store.SessionStatusCompleted,
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		// Insert parent session
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Try to continue without claude_session_id
		req := rpc.ContinueSessionRequest{
			SessionID: parentSessionID,
			Query:     "continue this",
		}

		_, err := sendRPC(t, "continueSession", req)
		if err == nil {
			t.Error("Expected error when continuing session without claude_session_id")
		}
		if err.Error() != "parent session missing claude_session_id (cannot resume)" {
			t.Errorf("Unexpected error: %v", err)
		}
	})

	t.Run("ContinueSession_CreatesChildSession", func(t *testing.T) {
		// Create a valid completed parent session
		parentSessionID := "parent-valid"
		claudeSessionID := "claude-valid"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-valid",
			ClaudeSessionID: claudeSessionID,
			Status:          store.SessionStatusCompleted,
			Query:           "original query",
			Model:           "claude-3-opus",
			WorkingDir:      "/tmp", // Use /tmp as a valid working directory for tests
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		// Insert parent session
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Add some conversation history to parent
		events := []*store.ConversationEvent{
			{
				SessionID:       parentSessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "original query",
			},
			{
				SessionID:       parentSessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeMessage,
				Role:            "assistant",
				Content:         "Original response",
			},
		}

		for _, event := range events {
			if err := d.store.AddConversationEvent(ctx, event); err != nil {
				t.Fatalf("Failed to add conversation event: %v", err)
			}
		}

		// Continue the session with some overrides
		req := rpc.ContinueSessionRequest{
			SessionID:            parentSessionID,
			Query:                "follow up question",
			SystemPrompt:         "You are helpful",
			AppendSystemPrompt:   "Always be polite",
			CustomInstructions:   "Be concise",
			PermissionPromptTool: "hlyr",
			AllowedTools:         []string{"read", "write"},
			DisallowedTools:      []string{"delete"},
			MaxTurns:             3,
		}

		result, err := sendRPC(t, "continueSession", req)
		if err != nil {
			// Expected - Claude binary might not exist in test environment
			expectedErr1 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: exec: \"claude\": executable file not found in $PATH"
			expectedErr2 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: chdir"
			if err.Error() != expectedErr1 && !strings.Contains(err.Error(), expectedErr2) {
				t.Errorf("Unexpected error: %v", err)
			}
			// Even if Claude fails to launch, we should have created the session
			return
		}

		// Parse response
		var resp rpc.ContinueSessionResponse
		if err := json.Unmarshal(result, &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		// Verify response
		if resp.SessionID == "" {
			t.Error("Expected session ID in response")
		}
		if resp.RunID == "" {
			t.Error("Expected run ID in response")
		}
		if resp.ParentSessionID != parentSessionID {
			t.Errorf("Expected parent_session_id %s, got %s", parentSessionID, resp.ParentSessionID)
		}

		// Verify the new session was created with parent reference
		newSession, err := d.store.GetSession(ctx, resp.SessionID)
		if err != nil {
			t.Fatalf("Failed to get new session: %v", err)
		}

		if newSession.ParentSessionID != parentSessionID {
			t.Errorf("Expected parent_session_id %s, got %s", parentSessionID, newSession.ParentSessionID)
		}
		if newSession.Query != "follow up question" {
			t.Errorf("Expected query 'follow up question', got %s", newSession.Query)
		}
		if newSession.SystemPrompt != "You are helpful" {
			t.Errorf("Expected system prompt override, got %s", newSession.SystemPrompt)
		}
		if newSession.AppendSystemPrompt != "Always be polite" {
			t.Errorf("Expected append system prompt, got %s", newSession.AppendSystemPrompt)
		}
		if newSession.CustomInstructions != "Be concise" {
			t.Errorf("Expected custom instructions override, got %s", newSession.CustomInstructions)
		}
		if newSession.PermissionPromptTool != "hlyr" {
			t.Errorf("Expected permission prompt tool, got %s", newSession.PermissionPromptTool)
		}

		// Check allowed tools
		var allowedTools []string
		if err := json.Unmarshal([]byte(newSession.AllowedTools), &allowedTools); err == nil {
			if len(allowedTools) != 2 || allowedTools[0] != "read" || allowedTools[1] != "write" {
				t.Errorf("Expected allowed tools [read, write], got %v", allowedTools)
			}
		}

		// Check disallowed tools
		var disallowedTools []string
		if err := json.Unmarshal([]byte(newSession.DisallowedTools), &disallowedTools); err == nil {
			if len(disallowedTools) != 1 || disallowedTools[0] != "delete" {
				t.Errorf("Expected disallowed tools [delete], got %v", disallowedTools)
			}
		}

		if newSession.MaxTurns != 3 {
			t.Errorf("Expected max turns 3, got %d", newSession.MaxTurns)
		}
	})

	t.Run("ContinueSession_HandlesOptionalMCPConfig", func(t *testing.T) {
		// Create parent session
		parentSessionID := "parent-mcp"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-mcp",
			ClaudeSessionID: "claude-mcp",
			Status:          store.SessionStatusCompleted,
			Query:           "original",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Create MCP config
		mcpConfig := map[string]interface{}{
			"mcpServers": map[string]interface{}{
				"test-server": map[string]interface{}{
					"command": "node",
					"args":    []string{"server.js"},
					"env": map[string]string{
						"TEST": "value",
					},
				},
			},
		}

		mcpConfigJSON, err := json.Marshal(mcpConfig)
		if err != nil {
			t.Fatalf("Failed to marshal MCP config: %v", err)
		}

		// Continue with MCP config
		req := rpc.ContinueSessionRequest{
			SessionID: parentSessionID,
			Query:     "with mcp",
			MCPConfig: string(mcpConfigJSON),
		}

		_, err = sendRPC(t, "continueSession", req)
		// Expected to fail (no Claude binary), but session should be created
		if err != nil && !containsError(err, "failed to launch resumed Claude session") {
			t.Errorf("Unexpected error: %v", err)
		}
	})

	t.Run("GetConversation_IncludesParentHistory", func(t *testing.T) {
		// Create a chain of sessions: grandparent -> parent -> child
		grandparentID := "grandparent"
		parentID := "parent-chain"
		childID := "child"

		// Create grandparent session
		grandparent := &store.Session{
			ID:              grandparentID,
			RunID:           "run-gp",
			ClaudeSessionID: "claude-gp",
			Status:          store.SessionStatusCompleted,
			Query:           "grandparent query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}
		if err := d.store.CreateSession(ctx, grandparent); err != nil {
			t.Fatalf("Failed to create grandparent: %v", err)
		}

		// Add grandparent events
		gpEvents := []*store.ConversationEvent{
			{
				SessionID:       grandparentID,
				ClaudeSessionID: "claude-gp",
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "grandparent query",
			},
			{
				SessionID:       grandparentID,
				ClaudeSessionID: "claude-gp",
				EventType:       store.EventTypeMessage,
				Role:            "assistant",
				Content:         "grandparent response",
			},
		}
		for _, event := range gpEvents {
			if err := d.store.AddConversationEvent(ctx, event); err != nil {
				t.Fatalf("Failed to add grandparent event: %v", err)
			}
		}

		// Create parent session
		parent := &store.Session{
			ID:              parentID,
			RunID:           "run-p",
			ClaudeSessionID: "claude-p",
			ParentSessionID: grandparentID,
			Status:          store.SessionStatusCompleted,
			Query:           "parent query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}
		if err := d.store.CreateSession(ctx, parent); err != nil {
			t.Fatalf("Failed to create parent: %v", err)
		}

		// Add parent events
		pEvents := []*store.ConversationEvent{
			{
				SessionID:       parentID,
				ClaudeSessionID: "claude-p",
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "parent query",
			},
			{
				SessionID:       parentID,
				ClaudeSessionID: "claude-p",
				EventType:       store.EventTypeMessage,
				Role:            "assistant",
				Content:         "parent response",
			},
		}
		for _, event := range pEvents {
			if err := d.store.AddConversationEvent(ctx, event); err != nil {
				t.Fatalf("Failed to add parent event: %v", err)
			}
		}

		// Create child session
		child := &store.Session{
			ID:              childID,
			RunID:           "run-c",
			ClaudeSessionID: "claude-c",
			ParentSessionID: parentID,
			Status:          store.SessionStatusCompleted,
			Query:           "child query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}
		if err := d.store.CreateSession(ctx, child); err != nil {
			t.Fatalf("Failed to create child: %v", err)
		}

		// Add child events
		cEvents := []*store.ConversationEvent{
			{
				SessionID:       childID,
				ClaudeSessionID: "claude-c",
				EventType:       store.EventTypeMessage,
				Role:            "user",
				Content:         "child query",
			},
			{
				SessionID:       childID,
				ClaudeSessionID: "claude-c",
				EventType:       store.EventTypeMessage,
				Role:            "assistant",
				Content:         "child response",
			},
		}
		for _, event := range cEvents {
			if err := d.store.AddConversationEvent(ctx, event); err != nil {
				t.Fatalf("Failed to add child event: %v", err)
			}
		}

		// Get conversation for child session - should include full history
		req := rpc.GetConversationRequest{
			SessionID: childID,
		}
		result, err := sendRPC(t, "getConversation", req)
		if err != nil {
			t.Fatalf("Failed to get conversation: %v", err)
		}

		// Parse response
		var conversation rpc.GetConversationResponse
		if err := json.Unmarshal(result, &conversation); err != nil {
			t.Fatalf("Failed to unmarshal conversation: %v", err)
		}

		// Verify we got all events in correct order
		if len(conversation.Events) != 6 {
			t.Errorf("Expected 6 events (2 from each session), got %d", len(conversation.Events))
		}

		// Verify chronological order
		expectedContents := []string{
			"grandparent query",
			"grandparent response",
			"parent query",
			"parent response",
			"child query",
			"child response",
		}

		for i, event := range conversation.Events {
			if i < len(expectedContents) && event.Content != expectedContents[i] {
				t.Errorf("Event %d: expected content '%s', got '%s'",
					i, expectedContents[i], event.Content)
			}
		}
	})
}

func containsError(err error, substr string) bool {
	if err == nil {
		return false
	}
	return len(err.Error()) >= len(substr) && contains(err.Error(), substr)
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
