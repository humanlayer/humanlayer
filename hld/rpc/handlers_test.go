package rpc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestHandleGetConversation(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("get conversation by session ID", func(t *testing.T) {
		sessionID := "sess-123"
		claudeSessionID := "claude-456"

		// Mock data
		events := []*store.ConversationEvent{
			{
				ID:              1,
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        1,
				EventType:       store.EventTypeMessage,
				CreatedAt:       time.Now(),
				Role:            "assistant",
				Content:         "Hello! How can I help you?",
			},
			{
				ID:              2,
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				Sequence:        2,
				EventType:       store.EventTypeToolCall,
				CreatedAt:       time.Now(),
				ToolID:          "tool-1",
				ToolName:        "calculator",
				ToolInputJSON:   `{"operation": "add", "a": 1, "b": 2}`,
			},
		}

		mockStore.EXPECT().
			GetSessionConversation(gomock.Any(), sessionID).
			Return(events, nil)

		req := GetConversationRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetConversation(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetConversationResponse)
		require.True(t, ok)
		assert.Len(t, resp.Events, 2)
		assert.Equal(t, "assistant", resp.Events[0].Role)
		assert.Equal(t, "Hello! How can I help you?", resp.Events[0].Content)
		assert.Equal(t, "calculator", resp.Events[1].ToolName)
	})

	t.Run("get conversation by Claude session ID", func(t *testing.T) {
		claudeSessionID := "claude-456"

		events := []*store.ConversationEvent{
			{
				ID:              1,
				SessionID:       "sess-123",
				ClaudeSessionID: claudeSessionID,
				Sequence:        1,
				EventType:       store.EventTypeMessage,
				CreatedAt:       time.Now(),
				Role:            "user",
				Content:         "What is 2+2?",
			},
		}

		mockStore.EXPECT().
			GetConversation(gomock.Any(), claudeSessionID).
			Return(events, nil)

		req := GetConversationRequest{
			ClaudeSessionID: claudeSessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetConversation(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetConversationResponse)
		require.True(t, ok)
		assert.Len(t, resp.Events, 1)
		assert.Equal(t, "user", resp.Events[0].Role)
	})

	t.Run("missing both session IDs", func(t *testing.T) {
		req := GetConversationRequest{}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetConversation(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "either session_id or claude_session_id is required")
	})

	t.Run("invalid JSON", func(t *testing.T) {
		_, err := handlers.HandleGetConversation(context.Background(), []byte(`invalid json`))
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid request")
	})
}

func TestHandleGetSessionState(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("successful get session state", func(t *testing.T) {
		sessionID := "sess-123"
		now := time.Now()
		completedAt := now.Add(10 * time.Minute)
		costUSD := 0.05
		durationMS := 600000

		dbSession := &store.Session{
			ID:              sessionID,
			RunID:           "run-456",
			ClaudeSessionID: "claude-789",
			Status:          store.SessionStatusCompleted,
			Query:           "Help me write a function",
			Model:           "claude-3-opus",
			WorkingDir:      "/home/user/project",
			CreatedAt:       now,
			LastActivityAt:  completedAt,
			CompletedAt:     &completedAt,
			CostUSD:         &costUSD,
			DurationMS:      &durationMS,
			ErrorMessage:    "",
		}

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(dbSession, nil)

		req := GetSessionStateRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetSessionState(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionStateResponse)
		require.True(t, ok)
		assert.Equal(t, sessionID, resp.Session.ID)
		assert.Equal(t, "run-456", resp.Session.RunID)
		assert.Equal(t, "claude-789", resp.Session.ClaudeSessionID)
		assert.Equal(t, store.SessionStatusCompleted, resp.Session.Status)
		assert.Equal(t, 0.05, resp.Session.CostUSD)
		assert.Equal(t, 600000, resp.Session.DurationMS)
		assert.NotEmpty(t, resp.Session.CompletedAt)
	})

	t.Run("session with error", func(t *testing.T) {
		sessionID := "sess-error"
		now := time.Now()

		dbSession := &store.Session{
			ID:             sessionID,
			RunID:          "run-error",
			Status:         store.SessionStatusFailed,
			Query:          "Failed query",
			CreatedAt:      now,
			LastActivityAt: now,
			ErrorMessage:   "Connection timeout",
		}

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(dbSession, nil)

		req := GetSessionStateRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetSessionState(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionStateResponse)
		require.True(t, ok)
		assert.Equal(t, store.SessionStatusFailed, resp.Session.Status)
		assert.Equal(t, "Connection timeout", resp.Session.ErrorMessage)
	})

	t.Run("missing session ID", func(t *testing.T) {
		req := GetSessionStateRequest{}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetSessionState(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "session_id is required")
	})

	t.Run("session not found", func(t *testing.T) {
		sessionID := "nonexistent"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(nil, assert.AnError)

		req := GetSessionStateRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetSessionState(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get session")
	})
}

func TestHandleGetSessionLeaves(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("empty sessions list", func(t *testing.T) {
		// Mock empty sessions
		mockManager.EXPECT().
			ListSessions().
			Return([]session.Info{})

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Empty(t, resp.Sessions)
	})

	t.Run("single session with no parent or children", func(t *testing.T) {
		// Single session is always a leaf
		sessions := []session.Info{
			{
				ID:              "sess-1",
				RunID:           "run-1",
				ClaudeSessionID: "claude-1",
				ParentSessionID: "",
				Status:          session.StatusCompleted,
				StartTime:       time.Now().Add(-time.Hour),
				LastActivityAt:  time.Now().Add(-30 * time.Minute),
				Query:           "Test query",
				Summary:         "Test summary",
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 1)
		assert.Equal(t, "sess-1", resp.Sessions[0].ID)
	})

	t.Run("linear chain of sessions", func(t *testing.T) {
		// A->B->C, should return only C
		now := time.Now()
		sessions := []session.Info{
			{
				ID:              "sess-1",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-3 * time.Hour),
			},
			{
				ID:              "sess-2",
				ParentSessionID: "sess-1",
				LastActivityAt:  now.Add(-2 * time.Hour),
			},
			{
				ID:              "sess-3",
				ParentSessionID: "sess-2",
				LastActivityAt:  now.Add(-1 * time.Hour),
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 1)
		assert.Equal(t, "sess-3", resp.Sessions[0].ID)
	})

	t.Run("multiple independent sessions", func(t *testing.T) {
		// Three independent sessions, all are leaves
		now := time.Now()
		sessions := []session.Info{
			{
				ID:              "sess-1",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-3 * time.Hour),
			},
			{
				ID:              "sess-2",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-1 * time.Hour),
			},
			{
				ID:              "sess-3",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-2 * time.Hour),
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 3)
		// Should be sorted by last activity (newest first)
		assert.Equal(t, "sess-2", resp.Sessions[0].ID)
		assert.Equal(t, "sess-3", resp.Sessions[1].ID)
		assert.Equal(t, "sess-1", resp.Sessions[2].ID)
	})

	t.Run("session with multiple children (fork)", func(t *testing.T) {
		// A has two children B and C, should return B and C
		now := time.Now()
		sessions := []session.Info{
			{
				ID:              "sess-1",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-3 * time.Hour),
			},
			{
				ID:              "sess-2",
				ParentSessionID: "sess-1",
				LastActivityAt:  now.Add(-2 * time.Hour),
			},
			{
				ID:              "sess-3",
				ParentSessionID: "sess-1",
				LastActivityAt:  now.Add(-1 * time.Hour),
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 2)
		// Should be sorted by last activity (newest first)
		assert.Equal(t, "sess-3", resp.Sessions[0].ID)
		assert.Equal(t, "sess-2", resp.Sessions[1].ID)
	})

	t.Run("deep tree structure", func(t *testing.T) {
		// Complex tree:
		//       A
		//      / \
		//     B   C
		//    /     \
		//   D       E
		//            \
		//             F
		// Should return D and F
		now := time.Now()
		sessions := []session.Info{
			{
				ID:              "sess-A",
				ParentSessionID: "",
				LastActivityAt:  now.Add(-6 * time.Hour),
			},
			{
				ID:              "sess-B",
				ParentSessionID: "sess-A",
				LastActivityAt:  now.Add(-5 * time.Hour),
			},
			{
				ID:              "sess-C",
				ParentSessionID: "sess-A",
				LastActivityAt:  now.Add(-4 * time.Hour),
			},
			{
				ID:              "sess-D",
				ParentSessionID: "sess-B",
				LastActivityAt:  now.Add(-3 * time.Hour),
			},
			{
				ID:              "sess-E",
				ParentSessionID: "sess-C",
				LastActivityAt:  now.Add(-2 * time.Hour),
			},
			{
				ID:              "sess-F",
				ParentSessionID: "sess-E",
				LastActivityAt:  now.Add(-1 * time.Hour),
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), nil)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 2)
		// Should be sorted by last activity (newest first)
		assert.Equal(t, "sess-F", resp.Sessions[0].ID)
		assert.Equal(t, "sess-D", resp.Sessions[1].ID)
	})

	t.Run("with request parameters", func(t *testing.T) {
		// Test that request parameters are properly parsed (even though empty for now)
		sessions := []session.Info{
			{
				ID:              "sess-1",
				ParentSessionID: "",
				LastActivityAt:  time.Now(),
			},
		}

		mockManager.EXPECT().
			ListSessions().
			Return(sessions)

		req := GetSessionLeavesRequest{}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetSessionLeaves(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionLeavesResponse)
		require.True(t, ok)
		assert.Len(t, resp.Sessions, 1)
	})
}

func TestHandleInterruptSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)
	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("successful interrupt", func(t *testing.T) {
		sessionID := "test-123"

		// Mock store response
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusRunning,
			}, nil)

		// Mock manager response
		mockManager.EXPECT().
			InterruptSession(gomock.Any(), sessionID).
			Return(nil)

		req := InterruptSessionRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleInterruptSession(context.Background(), reqJSON)
		require.NoError(t, err)
		require.NotNil(t, result)
	})

	t.Run("missing session ID", func(t *testing.T) {
		req := InterruptSessionRequest{}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleInterruptSession(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "session_id is required")
	})

	t.Run("session not found", func(t *testing.T) {
		sessionID := "nonexistent"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(nil, fmt.Errorf("session not found"))

		req := InterruptSessionRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleInterruptSession(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get session")
	})

	t.Run("session not running", func(t *testing.T) {
		sessionID := "completed-123"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusCompleted,
			}, nil)

		req := InterruptSessionRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleInterruptSession(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "cannot interrupt session with status completed")
	})

	t.Run("interrupt fails", func(t *testing.T) {
		sessionID := "fail-123"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusRunning,
			}, nil)

		mockManager.EXPECT().
			InterruptSession(gomock.Any(), sessionID).
			Return(fmt.Errorf("interrupt failed"))

		req := InterruptSessionRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleInterruptSession(context.Background(), reqJSON)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "failed to interrupt session")
	})
}

func TestHandleGetSessionSnapshots(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("successful retrieval", func(t *testing.T) {
		sessionID := "test-session"
		now := time.Now()

		// Mock session exists
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:        sessionID,
				RunID:     "test-run",
				Status:    store.SessionStatusRunning,
				CreatedAt: now,
			}, nil)

		// Mock snapshots
		snapshots := []store.FileSnapshot{
			{
				ID:        1,
				ToolID:    "tool-123",
				SessionID: sessionID,
				FilePath:  "src/main.go",
				Content:   "package main\n\nfunc main() {}",
				CreatedAt: now.Add(-5 * time.Minute),
			},
			{
				ID:        2,
				ToolID:    "tool-456",
				SessionID: sessionID,
				FilePath:  "src/helper.go",
				Content:   "package main\n\nfunc helper() {}",
				CreatedAt: now.Add(-3 * time.Minute),
			},
		}

		mockStore.EXPECT().
			GetFileSnapshots(gomock.Any(), sessionID).
			Return(snapshots, nil)

		req := GetSessionSnapshotsRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetSessionSnapshots(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionSnapshotsResponse)
		require.True(t, ok)
		require.Len(t, resp.Snapshots, 2)

		// Verify snapshots are returned in order
		assert.Equal(t, "src/main.go", resp.Snapshots[0].FilePath)
		assert.Equal(t, "src/helper.go", resp.Snapshots[1].FilePath)
		assert.Equal(t, "tool-123", resp.Snapshots[0].ToolID)
		assert.Equal(t, "tool-456", resp.Snapshots[1].ToolID)
		assert.Equal(t, "package main\n\nfunc main() {}", resp.Snapshots[0].Content)
		assert.Equal(t, "package main\n\nfunc helper() {}", resp.Snapshots[1].Content)

		// Verify timestamps are in ISO 8601 format
		_, err = time.Parse(time.RFC3339, resp.Snapshots[0].CreatedAt)
		assert.NoError(t, err)
		_, err = time.Parse(time.RFC3339, resp.Snapshots[1].CreatedAt)
		assert.NoError(t, err)
	})

	t.Run("non-existent session", func(t *testing.T) {
		sessionID := "non-existent"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(nil, sql.ErrNoRows)

		req := GetSessionSnapshotsRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetSessionSnapshots(context.Background(), reqJSON)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "session not found")
	})

	t.Run("missing session_id", func(t *testing.T) {
		req := GetSessionSnapshotsRequest{}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetSessionSnapshots(context.Background(), reqJSON)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "session_id is required")
	})

	t.Run("empty snapshots", func(t *testing.T) {
		sessionID := "empty-session"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusCompleted,
			}, nil)

		mockStore.EXPECT().
			GetFileSnapshots(gomock.Any(), sessionID).
			Return([]store.FileSnapshot{}, nil)

		req := GetSessionSnapshotsRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleGetSessionSnapshots(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(*GetSessionSnapshotsResponse)
		require.True(t, ok)
		assert.Len(t, resp.Snapshots, 0)
		assert.NotNil(t, resp.Snapshots) // Should be empty array, not nil
	})

	t.Run("invalid JSON", func(t *testing.T) {
		_, err := handlers.HandleGetSessionSnapshots(context.Background(), []byte(`invalid json`))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid request")
	})

	t.Run("store error", func(t *testing.T) {
		sessionID := "error-session"

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusRunning,
			}, nil)

		mockStore.EXPECT().
			GetFileSnapshots(gomock.Any(), sessionID).
			Return(nil, fmt.Errorf("database error"))

		req := GetSessionSnapshotsRequest{
			SessionID: sessionID,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleGetSessionSnapshots(context.Background(), reqJSON)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get snapshots")
	})
}

func TestHandleUpdateSessionSettings(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := NewSessionHandlers(mockManager, mockStore, mockApprovalManager)

	t.Run("auto-approve pending approvals when bypass permissions enabled", func(t *testing.T) {
		sessionID := "sess-auto"
		enabled := true

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusWaitingInput,
			}, nil)

		mockStore.EXPECT().
			UpdateSession(gomock.Any(), sessionID, gomock.Any()).
			Return(nil)

		// Mock getting pending approvals
		pendingApprovals := []*store.Approval{
			{
				ID:        "approval-1",
				SessionID: sessionID,
				ToolName:  "Bash",
				Status:    store.ApprovalStatusLocalPending,
			},
			{
				ID:        "approval-2",
				SessionID: sessionID,
				ToolName:  "Write",
				Status:    store.ApprovalStatusLocalPending,
			},
		}

		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), sessionID).
			Return(pendingApprovals, nil)

		// Expect each approval to be auto-approved
		mockApprovalManager.EXPECT().
			ApproveToolCall(gomock.Any(), "approval-1", "Auto-approved due to bypass permissions").
			Return(nil)
		mockApprovalManager.EXPECT().
			ApproveToolCall(gomock.Any(), "approval-2", "Auto-approved due to bypass permissions").
			Return(nil)

		req := UpdateSessionSettingsRequest{
			SessionID:                  sessionID,
			DangerouslySkipPermissions: &enabled,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleUpdateSessionSettings(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(UpdateSessionSettingsResponse)
		require.True(t, ok)
		assert.True(t, resp.Success)
	})

	t.Run("auto-approve handles errors gracefully", func(t *testing.T) {
		sessionID := "sess-error"
		enabled := true

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusRunning,
			}, nil)

		mockStore.EXPECT().
			UpdateSession(gomock.Any(), sessionID, gomock.Any()).
			Return(nil)

		// Mock getting pending approvals returns error
		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), sessionID).
			Return(nil, fmt.Errorf("database error"))

		// Should still return success since auto-approval is best-effort
		req := UpdateSessionSettingsRequest{
			SessionID:                  sessionID,
			DangerouslySkipPermissions: &enabled,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleUpdateSessionSettings(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(UpdateSessionSettingsResponse)
		require.True(t, ok)
		assert.True(t, resp.Success)
	})

	t.Run("no auto-approve when no pending approvals", func(t *testing.T) {
		sessionID := "sess-none"
		enabled := true

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(&store.Session{
				ID:     sessionID,
				Status: store.SessionStatusRunning,
			}, nil)

		mockStore.EXPECT().
			UpdateSession(gomock.Any(), sessionID, gomock.Any()).
			Return(nil)

		// Mock getting pending approvals - empty list
		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), sessionID).
			Return([]*store.Approval{}, nil)

		// No calls to ApproveToolCall expected

		req := UpdateSessionSettingsRequest{
			SessionID:                  sessionID,
			DangerouslySkipPermissions: &enabled,
		}
		reqJSON, _ := json.Marshal(req)

		result, err := handlers.HandleUpdateSessionSettings(context.Background(), reqJSON)
		require.NoError(t, err)

		resp, ok := result.(UpdateSessionSettingsResponse)
		require.True(t, ok)
		assert.True(t, resp.Success)
	})

	t.Run("session not found", func(t *testing.T) {
		sessionID := "sess-missing"
		enabled := true

		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(nil, sql.ErrNoRows)

		req := UpdateSessionSettingsRequest{
			SessionID:                  sessionID,
			DangerouslySkipPermissions: &enabled,
		}
		reqJSON, _ := json.Marshal(req)

		_, err := handlers.HandleUpdateSessionSettings(context.Background(), reqJSON)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to get session")
	})
}
