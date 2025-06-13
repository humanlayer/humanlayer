package api

import (
	"errors"
	"testing"

	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestFetchConversation_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockSession := &rpc.GetSessionStateResponse{
		Session: rpc.SessionState{
			ID:              "sess-123",
			ClaudeSessionID: "claude-456",
			Status:          "running",
			Model:           "claude-3",
			WorkingDir:      "/test",
		},
	}

	mockConversation := &rpc.GetConversationResponse{
		Events: []rpc.ConversationEvent{
			{
				EventType: "user_message",
				Content:   "Hello",
			},
			{
				EventType: "assistant_message",
				Content:   "Hi there!",
			},
		},
	}

	// Expect both calls in sequence
	mockClient.EXPECT().GetSessionState("sess-123").Return(mockSession, nil)
	mockClient.EXPECT().GetConversation("sess-123").Return(mockConversation, nil)

	cmd := apiClient.FetchConversation("sess-123")
	msg := cmd()

	result, ok := msg.(domain.FetchConversationMsg)
	if !ok {
		t.Fatalf("expected domain.FetchConversationMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if result.Session == nil {
		t.Fatal("expected non-nil session")
	}
	if result.Session.ID != "sess-123" {
		t.Errorf("expected session ID 'sess-123', got %s", result.Session.ID)
	}

	if len(result.Events) != 2 {
		t.Errorf("expected 2 events, got %d", len(result.Events))
	}
}

func TestFetchConversation_EmptySessionID(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Should not make any API calls
	cmd := apiClient.FetchConversation("")
	msg := cmd()

	result, ok := msg.(domain.FetchConversationMsg)
	if !ok {
		t.Fatalf("expected domain.FetchConversationMsg, got %T", msg)
	}

	if result.Err == nil {
		t.Error("expected error for empty session ID")
	}
}

func TestFetchConversation_SessionStateError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	expectedErr := errors.New("session not found")
	mockClient.EXPECT().GetSessionState("sess-123").Return(nil, expectedErr)

	cmd := apiClient.FetchConversation("sess-123")
	msg := cmd()

	result, ok := msg.(domain.FetchConversationMsg)
	if !ok {
		t.Fatalf("expected domain.FetchConversationMsg, got %T", msg)
	}

	if result.Err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, result.Err)
	}
}

func TestFetchConversation_ConversationError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockSession := &rpc.GetSessionStateResponse{
		Session: rpc.SessionState{
			ID: "sess-123",
		},
	}

	expectedErr := errors.New("conversation fetch failed")

	mockClient.EXPECT().GetSessionState("sess-123").Return(mockSession, nil)
	mockClient.EXPECT().GetConversation("sess-123").Return(nil, expectedErr)

	cmd := apiClient.FetchConversation("sess-123")
	msg := cmd()

	result, ok := msg.(domain.FetchConversationMsg)
	if !ok {
		t.Fatalf("expected domain.FetchConversationMsg, got %T", msg)
	}

	if result.Err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, result.Err)
	}
}

func TestFetchConversationSilent_BehavesIdentically(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockSession := &rpc.GetSessionStateResponse{
		Session: rpc.SessionState{
			ID: "sess-123",
		},
	}

	mockConversation := &rpc.GetConversationResponse{
		Events: []rpc.ConversationEvent{
			{EventType: "test"},
		},
	}

	// FetchConversationSilent should make the same calls
	mockClient.EXPECT().GetSessionState("sess-123").Return(mockSession, nil)
	mockClient.EXPECT().GetConversation("sess-123").Return(mockConversation, nil)

	// The "silent" version is just for UI purposes (no loading indicator)
	// but the API behavior is identical
	cmd := apiClient.FetchConversationSilent("sess-123")
	msg := cmd()

	result, ok := msg.(domain.FetchConversationMsg)
	if !ok {
		t.Fatalf("expected domain.FetchConversationMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if len(result.Events) != 1 {
		t.Errorf("expected 1 event, got %d", len(result.Events))
	}
}
