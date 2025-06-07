package approval

import (
	"context"
	"fmt"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
	"go.uber.org/mock/gomock"
)

func TestPoller_CorrelateApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	tests := []struct {
		name               string
		functionCall       humanlayer.FunctionCall
		setupStore         func(mockStore *store.MockConversationStore)
		expectCorrelate    bool
		expectStatusUpdate bool
	}{
		{
			name: "successful_correlation",
			functionCall: humanlayer.FunctionCall{
				CallID: "fc-123",
				RunID:  "run-456",
				Spec: humanlayer.FunctionCallSpec{
					Fn: "dangerous_function",
				},
			},
			setupStore: func(mockStore *store.MockConversationStore) {
				// Expect GetSessionByRunID to find the session
				mockStore.EXPECT().
					GetSessionByRunID(gomock.Any(), "run-456").
					Return(&store.Session{
						ID:    "sess-789",
						RunID: "run-456",
					}, nil)

				// Return a pending tool call
				mockStore.EXPECT().
					GetPendingToolCall(gomock.Any(), "sess-789", "dangerous_function").
					Return(&store.ConversationEvent{
						ID:        1,
						SessionID: "sess-789",
						ToolName:  "dangerous_function",
					}, nil)

				// Expect correlation
				mockStore.EXPECT().
					CorrelateApproval(gomock.Any(), "sess-789", "dangerous_function", "fc-123").
					Return(nil)

				// Expect status update to waiting_input
				mockStore.EXPECT().
					UpdateSession(gomock.Any(), "sess-789", gomock.Any()).
					DoAndReturn(func(ctx context.Context, sessionID string, update store.SessionUpdate) error {
						if update.Status == nil || *update.Status != store.SessionStatusWaitingInput {
							t.Errorf("expected status update to waiting_input, got %v", update.Status)
						}
						return nil
					})
			},
			expectCorrelate:    true,
			expectStatusUpdate: true,
		},
		{
			name: "no_matching_session",
			functionCall: humanlayer.FunctionCall{
				CallID: "fc-999",
				RunID:  "unknown-run",
				Spec: humanlayer.FunctionCallSpec{
					Fn: "some_function",
				},
			},
			setupStore: func(mockStore *store.MockConversationStore) {
				// GetSessionByRunID returns nil (no matching session)
				mockStore.EXPECT().
					GetSessionByRunID(gomock.Any(), "unknown-run").
					Return(nil, nil)

				// No further calls should happen
			},
			expectCorrelate:    false,
			expectStatusUpdate: false,
		},
		{
			name: "nil_tool_call_returned",
			functionCall: humanlayer.FunctionCall{
				CallID: "fc-nil",
				RunID:  "run-nil",
				Spec: humanlayer.FunctionCallSpec{
					Fn: "nil_function",
				},
			},
			setupStore: func(mockStore *store.MockConversationStore) {
				// GetSessionByRunID returns a matching session
				mockStore.EXPECT().
					GetSessionByRunID(gomock.Any(), "run-nil").
					Return(&store.Session{
						ID:    "sess-nil",
						RunID: "run-nil",
					}, nil)

				// Return nil tool call (no error but no result)
				mockStore.EXPECT().
					GetPendingToolCall(gomock.Any(), "sess-nil", "nil_function").
					Return(nil, nil)

				// No correlation or status update should happen
			},
			expectCorrelate:    false,
			expectStatusUpdate: false,
		},
		{
			name: "get_session_error",
			functionCall: humanlayer.FunctionCall{
				CallID: "fc-error",
				RunID:  "run-error",
				Spec: humanlayer.FunctionCallSpec{
					Fn: "error_function",
				},
			},
			setupStore: func(mockStore *store.MockConversationStore) {
				// GetSessionByRunID returns an error
				mockStore.EXPECT().
					GetSessionByRunID(gomock.Any(), "run-error").
					Return(nil, fmt.Errorf("database error"))

				// No further calls should happen
			},
			expectCorrelate:    false,
			expectStatusUpdate: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create mock store
			mockStore := store.NewMockConversationStore(ctrl)
			tt.setupStore(mockStore)

			// Create poller with mock store
			poller := &Poller{
				conversationStore: mockStore,
			}

			// Call correlateApproval
			ctx := context.Background()
			poller.correlateApproval(ctx, tt.functionCall)

			// The expectations are verified by gomock
		})
	}
}
