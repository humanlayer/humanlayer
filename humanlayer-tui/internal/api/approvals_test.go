package api

import (
	"errors"
	"testing"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestFetchRequests_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	// Setup: Create a simple approval
	mockApprovals := []approval.PendingApproval{
		{
			Type: "function_call",
			FunctionCall: &humanlayer.FunctionCall{
				CallID: "fc-123",
				RunID:  "run-456",
				Spec: humanlayer.FunctionCallSpec{
					Fn:     "test_function",
					Kwargs: map[string]interface{}{"key": "value"},
				},
			},
		},
	}

	mockSessions := &rpc.ListSessionsResponse{
		Sessions: []session.Info{
			{
				ID:    "sess-123",
				RunID: "run-456",
				Query: "Test query",
				Model: "claude-3",
			},
		},
	}

	// Expectations
	mockClient.EXPECT().FetchApprovals("").Return(mockApprovals, nil)
	mockClient.EXPECT().ListSessions().Return(mockSessions, nil)

	// Execute
	cmd := apiClient.FetchRequests()
	msg := cmd() // Execute the tea.Cmd

	// Assert
	result, ok := msg.(domain.FetchRequestsMsg)
	if !ok {
		t.Fatalf("expected domain.FetchRequestsMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Fatalf("unexpected error: %v", result.Err)
	}

	if len(result.Requests) != 1 {
		t.Errorf("expected 1 request, got %d", len(result.Requests))
	}

	// Verify the request was enriched with session info
	if result.Requests[0].SessionID != "sess-123" {
		t.Errorf("expected session ID 'sess-123', got %s", result.Requests[0].SessionID)
	}
}

func TestFetchRequests_Error(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	expectedErr := errors.New("network error")
	mockClient.EXPECT().FetchApprovals("").Return(nil, expectedErr)

	cmd := apiClient.FetchRequests()
	msg := cmd()

	result, ok := msg.(domain.FetchRequestsMsg)
	if !ok {
		t.Fatalf("expected domain.FetchRequestsMsg, got %T", msg)
	}

	if result.Err != expectedErr {
		t.Errorf("expected error %v, got %v", expectedErr, result.Err)
	}
}

func TestSendApproval_Approve(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockClient.EXPECT().ApproveFunctionCall("call-123", "looks good").Return(nil)

	cmd := apiClient.SendApproval("call-123", true, "looks good")
	msg := cmd()

	result, ok := msg.(domain.ApprovalSentMsg)
	if !ok {
		t.Fatalf("expected domain.ApprovalSentMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Errorf("unexpected error: %v", result.Err)
	}
	if !result.Approved {
		t.Errorf("expected approved=true")
	}
}

func TestSendApproval_Deny(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := client.NewMockClient(ctrl)
	apiClient := NewClient(mockClient)

	mockClient.EXPECT().DenyFunctionCall("call-456", "not safe").Return(nil)

	cmd := apiClient.SendApproval("call-456", false, "not safe")
	msg := cmd()

	result, ok := msg.(domain.ApprovalSentMsg)
	if !ok {
		t.Fatalf("expected domain.ApprovalSentMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Errorf("unexpected error: %v", result.Err)
	}
	if result.Approved {
		t.Errorf("expected approved=false")
	}
}
