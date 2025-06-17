package approval

import (
	"context"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
	"go.uber.org/mock/gomock"
)

func TestManager_SessionStatusTransitions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	tests := []struct {
		name           string
		setupTest      func(mockClient *MockAPIClient, mockStore *MockStore, convStore *store.MockConversationStore) string // returns callID
		expectedStatus string
	}{
		{
			name: "approve_updates_session_to_running",
			setupTest: func(mockClient *MockAPIClient, mockStore *MockStore, convStore *store.MockConversationStore) string {
				callID := "fc-approve-123"
				runID := "run-approve-456"
				sessionID := "sess-approve-789"

				// Function call exists
				fc := &humanlayer.FunctionCall{
					CallID: callID,
					RunID:  runID,
					Spec: humanlayer.FunctionCallSpec{
						Fn: "test_function",
					},
				}
				mockStore.EXPECT().GetFunctionCall(callID).Return(fc, nil).AnyTimes()

				// API approval succeeds
				mockClient.EXPECT().ApproveFunctionCall(gomock.Any(), callID, "test comment").Return(nil)

				// Mark as responded
				mockStore.EXPECT().MarkFunctionCallResponded(callID).Return(nil)

				// Update approval status
				convStore.EXPECT().UpdateApprovalStatus(gomock.Any(), callID, store.ApprovalStatusApproved).Return(nil)

				// Get session by run_id
				session := &store.Session{
					ID:     sessionID,
					RunID:  runID,
					Status: store.SessionStatusWaitingInput,
				}
				convStore.EXPECT().GetSessionByRunID(gomock.Any(), runID).Return(session, nil)

				// Expect status update to running
				convStore.EXPECT().
					UpdateSession(gomock.Any(), sessionID, gomock.Any()).
					DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
						if update.Status == nil || *update.Status != store.SessionStatusRunning {
							t.Errorf("expected status update to running, got %v", update.Status)
						}
						return nil
					})

				return callID
			},
			expectedStatus: store.SessionStatusRunning,
		},
		{
			name: "deny_updates_session_to_running",
			setupTest: func(mockClient *MockAPIClient, mockStore *MockStore, convStore *store.MockConversationStore) string {
				callID := "fc-deny-123"
				runID := "run-deny-456"
				sessionID := "sess-deny-789"

				// Function call exists
				fc := &humanlayer.FunctionCall{
					CallID: callID,
					RunID:  runID,
					Spec: humanlayer.FunctionCallSpec{
						Fn: "test_function",
					},
				}
				mockStore.EXPECT().GetFunctionCall(callID).Return(fc, nil).Times(1)

				// API denial succeeds
				mockClient.EXPECT().DenyFunctionCall(gomock.Any(), callID, "test reason").Return(nil)

				// Mark as responded
				mockStore.EXPECT().MarkFunctionCallResponded(callID).Return(nil)

				// Update approval status
				convStore.EXPECT().UpdateApprovalStatus(gomock.Any(), callID, store.ApprovalStatusDenied).Return(nil)

				// Get session by run_id
				session := &store.Session{
					ID:     sessionID,
					RunID:  runID,
					Status: store.SessionStatusWaitingInput,
				}
				convStore.EXPECT().GetSessionByRunID(gomock.Any(), runID).Return(session, nil)

				// Expect status update to running
				convStore.EXPECT().
					UpdateSession(gomock.Any(), sessionID, gomock.Any()).
					DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
						if update.Status == nil || *update.Status != store.SessionStatusRunning {
							t.Errorf("expected status update to running, got %v", update.Status)
						}
						return nil
					})

				return callID
			},
			expectedStatus: store.SessionStatusRunning,
		},
		{
			name: "no_status_update_for_non_waiting_session",
			setupTest: func(mockClient *MockAPIClient, mockStore *MockStore, convStore *store.MockConversationStore) string {
				callID := "fc-nochange-123"
				runID := "run-nochange-456"
				sessionID := "sess-nochange-789"

				// Function call exists
				fc := &humanlayer.FunctionCall{
					CallID: callID,
					RunID:  runID,
					Spec: humanlayer.FunctionCallSpec{
						Fn: "test_function",
					},
				}
				mockStore.EXPECT().GetFunctionCall(callID).Return(fc, nil).Times(1)

				// API approval succeeds
				mockClient.EXPECT().ApproveFunctionCall(gomock.Any(), callID, "test comment").Return(nil)

				// Mark as responded
				mockStore.EXPECT().MarkFunctionCallResponded(callID).Return(nil)

				// Update approval status
				convStore.EXPECT().UpdateApprovalStatus(gomock.Any(), callID, store.ApprovalStatusApproved).Return(nil)

				// Get session - session is already running, not waiting
				session := &store.Session{
					ID:     sessionID,
					RunID:  runID,
					Status: store.SessionStatusRunning, // Already running
				}
				convStore.EXPECT().GetSessionByRunID(gomock.Any(), runID).Return(session, nil)

				// No status update should happen since session is not waiting

				return callID
			},
			expectedStatus: store.SessionStatusRunning,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a new controller for each test to isolate expectations
			testCtrl := gomock.NewController(t)
			defer testCtrl.Finish()

			// Create mocks
			mockClient := NewMockAPIClient(testCtrl)
			mockStore := NewMockStore(testCtrl)
			convStore := store.NewMockConversationStore(testCtrl)

			// Create manager
			manager := &DefaultManager{
				Client:            mockClient,
				Store:             mockStore,
				ConversationStore: convStore,
			}

			// Setup test expectations and get callID
			callID := tt.setupTest(mockClient, mockStore, convStore)

			// Execute based on test type
			ctx := context.Background()
			var err error
			if tt.name == "deny_updates_session_to_running" {
				err = manager.DenyFunctionCall(ctx, callID, "test reason")
			} else {
				err = manager.ApproveFunctionCall(ctx, callID, "test comment")
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Expectations are verified by gomock
		})
	}
}
