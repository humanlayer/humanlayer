package session

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestContinueSessionInheritance(t *testing.T) {
	ctx := context.Background()

	// Create test components
	eventBus := bus.NewEventBus()
	sqliteStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer func() { _ = sqliteStore.Close() }()

	manager, err := NewManager(eventBus, sqliteStore, "")
	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	t.Run("InheritsAllConfigurationFields", func(t *testing.T) {
		// Create parent session with full configuration
		parentSessionID := "parent-full-config"
		parentSession := &store.Session{
			ID:                   parentSessionID,
			RunID:                "run-parent",
			ClaudeSessionID:      "claude-parent",
			Status:               store.SessionStatusCompleted,
			Query:                "original query",
			Model:                "claude-3-opus-20240229",
			WorkingDir:           "/tmp/test",
			MaxTurns:             10,
			SystemPrompt:         "You are a helpful assistant",
			AppendSystemPrompt:   "Be concise",
			CustomInstructions:   "Follow best practices",
			PermissionPromptTool: "hlyr",
			AllowedTools:         `["tool1", "tool2"]`,
			DisallowedTools:      `["tool3"]`,
			Title:                "Test Session Title",
			CreatedAt:            time.Now(),
			LastActivityAt:       time.Now(),
			CompletedAt:          &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session with minimal config (only required fields)
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "follow up question",
		}

		// This will fail because Claude binary doesn't exist in test env,
		// but we can still check that the config was built correctly
		_, _ = manager.ContinueSession(ctx, req)

		// We expect it to fail at launch, but let's check the session was created with inherited config
		sessions, err := sqliteStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		// Should have parent and child sessions
		if len(sessions) < 2 {
			t.Fatalf("Expected at least 2 sessions, got %d", len(sessions))
		}

		// Find the child session (most recent)
		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
			return // this return exists purely to satisfy the linter
		}

		// Verify all fields were inherited
		if childSession.Model != parentSession.Model {
			t.Errorf("Model not inherited: got %s, want %s", childSession.Model, parentSession.Model)
		}
		if childSession.WorkingDir != parentSession.WorkingDir {
			t.Errorf("WorkingDir not inherited: got %s, want %s", childSession.WorkingDir, parentSession.WorkingDir)
		}
		if childSession.SystemPrompt != parentSession.SystemPrompt {
			t.Errorf("SystemPrompt not inherited: got %s, want %s", childSession.SystemPrompt, parentSession.SystemPrompt)
		}
		if childSession.AppendSystemPrompt != parentSession.AppendSystemPrompt {
			t.Errorf("AppendSystemPrompt not inherited: got %s, want %s", childSession.AppendSystemPrompt, parentSession.AppendSystemPrompt)
		}
		if childSession.CustomInstructions != parentSession.CustomInstructions {
			t.Errorf("CustomInstructions not inherited: got %s, want %s", childSession.CustomInstructions, parentSession.CustomInstructions)
		}
		if childSession.PermissionPromptTool != parentSession.PermissionPromptTool {
			t.Errorf("PermissionPromptTool not inherited: got %s, want %s", childSession.PermissionPromptTool, parentSession.PermissionPromptTool)
		}
		// Compare allowed tools (deserialize to compare content, not formatting)
		var childAllowed, parentAllowed []string
		if err := json.Unmarshal([]byte(childSession.AllowedTools), &childAllowed); err != nil {
			t.Fatalf("Failed to unmarshal child allowed tools: %v", err)
		}
		if err := json.Unmarshal([]byte(parentSession.AllowedTools), &parentAllowed); err != nil {
			t.Fatalf("Failed to unmarshal parent allowed tools: %v", err)
		}
		if len(childAllowed) != len(parentAllowed) {
			t.Errorf("AllowedTools length mismatch: got %d, want %d", len(childAllowed), len(parentAllowed))
		} else {
			for i, tool := range childAllowed {
				if tool != parentAllowed[i] {
					t.Errorf("AllowedTools[%d] not inherited: got %s, want %s", i, tool, parentAllowed[i])
				}
			}
		}

		// Compare disallowed tools
		var childDisallowed, parentDisallowed []string
		if err := json.Unmarshal([]byte(childSession.DisallowedTools), &childDisallowed); err != nil {
			t.Fatalf("Failed to unmarshal child disallowed tools: %v", err)
		}
		if err := json.Unmarshal([]byte(parentSession.DisallowedTools), &parentDisallowed); err != nil {
			t.Fatalf("Failed to unmarshal parent disallowed tools: %v", err)
		}
		if len(childDisallowed) != len(parentDisallowed) {
			t.Errorf("DisallowedTools length mismatch: got %d, want %d", len(childDisallowed), len(parentDisallowed))
		} else {
			for i, tool := range childDisallowed {
				if tool != parentDisallowed[i] {
					t.Errorf("DisallowedTools[%d] not inherited: got %s, want %s", i, tool, parentDisallowed[i])
				}
			}
		}

		// Verify title was inherited
		if childSession.Title != parentSession.Title {
			t.Errorf("Title not inherited: got %s, want %s", childSession.Title, parentSession.Title)
		}

		// MaxTurns should NOT be inherited (as per spec)
		if childSession.MaxTurns == parentSession.MaxTurns {
			t.Error("MaxTurns should not be inherited")
		}
	})

	t.Run("InheritsTitle", func(t *testing.T) {
		// Create parent session with title
		parentSessionID := "parent-with-title"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-title",
			ClaudeSessionID: "claude-title",
			Status:          store.SessionStatusCompleted,
			Query:           "original query",
			Title:           "My Important Task",
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/tmp/test",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue working",
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return // this return exists purely to satisfy the linter
		}

		// Verify title was inherited
		if childSession.Title != parentSession.Title {
			t.Errorf("Title not inherited: got %q, want %q", childSession.Title, parentSession.Title)
		}
	})

	t.Run("InheritsEmptyTitle", func(t *testing.T) {
		// Create parent session with empty title
		parentSessionID := "parent-empty-title"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-empty-title",
			ClaudeSessionID: "claude-empty-title",
			Status:          store.SessionStatusCompleted,
			Query:           "original query",
			Title:           "", // Empty title
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/tmp/test",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue working",
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return // this return exists purely to satisfy the linter
		}

		// Verify empty title was inherited (should be empty)
		if childSession.Title != "" {
			t.Errorf("Empty title not inherited correctly: got %q, want empty string", childSession.Title)
		}
	})

	t.Run("InheritsMCPServers", func(t *testing.T) {
		// Create parent session
		parentSessionID := "parent-mcp"
		parentSession := &store.Session{
			ID:                   parentSessionID,
			RunID:                "run-mcp",
			ClaudeSessionID:      "claude-mcp",
			Status:               store.SessionStatusCompleted,
			Query:                "mcp query",
			Model:                "claude-3-opus-20240229",
			WorkingDir:           "/tmp/test",
			SystemPrompt:         "Test prompt",
			PermissionPromptTool: "hlyr",
			CreatedAt:            time.Now(),
			LastActivityAt:       time.Now(),
			CompletedAt:          &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Store MCP servers for parent
		mcpServers := []store.MCPServer{
			{
				SessionID: parentSessionID,
				Name:      "test-server-1",
				Command:   "node",
				ArgsJSON:  `["server1.js", "--port", "3000"]`,
				EnvJSON:   `{"NODE_ENV": "test", "API_KEY": "secret"}`,
			},
			{
				SessionID: parentSessionID,
				Name:      "test-server-2",
				Command:   "python",
				ArgsJSON:  `["server2.py"]`,
				EnvJSON:   `{"PYTHONPATH": "/usr/lib"}`,
			},
		}
		if err := sqliteStore.StoreMCPServers(ctx, parentSessionID, mcpServers); err != nil {
			t.Fatalf("Failed to store MCP servers: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "mcp follow up",
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return // this return exists purely to satisfy the linter
		}

		// Get MCP servers for child session
		childMCPServers, err := sqliteStore.GetMCPServers(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get child MCP servers: %v", err)
		}

		// Should have inherited the MCP servers plus injected codelayer
		expectedCount := len(mcpServers) + 1 // +1 for injected codelayer
		if len(childMCPServers) != expectedCount {
			t.Errorf("MCP servers count mismatch: got %d, want %d", len(childMCPServers), expectedCount)
		}

		// Find and verify the injected codelayer server
		var foundCodelayer bool
		var codelayerIdx int
		for i, server := range childMCPServers {
			if server.Name == "codelayer" {
				foundCodelayer = true
				codelayerIdx = i

				// Verify codelayer configuration
				if server.Command != "hlyr" {
					t.Errorf("Codelayer command mismatch: got %s, want hlyr", server.Command)
				}

				var args []string
				if err := json.Unmarshal([]byte(server.ArgsJSON), &args); err != nil {
					t.Fatalf("Failed to unmarshal codelayer args: %v", err)
				}
				expectedArgs := []string{"mcp", "claude_approvals"}
				if len(args) != len(expectedArgs) {
					t.Errorf("Codelayer args length mismatch: got %d, want %d", len(args), len(expectedArgs))
				} else {
					for j, arg := range args {
						if arg != expectedArgs[j] {
							t.Errorf("Codelayer arg[%d] mismatch: got %s, want %s", j, arg, expectedArgs[j])
						}
					}
				}

				var env map[string]string
				if err := json.Unmarshal([]byte(server.EnvJSON), &env); err != nil {
					t.Fatalf("Failed to unmarshal codelayer env: %v", err)
				}
				if env["HUMANLAYER_SESSION_ID"] != childSession.ID {
					t.Errorf("Codelayer env HUMANLAYER_SESSION_ID mismatch: got %s, want %s", env["HUMANLAYER_SESSION_ID"], childSession.ID)
				}
				break
			}
		}

		if !foundCodelayer {
			t.Error("Injected codelayer MCP server not found")
		}

		// Verify inherited servers (excluding codelayer)
		parentIdx := 0
		for i, server := range childMCPServers {
			// Skip the codelayer server
			if i == codelayerIdx {
				continue
			}

			if parentIdx >= len(mcpServers) {
				t.Errorf("Extra unexpected MCP server found: %s", server.Name)
				continue
			}

			if server.Name != mcpServers[parentIdx].Name {
				t.Errorf("MCP server %d name mismatch: got %s, want %s", parentIdx, server.Name, mcpServers[parentIdx].Name)
			}
			if server.Command != mcpServers[parentIdx].Command {
				t.Errorf("MCP server %d command mismatch: got %s, want %s", parentIdx, server.Command, mcpServers[parentIdx].Command)
			}

			// Compare args (deserialize to compare content)
			var childArgs, parentArgs []string
			if err := json.Unmarshal([]byte(server.ArgsJSON), &childArgs); err != nil {
				t.Fatalf("Failed to unmarshal child args: %v", err)
			}
			if err := json.Unmarshal([]byte(mcpServers[parentIdx].ArgsJSON), &parentArgs); err != nil {
				t.Fatalf("Failed to unmarshal parent args: %v", err)
			}
			if len(childArgs) != len(parentArgs) {
				t.Errorf("MCP server %d args length mismatch", parentIdx)
			} else {
				for j, arg := range childArgs {
					if arg != parentArgs[j] {
						t.Errorf("MCP server %d arg[%d] mismatch: got %s, want %s", parentIdx, j, arg, parentArgs[j])
					}
				}
			}

			// Compare env (deserialize and check that parent env is subset of child env)
			var childEnv, parentEnv map[string]string
			if err := json.Unmarshal([]byte(server.EnvJSON), &childEnv); err != nil {
				t.Fatalf("Failed to unmarshal child env: %v", err)
			}
			if err := json.Unmarshal([]byte(mcpServers[parentIdx].EnvJSON), &parentEnv); err != nil {
				t.Fatalf("Failed to unmarshal parent env: %v", err)
			}

			// Child should have all parent env vars plus HUMANLAYER_RUN_ID
			for key, val := range parentEnv {
				if childEnv[key] != val {
					t.Errorf("MCP server %d env[%s] mismatch: got %s, want %s", parentIdx, key, childEnv[key], val)
				}
			}

			// Should have HUMANLAYER_RUN_ID added
			if _, ok := childEnv["HUMANLAYER_RUN_ID"]; !ok {
				t.Errorf("MCP server %d missing HUMANLAYER_RUN_ID in env", parentIdx)
			}

			parentIdx++
		}
	})

	t.Run("OverridesWorkCorrectly", func(t *testing.T) {
		// Create parent session
		parentSessionID := "parent-override"
		parentSession := &store.Session{
			ID:                   parentSessionID,
			RunID:                "run-override",
			ClaudeSessionID:      "claude-override",
			Status:               store.SessionStatusCompleted,
			Query:                "original",
			Model:                "claude-3-opus-20240229",
			WorkingDir:           "/tmp/test",
			SystemPrompt:         "Original system prompt",
			AppendSystemPrompt:   "Original append",
			CustomInstructions:   "Original instructions",
			PermissionPromptTool: "original-tool",
			AllowedTools:         `["original1", "original2"]`,
			DisallowedTools:      `["original3"]`,
			CreatedAt:            time.Now(),
			LastActivityAt:       time.Now(),
			CompletedAt:          &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue with overrides
		req := ContinueSessionConfig{
			ParentSessionID:      parentSessionID,
			Query:                "override query",
			SystemPrompt:         "Override system prompt",
			AppendSystemPrompt:   "Override append",
			CustomInstructions:   "Override instructions",
			PermissionPromptTool: "override-tool",
			AllowedTools:         []string{"override1", "override2", "override3"},
			DisallowedTools:      []string{"override4", "override5"},
			MaxTurns:             5,
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return // this return exists purely to satisfy the linter
		}

		// Verify overrides were applied
		if childSession.SystemPrompt != "Override system prompt" {
			t.Errorf("SystemPrompt override failed: got %s", childSession.SystemPrompt)
		}
		if childSession.AppendSystemPrompt != "Override append" {
			t.Errorf("AppendSystemPrompt override failed: got %s", childSession.AppendSystemPrompt)
		}
		if childSession.CustomInstructions != "Override instructions" {
			t.Errorf("CustomInstructions override failed: got %s", childSession.CustomInstructions)
		}
		if childSession.PermissionPromptTool != "override-tool" {
			t.Errorf("PermissionPromptTool override failed: got %s", childSession.PermissionPromptTool)
		}

		// Check allowed tools
		var allowedTools []string
		if err := json.Unmarshal([]byte(childSession.AllowedTools), &allowedTools); err != nil {
			t.Fatalf("Failed to unmarshal AllowedTools: %v", err)
		}
		if len(allowedTools) != 3 || allowedTools[0] != "override1" {
			t.Errorf("AllowedTools override failed: got %v", allowedTools)
		}

		// Check disallowed tools
		var disallowedTools []string
		if err := json.Unmarshal([]byte(childSession.DisallowedTools), &disallowedTools); err != nil {
			t.Fatalf("Failed to unmarshal DisallowedTools: %v", err)
		}
		if len(disallowedTools) != 2 || disallowedTools[0] != "override4" {
			t.Errorf("DisallowedTools override failed: got %v", disallowedTools)
		}

		if childSession.MaxTurns != 5 {
			t.Errorf("MaxTurns override failed: got %d", childSession.MaxTurns)
		}
	})

	t.Run("MCPConfigOverride", func(t *testing.T) {
		// Create parent session with MCP
		parentSessionID := "parent-mcp-override"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-mcp-override",
			ClaudeSessionID: "claude-mcp-override",
			Status:          store.SessionStatusCompleted,
			Query:           "original",
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/tmp/test",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Store original MCP servers
		originalServers := []store.MCPServer{
			{
				SessionID: parentSessionID,
				Name:      "original-server",
				Command:   "original-cmd",
				ArgsJSON:  `["original"]`,
				EnvJSON:   `{"ORIGINAL": "true"}`,
			},
		}
		if err := sqliteStore.StoreMCPServers(ctx, parentSessionID, originalServers); err != nil {
			t.Fatalf("Failed to store MCP servers: %v", err)
		}

		// Continue with MCP override
		overrideMCP := &claudecode.MCPConfig{
			MCPServers: map[string]claudecode.MCPServer{
				"override-server": {
					Command: "override-cmd",
					Args:    []string{"override"},
					Env:     map[string]string{"OVERRIDE": "true"},
				},
			},
		}

		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "override query",
			MCPConfig:       overrideMCP,
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return // this return exists purely to satisfy the linter
		}

		// Get MCP servers for child
		childMCPServers, err := sqliteStore.GetMCPServers(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get child MCP servers: %v", err)
		}

		// Should have the override server plus injected codelayer
		if len(childMCPServers) != 2 {
			t.Fatalf("Expected 2 MCP servers (override + codelayer), got %d", len(childMCPServers))
		}

		// Find the override server (not codelayer)
		var overrideServer *store.MCPServer
		for _, s := range childMCPServers {
			if s.Name == "override-server" {
				overrideServer = &s
				break
			}
		}

		if overrideServer == nil {
			t.Fatal("Override server not found")
		}

		if overrideServer.Command != "override-cmd" {
			t.Errorf("MCP server command not overridden: got %s", overrideServer.Command)
		}
	})

	t.Run("TitleInheritanceEdgeCases", func(t *testing.T) {
		tests := []struct {
			name        string
			parentTitle string
			expectTitle string
			description string
		}{
			{
				name:        "whitespace_only_title",
				parentTitle: "   ",
				expectTitle: "   ",
				description: "Whitespace-only titles should be preserved as-is",
			},
			{
				name:        "unicode_emoji_title",
				parentTitle: "Deploy 🚀 Production 🔥",
				expectTitle: "Deploy 🚀 Production 🔥",
				description: "Unicode characters and emojis should be preserved",
			},
			{
				name:        "very_long_title",
				parentTitle: strings.Repeat("a", 1000),
				expectTitle: strings.Repeat("a", 1000),
				description: "Long titles should be inherited without truncation",
			},
			{
				name:        "title_with_special_chars",
				parentTitle: "Task: Deploy \"v1.2.3\" -> Production (HIGH PRIORITY)",
				expectTitle: "Task: Deploy \"v1.2.3\" -> Production (HIGH PRIORITY)",
				description: "Special characters should be preserved",
			},
			{
				name:        "multiline_title",
				parentTitle: "Line 1\nLine 2\nLine 3",
				expectTitle: "Line 1\nLine 2\nLine 3",
				description: "Multiline titles should be preserved",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				// Create parent session with specific title
				parentSessionID := "parent-" + tt.name
				parentSession := &store.Session{
					ID:              parentSessionID,
					RunID:           "run-" + tt.name,
					ClaudeSessionID: "claude-" + tt.name,
					Status:          store.SessionStatusCompleted,
					Query:           "test query",
					Title:           tt.parentTitle,
					Model:           "claude-3-opus-20240229",
					WorkingDir:      "/tmp/test",
					CreatedAt:       time.Now(),
					LastActivityAt:  time.Now(),
					CompletedAt:     &time.Time{},
				}

				if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
					t.Fatalf("Failed to create parent session: %v", err)
				}

				// Continue session
				req := ContinueSessionConfig{
					ParentSessionID: parentSessionID,
					Query:           "continue",
				}

				_, _ = manager.ContinueSession(ctx, req)
				// Expected to fail due to missing Claude binary

				// Find the child session
				sessions, err := sqliteStore.ListSessions(ctx)
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
					return // this return exists purely to satisfy the linter
				}

				// Verify title was inherited correctly
				if childSession.Title != tt.expectTitle {
					t.Errorf("%s: got title %q, want %q", tt.description, childSession.Title, tt.expectTitle)
				}
			})
		}
	})

	t.Run("MultipleContinuations", func(t *testing.T) {
		// Test that titles are inherited through multiple generations
		// grandparent -> parent -> child

		// Create grandparent
		grandparentID := "grandparent-title"
		grandparentTitle := "Original Family Task"
		grandparent := &store.Session{
			ID:              grandparentID,
			RunID:           "run-gp",
			ClaudeSessionID: "claude-gp",
			Status:          store.SessionStatusCompleted,
			Query:           "start task",
			Title:           grandparentTitle,
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/tmp/test",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, grandparent); err != nil {
			t.Fatalf("Failed to create grandparent session: %v", err)
		}

		// Continue to create parent
		parentReq := ContinueSessionConfig{
			ParentSessionID: grandparentID,
			Query:           "continue to parent",
		}
		_, _ = manager.ContinueSession(ctx, parentReq)

		// Find parent session
		var parentSession *store.Session
		sessions, _ := sqliteStore.ListSessions(ctx)
		for _, s := range sessions {
			if s.ParentSessionID == grandparentID {
				parentSession = s
				break
			}
		}

		if parentSession == nil {
			t.Fatal("Parent session not found")
			return // this return exists purely to satisfy the linter
		}

		// Verify parent inherited title
		if parentSession.Title != grandparentTitle {
			t.Errorf("Parent didn't inherit title: got %q, want %q", parentSession.Title, grandparentTitle)
		}

		// Mark parent as completed for next continuation
		completedStatus := store.SessionStatusCompleted
		claudeID := "claude-parent"
		now := time.Now()
		update := store.SessionUpdate{
			Status:          &completedStatus,
			ClaudeSessionID: &claudeID,
			CompletedAt:     &now,
		}
		if err := sqliteStore.UpdateSession(ctx, parentSession.ID, update); err != nil {
			t.Fatalf("Failed to update parent session: %v", err)
		}

		// Continue to create child
		childReq := ContinueSessionConfig{
			ParentSessionID: parentSession.ID,
			Query:           "continue to child",
		}
		_, _ = manager.ContinueSession(ctx, childReq)

		// Find child session
		var childSession *store.Session
		sessions, _ = sqliteStore.ListSessions(ctx)
		for _, s := range sessions {
			if s.ParentSessionID == parentSession.ID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
			return // this return exists purely to satisfy the linter
		}

		// Verify child inherited the same original title
		if childSession.Title != grandparentTitle {
			t.Errorf("Child didn't inherit grandparent title: got %q, want %q", childSession.Title, grandparentTitle)
		}
	})

	t.Run("HTTPMCPServerUpdatesXSessionIDHeader", func(t *testing.T) {
		// This test verifies that when continuing a session with HTTP MCP servers,
		// the X-Session-ID header is updated to the child session ID, not inherited
		// from the parent session ID.

		// Create parent session
		parentSessionID := "parent-http-mcp"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-http-mcp",
			ClaudeSessionID: "claude-http-mcp",
			Status:          store.SessionStatusCompleted,
			Query:           "http mcp query",
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/tmp/test",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Store HTTP MCP server with X-Session-ID header for parent
		// For HTTP servers: Command="http", ArgsJSON=["URL"], EnvJSON=headers
		parentMCPServers := []store.MCPServer{
			{
				SessionID: parentSessionID,
				Name:      "http-test-server",
				Command:   "http",                                                                    // Indicates HTTP type
				ArgsJSON:  `["http://localhost:8080/mcp"]`,                                           // URL as single-element array
				EnvJSON:   `{"X-Session-ID": "parent-http-mcp", "Authorization": "Bearer token123"}`, // Headers
			},
		}
		if err := sqliteStore.StoreMCPServers(ctx, parentSessionID, parentMCPServers); err != nil {
			t.Fatalf("Failed to store MCP servers: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue http mcp",
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing Claude binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
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
			return
		}

		// Get MCP servers for child session
		childMCPServers, err := sqliteStore.GetMCPServers(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get child MCP servers: %v", err)
		}

		// Should have inherited the MCP server plus injected codelayer
		if len(childMCPServers) != 2 {
			t.Fatalf("Expected 2 MCP servers (http + codelayer), got %d", len(childMCPServers))
		}

		// Find the http test server (not codelayer)
		var childMCPServer *store.MCPServer
		for _, s := range childMCPServers {
			if s.Name == "http-test-server" {
				childMCPServer = &s
				break
			}
		}

		if childMCPServer == nil {
			t.Fatal("HTTP test server not found")
		}

		// Verify basic inheritance
		if childMCPServer.Command != "http" {
			t.Errorf("MCP server type not inherited: got %s, want http", childMCPServer.Command)
		}

		// Verify URL was inherited (stored in ArgsJSON)
		var childArgs []string
		if err := json.Unmarshal([]byte(childMCPServer.ArgsJSON), &childArgs); err != nil {
			t.Fatalf("Failed to unmarshal child args: %v", err)
		}
		if len(childArgs) != 1 || childArgs[0] != "http://localhost:8080/mcp" {
			t.Errorf("MCP server URL not inherited: got %v, want [http://localhost:8080/mcp]", childArgs)
		}

		// Parse headers (stored in EnvJSON) and verify X-Session-ID was updated
		var childHeaders map[string]string
		if err := json.Unmarshal([]byte(childMCPServer.EnvJSON), &childHeaders); err != nil {
			t.Fatalf("Failed to unmarshal child headers: %v", err)
		}

		// CRITICAL: X-Session-ID should be the CHILD session ID, not the parent's
		if xSessionID, ok := childHeaders["X-Session-ID"]; !ok {
			t.Error("X-Session-ID header missing in child MCP server")
		} else if xSessionID != childSession.ID {
			t.Errorf("X-Session-ID not updated to child session ID: got %s, want %s", xSessionID, childSession.ID)
			t.Log("This is the bug! X-Session-ID should be replaced with the child session ID")
		}

		// Other headers should be preserved
		if auth, ok := childHeaders["Authorization"]; !ok {
			t.Error("Authorization header not inherited")
		} else if auth != "Bearer token123" {
			t.Errorf("Authorization header value changed: got %s, want Bearer token123", auth)
		}
	})
}
