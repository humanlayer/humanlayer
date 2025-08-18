//go:build integration

package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestIntegrationContinueSession(t *testing.T) {
	// Create test database path
	dbPath := testutil.DatabasePath(t, "continue-session")
	httpPort := getFreePort(t)

	// Set environment variables for daemon config
	oldDBPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	oldHTTPPort := os.Getenv("HUMANLAYER_DAEMON_HTTP_PORT")
	oldHTTPHost := os.Getenv("HUMANLAYER_DAEMON_HTTP_HOST")

	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	t.Cleanup(func() {
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
	})

	// Create daemon using New() which properly initializes everything
	d, err := New()
	if err != nil {
		t.Fatalf("failed to create daemon: %v", err)
	}

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
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
	if !httpReady {
		t.Fatal("HTTP server failed to start")
	}

	// Create HTTP client
	client := &http.Client{}

	t.Run("ContinueSession_AllowsFailedSessionWithClaudeID", func(t *testing.T) {
		// Create a parent session that's failed with valid claude_session_id (should be allowed)
		parentSessionID := "parent-failed-valid"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-parent",
			ClaudeSessionID: "claude-parent",
			Status:          store.SessionStatusFailed,
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Insert parent session directly into database
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Try to continue the failed session - should now succeed (or fail with Claude launch error)
		req := api.ContinueSessionRequest{
			Query: "continue this",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode == 201 {
			// Success - session was continued
			var continueResp api.ContinueSessionResponse
			if err := json.NewDecoder(resp.Body).Decode(&continueResp); err != nil {
				t.Fatalf("Failed to decode continue response: %v", err)
			}
		} else if resp.StatusCode == 500 {
			// Expected - Claude binary might not exist in test environment
			var errResp struct {
				Error api.ErrorDetail `json:"error"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
				expectedErr1 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: exec: \"claude\": executable file not found in $PATH"
				expectedErr2 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: chdir"
				if errResp.Error.Message != expectedErr1 && !strings.Contains(errResp.Error.Message, expectedErr2) {
					t.Errorf("Unexpected error: %v", errResp.Error.Message)
				}
			}
		} else {
			t.Errorf("Unexpected status code: %d", resp.StatusCode)
		}
	})

	t.Run("ContinueSession_RejectsFailedSessionWithoutClaudeID", func(t *testing.T) {
		// Create a parent session that's failed WITHOUT claude_session_id (should still be rejected)
		parentSessionID := "parent-failed-no-claude"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-parent-no-claude",
			ClaudeSessionID: "", // Missing claude_session_id
			Status:          store.SessionStatusFailed,
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Insert parent session directly into database
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Try to continue the failed session without claude_session_id
		req := api.ContinueSessionRequest{
			Query: "continue this",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		// The REST API returns 500 for validation errors
		if resp.StatusCode != 500 {
			t.Errorf("Expected 500 status, got %d", resp.StatusCode)
		}

		var errResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
			if !strings.Contains(errResp.Error.Message, "parent session missing claude_session_id") {
				t.Errorf("Unexpected error: %v", errResp.Error.Message)
			}
		}
	})

	t.Run("ContinueSession_RejectsInvalidStatus", func(t *testing.T) {
		// Create a parent session with an invalid status (e.g., starting)
		parentSessionID := "parent-invalid-status"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-invalid",
			ClaudeSessionID: "claude-invalid",
			Status:          store.SessionStatusStarting, // Invalid status for continuation
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Insert parent session
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Try to continue with invalid status
		req := api.ContinueSessionRequest{
			Query: "continue this",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		// The REST API returns 500 for validation errors
		if resp.StatusCode != 500 {
			t.Errorf("Expected 500 status, got %d", resp.StatusCode)
		}

		var errResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
			if !strings.Contains(errResp.Error.Message, "cannot continue session with status starting") {
				t.Errorf("Unexpected error: %v", errResp.Error.Message)
			}
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
		req := api.ContinueSessionRequest{
			Query: "continue this",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		// The REST API returns 500 for validation errors
		if resp.StatusCode != 500 {
			t.Errorf("Expected 500 status, got %d", resp.StatusCode)
		}

		var errResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
			if !strings.Contains(errResp.Error.Message, "parent session missing claude_session_id") {
				t.Errorf("Unexpected error: %v", errResp.Error.Message)
			}
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
		req := api.ContinueSessionRequest{
			Query:                "follow up question",
			SystemPrompt:         stringPtr("You are helpful"),
			AppendSystemPrompt:   stringPtr("Always be polite"),
			CustomInstructions:   stringPtr("Be concise"),
			PermissionPromptTool: stringPtr("hlyr"),
			AllowedTools:         &[]string{"read", "write"},
			DisallowedTools:      &[]string{"delete"},
			MaxTurns:             intPtr(3),
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode == 201 {
			// Parse response
			var continueResp api.ContinueSessionResponse
			if err := json.NewDecoder(resp.Body).Decode(&continueResp); err != nil {
				t.Fatalf("Failed to unmarshal response: %v", err)
			}

			// Verify response
			if continueResp.Data.SessionId == "" {
				t.Error("Expected session ID in response")
			}
			if continueResp.Data.RunId == "" {
				t.Error("Expected run ID in response")
			}
			if continueResp.Data.ParentSessionId != parentSessionID {
				t.Errorf("Expected parent_session_id %s, got %s", parentSessionID, continueResp.Data.ParentSessionId)
			}

			// Verify the new session was created with parent reference
			newSession, err := d.store.GetSession(ctx, continueResp.Data.SessionId)
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
		} else if resp.StatusCode == 500 {
			// Expected - Claude binary might not exist in test environment
			var errResp struct {
				Error api.ErrorDetail `json:"error"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&errResp); err == nil {
				expectedErr1 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: exec: \"claude\": executable file not found in $PATH"
				expectedErr2 := "failed to continue session: failed to launch resumed Claude session: failed to start claude: chdir"
				if errResp.Error.Message != expectedErr1 && !strings.Contains(errResp.Error.Message, expectedErr2) {
					t.Errorf("Unexpected error: %v", errResp.Error.Message)
				}
				// Even if Claude fails to launch, we should have created the session
			}
		} else {
			t.Errorf("Unexpected status code: %d", resp.StatusCode)
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
		mcpServers := map[string]api.MCPServer{
			"test-server": {
				Command: stringPtr("node"),
				Args:    &[]string{"server.js"},
				Env: &map[string]string{
					"TEST": "value",
				},
			},
		}
		mcpConfig := api.MCPConfig{
			McpServers: &mcpServers,
		}

		// Continue with MCP config
		req := api.ContinueSessionRequest{
			Query:     "with mcp",
			McpConfig: &mcpConfig,
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		// Expected to fail (no Claude binary) or succeed, but session should be created
		if resp.StatusCode != 201 && resp.StatusCode != 500 {
			t.Errorf("Unexpected status code: %d", resp.StatusCode)
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
		resp, err := client.Get(fmt.Sprintf("%s/sessions/%s/messages", baseURL, childID))
		if err != nil {
			t.Fatalf("Failed to get conversation: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			t.Fatalf("Expected status 200, got %d", resp.StatusCode)
		}

		// Parse response
		var messagesResp api.ConversationResponse
		if err := json.NewDecoder(resp.Body).Decode(&messagesResp); err != nil {
			t.Fatalf("Failed to unmarshal conversation: %v", err)
		}

		// Verify we got all events in correct order
		if len(messagesResp.Data) != 6 {
			t.Errorf("Expected 6 events (2 from each session), got %d", len(messagesResp.Data))
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

		for i, event := range messagesResp.Data {
			if i < len(expectedContents) {
				if event.Content == nil {
					t.Errorf("Event %d: content is nil, expected '%s'", i, expectedContents[i])
				} else if *event.Content != expectedContents[i] {
					t.Errorf("Event %d: expected content '%s', got '%s'",
						i, expectedContents[i], *event.Content)
				}
			}
		}
	})

	t.Run("ContinueSession_InheritsTitle", func(t *testing.T) {
		// Create parent session with title
		parentSessionID := "parent-title-test"
		parentTitle := "Production Deployment Task"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-title",
			ClaudeSessionID: "claude-title",
			Status:          store.SessionStatusCompleted,
			Query:           "deploy to production",
			Title:           parentTitle,
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		// Insert parent session
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue the session
		req := api.ContinueSessionRequest{
			Query: "check deployment status",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 201 && resp.StatusCode != 500 {
			t.Errorf("Unexpected status code: %d", resp.StatusCode)
		}

		// Get all sessions to find the child
		sessions, err := d.store.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		// Find the child session
		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Verify title was inherited
		if childSession.Title != parentTitle {
			t.Errorf("Title not inherited: got %q, want %q", childSession.Title, parentTitle)
		}
	})

	t.Run("ContinueSession_TitlePersistsAfterUpdate", func(t *testing.T) {
		// Create parent session with title
		parentSessionID := "parent-title-update"
		originalTitle := "Original Task"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-update",
			ClaudeSessionID: "claude-update",
			Status:          store.SessionStatusCompleted,
			Query:           "original task",
			Title:           originalTitle,
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue the session
		req := api.ContinueSessionRequest{
			Query: "continue task",
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(
			fmt.Sprintf("%s/sessions/%s/continue", baseURL, parentSessionID),
			"application/json",
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to continue session: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 201 && resp.StatusCode != 500 {
			t.Errorf("Unexpected status code: %d", resp.StatusCode)
		}

		// Find the child session
		sessions, err := d.store.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Update the child session's title
		updatedTitle := "Updated Task Title"
		updateReq := api.UpdateSessionRequest{
			Title: &updatedTitle,
		}

		body, _ = json.Marshal(updateReq)
		httpReq, err := http.NewRequest(
			"PATCH",
			fmt.Sprintf("%s/sessions/%s", baseURL, childSession.ID),
			bytes.NewReader(body),
		)
		if err != nil {
			t.Fatalf("Failed to create request: %v", err)
		}
		httpReq.Header.Set("Content-Type", "application/json")
		resp, err = client.Do(httpReq)
		if err != nil {
			t.Fatalf("Failed to update session title: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			t.Fatalf("Expected status 200, got %d", resp.StatusCode)
		}

		// Verify the child's title was updated
		childSession, err = d.store.GetSession(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get updated child session: %v", err)
		}

		if childSession.Title != updatedTitle {
			t.Errorf("Child title not updated: got %q, want %q", childSession.Title, updatedTitle)
		}

		// Verify parent title remains unchanged
		parentSession, err = d.store.GetSession(ctx, parentSessionID)
		if err != nil {
			t.Fatalf("Failed to get parent session: %v", err)
		}

		if parentSession.Title != originalTitle {
			t.Errorf("Parent title changed unexpectedly: got %q, want %q",
				parentSession.Title, originalTitle)
		}
	})

	// Cleanup
	cancel()
	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled {
			t.Errorf("daemon error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon shutdown timeout")
	}
}

// Helper functions
func stringPtr(s string) *string {
	return &s
}

func intPtr(i int) *int {
	return &i
}
