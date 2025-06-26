package session

import (
	"context"
	"encoding/json"
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

	manager, err := NewManager(eventBus, sqliteStore)
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

		// MaxTurns should NOT be inherited (as per spec)
		if childSession.MaxTurns == parentSession.MaxTurns {
			t.Error("MaxTurns should not be inherited")
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
		}

		// Get MCP servers for child session
		childMCPServers, err := sqliteStore.GetMCPServers(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get child MCP servers: %v", err)
		}

		// Should have inherited the MCP servers
		if len(childMCPServers) != len(mcpServers) {
			t.Errorf("MCP servers not inherited: got %d, want %d", len(childMCPServers), len(mcpServers))
		}

		// Verify server details (accounting for HUMANLAYER_RUN_ID being added)
		for i, server := range childMCPServers {
			if server.Name != mcpServers[i].Name {
				t.Errorf("MCP server %d name mismatch: got %s, want %s", i, server.Name, mcpServers[i].Name)
			}
			if server.Command != mcpServers[i].Command {
				t.Errorf("MCP server %d command mismatch: got %s, want %s", i, server.Command, mcpServers[i].Command)
			}

			// Compare args (deserialize to compare content)
			var childArgs, parentArgs []string
			if err := json.Unmarshal([]byte(server.ArgsJSON), &childArgs); err != nil {
				t.Fatalf("Failed to unmarshal child args: %v", err)
			}
			if err := json.Unmarshal([]byte(mcpServers[i].ArgsJSON), &parentArgs); err != nil {
				t.Fatalf("Failed to unmarshal parent args: %v", err)
			}
			if len(childArgs) != len(parentArgs) {
				t.Errorf("MCP server %d args length mismatch", i)
			} else {
				for j, arg := range childArgs {
					if arg != parentArgs[j] {
						t.Errorf("MCP server %d arg[%d] mismatch: got %s, want %s", i, j, arg, parentArgs[j])
					}
				}
			}

			// Compare env (deserialize and check that parent env is subset of child env)
			var childEnv, parentEnv map[string]string
			if err := json.Unmarshal([]byte(server.EnvJSON), &childEnv); err != nil {
				t.Fatalf("Failed to unmarshal child env: %v", err)
			}
			if err := json.Unmarshal([]byte(mcpServers[i].EnvJSON), &parentEnv); err != nil {
				t.Fatalf("Failed to unmarshal parent env: %v", err)
			}

			// Child should have all parent env vars plus HUMANLAYER_RUN_ID
			for key, val := range parentEnv {
				if childEnv[key] != val {
					t.Errorf("MCP server %d env[%s] mismatch: got %s, want %s", i, key, childEnv[key], val)
				}
			}

			// Should have HUMANLAYER_RUN_ID added
			if _, ok := childEnv["HUMANLAYER_RUN_ID"]; !ok {
				t.Errorf("MCP server %d missing HUMANLAYER_RUN_ID in env", i)
			}
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
		}

		// Get MCP servers for child
		childMCPServers, err := sqliteStore.GetMCPServers(ctx, childSession.ID)
		if err != nil {
			t.Fatalf("Failed to get child MCP servers: %v", err)
		}

		// Should have the override server, not the original
		if len(childMCPServers) != 1 {
			t.Fatalf("Expected 1 MCP server, got %d", len(childMCPServers))
		}

		server := childMCPServers[0]
		if server.Name != "override-server" {
			t.Errorf("MCP server name not overridden: got %s", server.Name)
		}
		if server.Command != "override-cmd" {
			t.Errorf("MCP server command not overridden: got %s", server.Command)
		}
	})
}
