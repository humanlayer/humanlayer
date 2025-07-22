package rpc

import (
	"context"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"go.uber.org/mock/gomock"
)

func TestHandleContinueSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)
	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	testCases := []struct {
		name          string
		request       string
		setupMocks    func()
		expectedError string
		validateResp  func(t *testing.T, resp *ContinueSessionResponse)
	}{
		{
			name: "successful continue session",
			request: `{
				"session_id": "parent-123",
				"query": "follow up question",
				"system_prompt": "You are helpful",
				"max_turns": 5
			}`,
			setupMocks: func() {
				mockManager.EXPECT().ContinueSession(gomock.Any(), gomock.Any()).DoAndReturn(
					func(ctx context.Context, req session.ContinueSessionConfig) (*session.Session, error) {
						// Validate request
						if req.ParentSessionID != "parent-123" {
							t.Errorf("Expected parent session ID 'parent-123', got %s", req.ParentSessionID)
						}
						if req.Query != "follow up question" {
							t.Errorf("Expected query 'follow up question', got %s", req.Query)
						}
						if req.SystemPrompt != "You are helpful" {
							t.Errorf("Expected system prompt 'You are helpful', got %s", req.SystemPrompt)
						}
						if req.MaxTurns != 5 {
							t.Errorf("Expected max turns 5, got %d", req.MaxTurns)
						}

						// Return mock session
						return &session.Session{
							ID:        "child-456",
							RunID:     "run-child",
							Status:    session.StatusRunning,
							StartTime: time.Now(),
						}, nil
					})

				// Note: We don't mock GetSession here because the handler correctly
				// returns empty claude_session_id (it's not available until events stream)
			},
			validateResp: func(t *testing.T, resp *ContinueSessionResponse) {
				if resp.SessionID != "child-456" {
					t.Errorf("Expected session ID 'child-456', got %s", resp.SessionID)
				}
				if resp.RunID != "run-child" {
					t.Errorf("Expected run ID 'run-child', got %s", resp.RunID)
				}
				// claude_session_id should be empty initially (populated when events stream)
				if resp.ClaudeSessionID != "" {
					t.Errorf("Expected empty claude session ID initially, got %s", resp.ClaudeSessionID)
				}
				if resp.ParentSessionID != "parent-123" {
					t.Errorf("Expected parent session ID 'parent-123', got %s", resp.ParentSessionID)
				}
			},
		},
		{
			name: "continue session with MCP config",
			request: `{
				"session_id": "parent-mcp",
				"query": "with mcp",
				"mcp_config": "{\"mcpServers\": {\"test\": {\"command\": \"node\"}}}"
			}`,
			setupMocks: func() {
				mockManager.EXPECT().ContinueSession(gomock.Any(), gomock.Any()).DoAndReturn(
					func(ctx context.Context, req session.ContinueSessionConfig) (*session.Session, error) {
						// Validate MCP config was parsed
						if req.MCPConfig == nil {
							t.Error("Expected MCP config to be parsed")
						}
						if req.MCPConfig.MCPServers == nil {
							t.Error("Expected MCP servers to be set")
						}
						if _, ok := req.MCPConfig.MCPServers["test"]; !ok {
							t.Error("Expected 'test' server in MCP config")
						}

						return &session.Session{
							ID:        "child-mcp",
							RunID:     "run-mcp",
							Status:    session.StatusRunning,
							StartTime: time.Now(),
						}, nil
					})

				// No GetSession mock needed - claude_session_id won't be available yet
			},
			validateResp: func(t *testing.T, resp *ContinueSessionResponse) {
				if resp.SessionID != "child-mcp" {
					t.Errorf("Expected session ID 'child-mcp', got %s", resp.SessionID)
				}
			},
		},
		{
			name:    "missing session ID",
			request: `{"query": "no session"}`,
			setupMocks: func() {
				// No mocks needed - validation fails early
			},
			expectedError: "validation error: field 'session_id': required field",
		},
		{
			name:    "missing query",
			request: `{"session_id": "parent-123"}`,
			setupMocks: func() {
				// No mocks needed - validation fails early
			},
			expectedError: "validation error: field 'query': required field",
		},
		{
			name:    "invalid MCP config JSON",
			request: `{"session_id": "parent-123", "query": "test", "mcp_config": "invalid json"}`,
			setupMocks: func() {
				// No mocks needed - validation fails early
			},
			expectedError: "validation error: field 'mcp_config': invalid JSON",
		},
		{
			name:    "invalid JSON request",
			request: `{invalid json}`,
			setupMocks: func() {
				// No mocks needed - parsing fails
			},
			expectedError: "validation error: field 'params': invalid JSON",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tc.setupMocks()

			resp, err := handlers.HandleContinueSession(context.Background(), []byte(tc.request))

			if tc.expectedError != "" {
				if err == nil {
					t.Errorf("Expected error containing '%s', got nil", tc.expectedError)
				} else if !containsStr(err.Error(), tc.expectedError) {
					t.Errorf("Expected error containing '%s', got '%s'", tc.expectedError, err.Error())
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			continueResp, ok := resp.(*ContinueSessionResponse)
			if !ok {
				t.Fatalf("Expected *ContinueSessionResponse, got %T", resp)
			}

			if tc.validateResp != nil {
				tc.validateResp(t, continueResp)
			}
		})
	}
}

func TestHandleContinueSession_ToolsConfiguration(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)
	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	request := `{
		"session_id": "parent-tools",
		"query": "with tools config",
		"permission_prompt_tool": "mcp__humanlayer__tool",
		"allowed_tools": ["tool1", "tool2"],
		"disallowed_tools": ["dangerous_tool"]
	}`

	mockManager.EXPECT().ContinueSession(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, req session.ContinueSessionConfig) (*session.Session, error) {
			// Validate tools configuration
			if req.PermissionPromptTool != "mcp__humanlayer__tool" {
				t.Errorf("Expected permission prompt tool 'mcp__humanlayer__tool', got %s", req.PermissionPromptTool)
			}
			if len(req.AllowedTools) != 2 || req.AllowedTools[0] != "tool1" || req.AllowedTools[1] != "tool2" {
				t.Errorf("Expected allowed tools [tool1, tool2], got %v", req.AllowedTools)
			}
			if len(req.DisallowedTools) != 1 || req.DisallowedTools[0] != "dangerous_tool" {
				t.Errorf("Expected disallowed tools [dangerous_tool], got %v", req.DisallowedTools)
			}

			return &session.Session{
				ID:        "child-tools",
				RunID:     "run-tools",
				Status:    session.StatusRunning,
				StartTime: time.Now(),
			}, nil
		})

	// No GetSession mock needed - claude_session_id won't be available yet

	resp, err := handlers.HandleContinueSession(context.Background(), []byte(request))
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	continueResp, ok := resp.(*ContinueSessionResponse)
	if !ok {
		t.Fatalf("Expected *ContinueSessionResponse, got %T", resp)
	}

	if continueResp.SessionID != "child-tools" {
		t.Errorf("Expected session ID 'child-tools', got %s", continueResp.SessionID)
	}
}

func containsStr(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && contains(s, substr))
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
