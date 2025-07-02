package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

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

	handlers := NewSessionHandlers(mockManager, mockStore)

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

	handlers := NewSessionHandlers(mockManager, mockStore)

	t.Run("successful get session state", func(t *testing.T) {
		sessionID := "sess-123"
		now := time.Now()
		completedAt := now.Add(10 * time.Minute)
		costUSD := 0.05
		totalTokens := 1500
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
			TotalTokens:     &totalTokens,
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
		assert.Equal(t, 1500, resp.Session.TotalTokens)
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

	handlers := NewSessionHandlers(mockManager, mockStore)

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
	handlers := NewSessionHandlers(mockManager, mockStore)

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
