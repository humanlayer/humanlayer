package provider_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/humanlayer/humanlayer/hld/provider"
)

func TestEventTypes(t *testing.T) {
	t.Run("EventTypeConstants", func(t *testing.T) {
		// Verify all event type constants are defined correctly
		require.Equal(t, provider.EventType("step_start"), provider.EventTypeStepStart)
		require.Equal(t, provider.EventType("text"), provider.EventTypeText)
		require.Equal(t, provider.EventType("tool_use"), provider.EventTypeToolUse)
		require.Equal(t, provider.EventType("tool_result"), provider.EventTypeToolResult)
		require.Equal(t, provider.EventType("thinking"), provider.EventTypeThinking)
		require.Equal(t, provider.EventType("step_finish"), provider.EventTypeStepFinish)
		require.Equal(t, provider.EventType("system"), provider.EventTypeSystem)
		require.Equal(t, provider.EventType("result"), provider.EventTypeResult)
	})
}

func TestEvent(t *testing.T) {
	t.Run("CreateTextEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeText,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			Role:      "assistant",
			Text:      "Hello, world!",
		}

		require.Equal(t, provider.EventTypeText, event.Type)
		require.Equal(t, "ses_123", event.SessionID)
		require.Equal(t, "assistant", event.Role)
		require.Equal(t, "Hello, world!", event.Text)
	})

	t.Run("CreateToolUseEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeToolUse,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			Role:      "assistant",
			Tool: &provider.ToolCall{
				ID:     "tool_abc",
				Name:   "bash",
				Input:  map[string]interface{}{"command": "ls -la"},
				Status: "running",
			},
		}

		require.Equal(t, provider.EventTypeToolUse, event.Type)
		require.NotNil(t, event.Tool)
		require.Equal(t, "tool_abc", event.Tool.ID)
		require.Equal(t, "bash", event.Tool.Name)
		require.Equal(t, "running", event.Tool.Status)
		require.Equal(t, "ls -la", event.Tool.Input["command"])
	})

	t.Run("CreateStepFinishEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeStepFinish,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			Finish: &provider.FinishInfo{
				Reason: "stop",
				Cost:   0.0042,
				Tokens: &provider.TokenUsage{
					Input:      1000,
					Output:     500,
					Reasoning:  100,
					CacheRead:  200,
					CacheWrite: 50,
				},
			},
		}

		require.Equal(t, provider.EventTypeStepFinish, event.Type)
		require.NotNil(t, event.Finish)
		require.Equal(t, "stop", event.Finish.Reason)
		require.Equal(t, 0.0042, event.Finish.Cost)
		require.NotNil(t, event.Finish.Tokens)
		require.Equal(t, 1000, event.Finish.Tokens.Input)
		require.Equal(t, 500, event.Finish.Tokens.Output)
	})

	t.Run("CreateSystemEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeSystem,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			System: &provider.SystemInfo{
				Model:          "claude-sonnet-4-20250514",
				CWD:            "/home/user/project",
				PermissionMode: "default",
				Tools:          []string{"bash", "read", "write"},
				MCPServers: []provider.MCPServerStatus{
					{Name: "approvals", Status: "connected"},
				},
			},
		}

		require.Equal(t, provider.EventTypeSystem, event.Type)
		require.NotNil(t, event.System)
		require.Equal(t, "claude-sonnet-4-20250514", event.System.Model)
		require.Equal(t, "/home/user/project", event.System.CWD)
		require.Len(t, event.System.Tools, 3)
		require.Len(t, event.System.MCPServers, 1)
		require.Equal(t, "approvals", event.System.MCPServers[0].Name)
	})

	t.Run("CreateResultEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeResult,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			Result: &provider.ResultInfo{
				IsError:    false,
				Result:     "Task completed successfully",
				Cost:       0.0123,
				DurationMS: 5000,
				NumTurns:   3,
			},
		}

		require.Equal(t, provider.EventTypeResult, event.Type)
		require.NotNil(t, event.Result)
		require.False(t, event.Result.IsError)
		require.Equal(t, "Task completed successfully", event.Result.Result)
		require.Equal(t, 0.0123, event.Result.Cost)
		require.Equal(t, 5000, event.Result.DurationMS)
		require.Equal(t, 3, event.Result.NumTurns)
	})

	t.Run("CreateErrorResultEvent", func(t *testing.T) {
		event := provider.Event{
			Type:      provider.EventTypeResult,
			SessionID: "ses_123",
			Timestamp: time.Now(),
			Result: &provider.ResultInfo{
				IsError: true,
				Error:   "Rate limit exceeded",
			},
		}

		require.Equal(t, provider.EventTypeResult, event.Type)
		require.NotNil(t, event.Result)
		require.True(t, event.Result.IsError)
		require.Equal(t, "Rate limit exceeded", event.Result.Error)
	})
}

func TestConfig(t *testing.T) {
	t.Run("CreateBasicConfig", func(t *testing.T) {
		config := provider.Config{
			Query:      "Write hello world in Go",
			Model:      "claude-sonnet-4-20250514",
			WorkingDir: "/home/user/project",
		}

		require.Equal(t, "Write hello world in Go", config.Query)
		require.Equal(t, "claude-sonnet-4-20250514", config.Model)
		require.Equal(t, "/home/user/project", config.WorkingDir)
	})

	t.Run("CreateConfigWithMCPServers", func(t *testing.T) {
		config := provider.Config{
			Query: "Deploy to production",
			MCPServers: map[string]provider.MCPServer{
				"approvals": {
					Command: "npx",
					Args:    []string{"humanlayer", "mcp", "claude_approvals"},
					Env:     map[string]string{"HL_API_KEY": "test-key"},
				},
				"http-server": {
					Type:    "http",
					URL:     "http://localhost:8080",
					Headers: map[string]string{"Authorization": "Bearer token"},
				},
			},
			PermissionPromptTool: "mcp__approvals__request_permission",
		}

		require.Equal(t, "Deploy to production", config.Query)
		require.Len(t, config.MCPServers, 2)

		approvals := config.MCPServers["approvals"]
		require.Equal(t, "npx", approvals.Command)
		require.Equal(t, []string{"humanlayer", "mcp", "claude_approvals"}, approvals.Args)
		require.Equal(t, "test-key", approvals.Env["HL_API_KEY"])

		httpServer := config.MCPServers["http-server"]
		require.Equal(t, "http", httpServer.Type)
		require.Equal(t, "http://localhost:8080", httpServer.URL)
		require.Equal(t, "Bearer token", httpServer.Headers["Authorization"])
	})

	t.Run("CreateConfigWithToolFilters", func(t *testing.T) {
		config := provider.Config{
			Query:           "Perform some tasks",
			AllowedTools:    []string{"bash", "read", "write"},
			DisallowedTools: []string{"delete", "deploy"},
		}

		require.Len(t, config.AllowedTools, 3)
		require.Len(t, config.DisallowedTools, 2)
		require.Contains(t, config.AllowedTools, "bash")
		require.Contains(t, config.DisallowedTools, "delete")
	})

	t.Run("CreateOpenCodeSpecificConfig", func(t *testing.T) {
		config := provider.Config{
			Query:      "Analyze this file",
			Model:      "anthropic/claude-sonnet-4-20250514",
			Files:      []string{"main.go", "config.yaml"},
			Agent:      "code-reviewer",
			Title:      "Code Review Session",
			WorkingDir: "/home/user/project",
		}

		require.Equal(t, "anthropic/claude-sonnet-4-20250514", config.Model)
		require.Len(t, config.Files, 2)
		require.Equal(t, "code-reviewer", config.Agent)
		require.Equal(t, "Code Review Session", config.Title)
	})
}

func TestResult(t *testing.T) {
	t.Run("CreateSuccessResult", func(t *testing.T) {
		result := provider.Result{
			SessionID:        "ses_abc123",
			Result:           "Successfully completed the task",
			IsError:          false,
			Cost:             0.0245,
			DurationMS:       12500,
			NumTurns:         5,
			InputTokens:      5000,
			OutputTokens:     2000,
			CacheReadTokens:  1000,
			CacheWriteTokens: 500,
		}

		require.Equal(t, "ses_abc123", result.SessionID)
		require.Equal(t, "Successfully completed the task", result.Result)
		require.False(t, result.IsError)
		require.Equal(t, 0.0245, result.Cost)
		require.Equal(t, 12500, result.DurationMS)
		require.Equal(t, 5, result.NumTurns)
		require.Equal(t, 5000, result.InputTokens)
		require.Equal(t, 2000, result.OutputTokens)
	})

	t.Run("CreateErrorResult", func(t *testing.T) {
		result := provider.Result{
			SessionID:  "ses_abc123",
			IsError:    true,
			Error:      "Context length exceeded",
			DurationMS: 1500,
		}

		require.Equal(t, "ses_abc123", result.SessionID)
		require.True(t, result.IsError)
		require.Equal(t, "Context length exceeded", result.Error)
		require.Empty(t, result.Result)
	})
}

func TestToolResultData(t *testing.T) {
	t.Run("CreateSuccessToolResult", func(t *testing.T) {
		toolResult := provider.ToolResultData{
			ToolUseID: "tool_123",
			Content:   "Command executed successfully",
			IsError:   false,
		}

		require.Equal(t, "tool_123", toolResult.ToolUseID)
		require.Equal(t, "Command executed successfully", toolResult.Content)
		require.False(t, toolResult.IsError)
	})

	t.Run("CreateErrorToolResult", func(t *testing.T) {
		toolResult := provider.ToolResultData{
			ToolUseID: "tool_456",
			Content:   "Permission denied",
			IsError:   true,
		}

		require.Equal(t, "tool_456", toolResult.ToolUseID)
		require.Equal(t, "Permission denied", toolResult.Content)
		require.True(t, toolResult.IsError)
	})
}
