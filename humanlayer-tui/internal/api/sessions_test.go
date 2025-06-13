package api

import (
	"errors"
	"testing"

	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestFetchSessions_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockSessions := &rpc.ListSessionsResponse{
		Sessions: []session.Info{
			{
				ID:     "sess-1",
				RunID:  "run-1",
				Query:  "Test query 1",
				Model:  "claude-3",
				Status: "running",
			},
			{
				ID:     "sess-2",
				RunID:  "run-2",
				Query:  "Test query 2",
				Model:  "claude-3",
				Status: "completed",
			},
		},
	}

	mockClient.EXPECT().ListSessions().Return(mockSessions, nil)

	cmd := apiClient.FetchSessions()
	msg := cmd()

	result, ok := msg.(domain.FetchSessionsMsg)
	if !ok {
		t.Fatalf("expected domain.FetchSessionsMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if len(result.Sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(result.Sessions))
	}
}

func TestFetchSessions_Error(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	expectedErr := errors.New("network timeout")
	mockClient.EXPECT().ListSessions().Return(nil, expectedErr)

	cmd := apiClient.FetchSessions()
	msg := cmd()

	result, ok := msg.(domain.FetchSessionsMsg)
	if !ok {
		t.Fatalf("expected domain.FetchSessionsMsg, got %T", msg)
	}

	if result.Err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, result.Err)
	}
}

func TestLaunchSession_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Verify the MCP config is properly constructed
	mockClient.EXPECT().LaunchSession(gomock.Any()).DoAndReturn(
		func(req rpc.LaunchSessionRequest) (*rpc.LaunchSessionResponse, error) {
			// Verify request structure
			if req.Query != "test query" {
				t.Errorf("expected query 'test query', got %s", req.Query)
			}
			if req.Model != "claude-3" {
				t.Errorf("expected model 'claude-3', got %s", req.Model)
			}
			if req.WorkingDir != "/test/dir" {
				t.Errorf("expected working dir '/test/dir', got %s", req.WorkingDir)
			}
			if req.MCPConfig == nil {
				t.Error("expected MCP config to be set")
			}
			if req.PermissionPromptTool != "mcp__approvals__request_permission" {
				t.Errorf("unexpected permission prompt tool: %s", req.PermissionPromptTool)
			}

			return &rpc.LaunchSessionResponse{
				SessionID: "new-session-123",
				RunID:     "new-run-456",
			}, nil
		})

	cmd := apiClient.LaunchSession("test query", "claude-3", "/test/dir")
	msg := cmd()

	result, ok := msg.(domain.LaunchSessionMsg)
	if !ok {
		t.Fatalf("expected domain.LaunchSessionMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if result.SessionID != "new-session-123" {
		t.Errorf("expected session ID 'new-session-123', got %s", result.SessionID)
	}
	if result.RunID != "new-run-456" {
		t.Errorf("expected run ID 'new-run-456', got %s", result.RunID)
	}
}

func TestContinueSession_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	expectedReq := rpc.ContinueSessionRequest{
		SessionID: "parent-session",
		Query:     "follow up question",
	}

	mockClient.EXPECT().ContinueSession(expectedReq).Return(
		&rpc.ContinueSessionResponse{
			SessionID:       "child-session-123",
			ClaudeSessionID: "claude-sess-789",
		}, nil)

	cmd := apiClient.ContinueSession("parent-session", "follow up question")
	msg := cmd()

	result, ok := msg.(domain.ContinueSessionMsg)
	if !ok {
		t.Fatalf("expected domain.ContinueSessionMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if result.SessionID != "child-session-123" {
		t.Errorf("expected session ID 'child-session-123', got %s", result.SessionID)
	}
	if result.ClaudeSessionID != "claude-sess-789" {
		t.Errorf("expected Claude session ID 'claude-sess-789', got %s", result.ClaudeSessionID)
	}
}
