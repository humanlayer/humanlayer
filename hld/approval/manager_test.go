package approval

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestManager_CreateApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	runID := "test-run-123"
	sessionID := "test-session-456"
	toolName := "Write"
	toolInput := json.RawMessage(`{"file": "test.txt", "content": "hello"}`)

	// Mock getting session by run ID
	mockStore.EXPECT().GetSessionByRunID(ctx, runID).Return(&store.Session{
		ID:    sessionID,
		RunID: runID,
	}, nil)

	// Mock creating approval
	mockStore.EXPECT().CreateApproval(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, approval *store.Approval) error {
		assert.Equal(t, runID, approval.RunID)
		assert.Equal(t, sessionID, approval.SessionID)
		assert.Equal(t, store.ApprovalStatusLocalPending, approval.Status)
		assert.Equal(t, toolName, approval.ToolName)
		assert.Equal(t, toolInput, approval.ToolInput)
		assert.NotEmpty(t, approval.ID)
		assert.True(t, strings.HasPrefix(approval.ID, "local-"))
		return nil
	})

	// Mock correlation attempt - it's ok if it fails
	mockStore.EXPECT().GetUncorrelatedPendingToolCall(ctx, sessionID, toolName).Return(nil, nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventNewApproval, event.Type)
		assert.Equal(t, sessionID, event.Data["session_id"])
		assert.Equal(t, toolName, event.Data["tool_name"])
	})

	// Mock session status update
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	// Create approval
	approvalID, err := manager.CreateApproval(ctx, runID, toolName, toolInput)
	require.NoError(t, err)
	assert.NotEmpty(t, approvalID)
	assert.True(t, strings.HasPrefix(approvalID, "local-"))
}

func TestManager_CreateApproval_SessionNotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	runID := "test-run-123"
	toolName := "Write"
	toolInput := json.RawMessage(`{"file": "test.txt"}`)

	// Mock getting session by run ID - returns nil
	mockStore.EXPECT().GetSessionByRunID(ctx, runID).Return(nil, nil)

	// Create approval should fail
	_, err := manager.CreateApproval(ctx, runID, toolName, toolInput)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session not found")
}

func TestManager_GetPendingApprovals(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	sessionID := "test-session-456"

	expectedApprovals := []*store.Approval{
		{
			ID:        "local-approval-1",
			SessionID: sessionID,
			Status:    store.ApprovalStatusLocalPending,
			ToolName:  "Write",
		},
		{
			ID:        "local-approval-2",
			SessionID: sessionID,
			Status:    store.ApprovalStatusLocalPending,
			ToolName:  "Execute",
		},
	}

	mockStore.EXPECT().GetPendingApprovals(ctx, sessionID).Return(expectedApprovals, nil)

	approvals, err := manager.GetPendingApprovals(ctx, sessionID)
	require.NoError(t, err)
	assert.Equal(t, expectedApprovals, approvals)
}

func TestManager_ApproveToolCall(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	approvalID := "local-approval-123"
	sessionID := "test-session-456"
	comment := "Looks good!"

	approval := &store.Approval{
		ID:        approvalID,
		SessionID: sessionID,
		Status:    store.ApprovalStatusLocalPending,
		ToolName:  "Write",
	}

	// Mock getting approval
	mockStore.EXPECT().GetApproval(ctx, approvalID).Return(approval, nil)

	// Mock updating approval response
	mockStore.EXPECT().UpdateApprovalResponse(ctx, approvalID, store.ApprovalStatusLocalApproved, comment).Return(nil)

	// Mock updating approval status in conversation events
	mockStore.EXPECT().UpdateApprovalStatus(ctx, approvalID, store.ApprovalStatusApproved).Return(nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventApprovalResolved, event.Type)
		assert.Equal(t, approvalID, event.Data["approval_id"])
		assert.Equal(t, sessionID, event.Data["session_id"])
		assert.Equal(t, true, event.Data["approved"])
		assert.Equal(t, comment, event.Data["response_text"])
	})

	// Mock session status update
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	err := manager.ApproveToolCall(ctx, approvalID, comment)
	require.NoError(t, err)
}

func TestManager_DenyToolCall(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	approvalID := "local-approval-123"
	sessionID := "test-session-456"
	reason := "Not safe to execute"

	approval := &store.Approval{
		ID:        approvalID,
		SessionID: sessionID,
		Status:    store.ApprovalStatusLocalPending,
		ToolName:  "Execute",
	}

	// Mock getting approval
	mockStore.EXPECT().GetApproval(ctx, approvalID).Return(approval, nil)

	// Mock updating approval response
	mockStore.EXPECT().UpdateApprovalResponse(ctx, approvalID, store.ApprovalStatusLocalDenied, reason).Return(nil)

	// Mock updating approval status in conversation events
	mockStore.EXPECT().UpdateApprovalStatus(ctx, approvalID, store.ApprovalStatusDenied).Return(nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
		assert.Equal(t, bus.EventApprovalResolved, event.Type)
		assert.Equal(t, approvalID, event.Data["approval_id"])
		assert.Equal(t, sessionID, event.Data["session_id"])
		assert.Equal(t, false, event.Data["approved"])
		assert.Equal(t, reason, event.Data["response_text"])
	})

	// Mock session status update
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	err := manager.DenyToolCall(ctx, approvalID, reason)
	require.NoError(t, err)
}

func TestManager_CorrelateApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)

	manager := NewManager(mockStore, mockEventBus)

	ctx := context.Background()
	runID := "test-run-123"
	sessionID := "test-session-456"
	toolName := "Write"
	toolInput := json.RawMessage(`{"file": "test.txt"}`)

	// Mock getting session by run ID
	mockStore.EXPECT().GetSessionByRunID(ctx, runID).Return(&store.Session{
		ID:    sessionID,
		RunID: runID,
	}, nil)

	// Mock creating approval
	mockStore.EXPECT().CreateApproval(ctx, gomock.Any()).Return(nil)

	// Mock successful correlation
	pendingToolCall := &store.ConversationEvent{
		ID:       123,
		ToolID:   "tool-123",
		ToolName: toolName,
	}
	mockStore.EXPECT().GetUncorrelatedPendingToolCall(ctx, sessionID, toolName).Return(pendingToolCall, nil)

	// Mock correlating by tool ID
	mockStore.EXPECT().LinkConversationEventToApprovalUsingToolID(ctx, sessionID, "tool-123", gomock.Any()).Return(nil)

	// Mock event publishing
	mockEventBus.EXPECT().Publish(gomock.Any())

	// Mock session status update
	mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(nil)

	// Create approval (which will attempt correlation)
	approvalID, err := manager.CreateApproval(ctx, runID, toolName, toolInput)
	require.NoError(t, err)
	assert.NotEmpty(t, approvalID)
}

func TestManager_CreateApprovalWithToolUseID_AutoApproveQuestionTool(t *testing.T) {
	tests := []struct {
		name            string
		toolName        string
		expectedStatus  store.ApprovalStatus
		expectedComment string
		autoApproved    bool
	}{
		{
			name:            "exact match ask_user_question",
			toolName:        "ask_user_question",
			expectedStatus:  store.ApprovalStatusLocalApproved,
			expectedComment: "Auto-accepted (question tool)",
			autoApproved:    true,
		},
		{
			name:            "MCP namespaced mcp__codelayer__ask_user_question",
			toolName:        "mcp__codelayer__ask_user_question",
			expectedStatus:  store.ApprovalStatusLocalApproved,
			expectedComment: "Auto-accepted (question tool)",
			autoApproved:    true,
		},
		{
			name:            "non-question tool Write",
			toolName:        "Write",
			expectedStatus:  store.ApprovalStatusLocalPending,
			expectedComment: "",
			autoApproved:    false,
		},
		{
			name:            "similar but not matching ask_user",
			toolName:        "ask_user",
			expectedStatus:  store.ApprovalStatusLocalPending,
			expectedComment: "",
			autoApproved:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			defer ctrl.Finish()

			mockStore := store.NewMockConversationStore(ctrl)
			mockEventBus := bus.NewMockEventBus(ctrl)

			manager := NewManager(mockStore, mockEventBus)

			ctx := context.Background()
			sessionID := "test-session-456"
			toolUseID := "toolu_test_123"
			toolInput := json.RawMessage(`{"questions":[]}`)

			// Mock getting session
			mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
				ID:    sessionID,
				RunID: "test-run-123",
			}, nil)

			// Mock creating approval — verify status and comment
			mockStore.EXPECT().CreateApproval(ctx, gomock.Any()).DoAndReturn(func(ctx context.Context, approval *store.Approval) error {
				assert.Equal(t, tt.expectedStatus, approval.Status)
				assert.Equal(t, tt.expectedComment, approval.Comment)
				assert.Equal(t, tt.toolName, approval.ToolName)
				assert.NotNil(t, approval.ToolUseID)
				assert.Equal(t, toolUseID, *approval.ToolUseID)
				return nil
			})

			// Mock new approval event (always published)
			mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
				assert.Equal(t, bus.EventNewApproval, event.Type)
			})

			// Mock correlation
			mockStore.EXPECT().LinkConversationEventToApprovalUsingToolID(ctx, sessionID, toolUseID, gomock.Any()).Return(nil)

			if tt.autoApproved {
				// Auto-approved path: UpdateApprovalStatus + resolved event
				mockStore.EXPECT().UpdateApprovalStatus(ctx, gomock.Any(), store.ApprovalStatusApproved).Return(nil)
				mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(event bus.Event) {
					assert.Equal(t, bus.EventApprovalResolved, event.Type)
					assert.Equal(t, true, event.Data["approved"])
					assert.Equal(t, tt.expectedComment, event.Data["response_text"])
				})
			} else {
				// Pending path: session status update to waiting_input
				mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).DoAndReturn(func(_ context.Context, id string, updates store.SessionUpdate) error {
					assert.NotNil(t, updates.Status)
					assert.Equal(t, store.SessionStatusWaitingInput, *updates.Status)
					return nil
				})
			}

			approval, err := manager.CreateApprovalWithToolUseID(ctx, sessionID, tt.toolName, toolInput, toolUseID)
			require.NoError(t, err)
			assert.NotNil(t, approval)
			assert.Equal(t, tt.expectedStatus, approval.Status)
			assert.Equal(t, tt.expectedComment, approval.Comment)
		})
	}
}
