package handlers_test

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestSessionHandlers_CreateSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	tests := []struct {
		name           string
		request        api.CreateSessionRequest
		mockSetup      func()
		expectedStatus int
		expectedError  *api.ErrorDetail
		validateBody   func(*testing.T, *api.CreateSessionResponse)
	}{
		{
			name: "successful session creation",
			request: api.CreateSessionRequest{
				Query:      "Help me write tests",
				Model:      modelPtr(api.Sonnet),
				WorkingDir: stringPtr("/home/user/project"),
			},
			mockSetup: func() {
				mockManager.EXPECT().
					LaunchSession(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, config claudecode.SessionConfig) (*session.Session, error) {
						// Validate the config passed to LaunchSession
						assert.Equal(t, "Help me write tests", config.Query)
						assert.Equal(t, claudecode.Model("sonnet"), config.Model)
						assert.Equal(t, "/home/user/project", config.WorkingDir)
						return &session.Session{
							ID:    "sess-123",
							RunID: "run-456",
						}, nil
					})
			},
			expectedStatus: 201,
			validateBody: func(t *testing.T, resp *api.CreateSessionResponse) {
				assert.Equal(t, "sess-123", resp.Data.SessionId)
				assert.Equal(t, "run-456", resp.Data.RunId)
			},
		},
		{
			name: "launch session failure",
			request: api.CreateSessionRequest{
				Query: "Help me",
				Model: modelPtr(api.Sonnet),
			},
			mockSetup: func() {
				mockManager.EXPECT().
					LaunchSession(gomock.Any(), gomock.Any()).
					Return(nil, fmt.Errorf("failed to start Claude"))
			},
			expectedStatus: 500,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-1001",
				Message: "failed to start Claude",
			},
		},
		{
			name: "with MCP config",
			request: api.CreateSessionRequest{
				Query: "Test with MCP",
				Model: modelPtr(api.Sonnet),
				McpConfig: &api.MCPConfig{
					McpServers: &map[string]api.MCPServer{
						"test-server": {
							Command: "node",
							Args:    &[]string{"server.js"},
							Env: &map[string]string{
								"DEBUG": "true",
							},
						},
					},
				},
			},
			mockSetup: func() {
				mockManager.EXPECT().
					LaunchSession(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, config claudecode.SessionConfig) (*session.Session, error) {
						// Verify MCP config was properly converted
						require.NotNil(t, config.MCPConfig)
						assert.Len(t, config.MCPConfig.MCPServers, 1)
						server := config.MCPConfig.MCPServers["test-server"]
						assert.Equal(t, "node", server.Command)
						assert.Equal(t, []string{"server.js"}, server.Args)
						assert.Equal(t, "true", server.Env["DEBUG"])
						return &session.Session{
							ID:    "sess-789",
							RunID: "run-012",
						}, nil
					})
			},
			expectedStatus: 201,
			validateBody: func(t *testing.T, resp *api.CreateSessionResponse) {
				assert.Equal(t, "sess-789", resp.Data.SessionId)
				assert.Equal(t, "run-012", resp.Data.RunId)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.mockSetup != nil {
				tt.mockSetup()
			}

			w := makeRequest(t, router, "POST", "/api/v1/sessions", tt.request)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedError != nil {
				assertErrorResponse(t, w, tt.expectedError.Code, tt.expectedError.Message)
			} else if tt.validateBody != nil {
				var resp api.CreateSessionResponse
				assertJSONResponse(t, w, tt.expectedStatus, &resp)
				tt.validateBody(t, &resp)
			}
		})
	}
}

func TestSessionHandlers_ListSessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	// Test data - using session.Info which is what ListSessions returns
	sessionInfos := []session.Info{
		{
			ID:             "sess-1",
			RunID:          "run-1",
			Status:         "completed",
			Query:          "First query",
			StartTime:      time.Now().Add(-2 * time.Hour),
			LastActivityAt: time.Now().Add(-1 * time.Hour),
			EndTime:        timePtr(time.Now().Add(-1 * time.Hour)),
			Summary:        "Completed first task",
			Model:          "claude-3-sonnet",
			WorkingDir:     "/home/user/project1",
			Archived:       false,
		},
		{
			ID:             "sess-2",
			RunID:          "run-2",
			Status:         "running",
			Query:          "Second query",
			StartTime:      time.Now().Add(-30 * time.Minute),
			LastActivityAt: time.Now(),
			Model:          "claude-3-opus",
			WorkingDir:     "/tmp/project",
			Archived:       false,
		},
		{
			ID:              "sess-3",
			RunID:           "run-3",
			Status:          "completed",
			Query:           "Child query",
			ParentSessionID: "sess-1",
			StartTime:       time.Now().Add(-15 * time.Minute),
			LastActivityAt:  time.Now().Add(-10 * time.Minute),
			Archived:        false,
		},
	}

	t.Run("list leaf sessions (default)", func(t *testing.T) {
		mockManager.EXPECT().
			ListSessions().
			Return(sessionInfos)

		w := makeRequest(t, router, "GET", "/api/v1/sessions", nil)

		var resp struct {
			Data []api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		// Should only return leaf sessions (sess-2 and sess-3, not sess-1 which has children)
		assert.Len(t, resp.Data, 2)
		foundIDs := make(map[string]bool)
		for _, s := range resp.Data {
			foundIDs[s.Id] = true
		}
		assert.True(t, foundIDs["sess-2"])
		assert.True(t, foundIDs["sess-3"])
		assert.False(t, foundIDs["sess-1"]) // Not a leaf
	})

	t.Run("list all sessions with leafOnly=false", func(t *testing.T) {
		mockManager.EXPECT().
			ListSessions().
			Return(sessionInfos)

		w := makeRequest(t, router, "GET", "/api/v1/sessions?leafOnly=false", nil)

		var resp struct {
			Data []api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Len(t, resp.Data, 3)
	})

	t.Run("filter archived sessions", func(t *testing.T) {
		archivedSessions := append(sessionInfos, session.Info{
			ID:             "sess-archived",
			RunID:          "run-archived",
			Status:         "completed",
			Query:          "Archived query",
			StartTime:      time.Now().Add(-2 * time.Hour),
			LastActivityAt: time.Now().Add(-1 * time.Hour),
			Archived:       true,
		})

		mockManager.EXPECT().
			ListSessions().
			Return(archivedSessions)

		// Default should exclude archived
		w := makeRequest(t, router, "GET", "/api/v1/sessions", nil)

		var resp struct {
			Data []api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		// Should not include archived session
		for _, s := range resp.Data {
			assert.NotEqual(t, "sess-archived", s.Id)
		}
	})
}

func TestSessionHandlers_GetSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	t.Run("get existing session", func(t *testing.T) {
		completedAt := time.Now().Add(-30 * time.Minute)
		session := store.Session{
			ID:              "sess-123",
			RunID:           "run-456",
			Status:          "completed",
			Query:           "Test query",
			CreatedAt:       time.Now().Add(-1 * time.Hour),
			LastActivityAt:  time.Now().Add(-30 * time.Minute),
			CompletedAt:     &completedAt,
			Summary:         "Test completed successfully",
			Model:           "claude-3-sonnet",
			WorkingDir:      "/home/user/project",
			CostUSD:         floatPtr(0.05),
			TotalTokens:     intPtr(1500),
			DurationMS:      intPtr(45000),
			AutoAcceptEdits: true,
			Archived:        false,
		}

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-123").
			Return(&session, nil)

		w := makeRequest(t, router, "GET", "/api/v1/sessions/sess-123", nil)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-123", resp.Data.Id)
		assert.Equal(t, "run-456", resp.Data.RunId)
		assert.Equal(t, api.SessionStatusCompleted, resp.Data.Status)
		assert.Equal(t, "Test query", resp.Data.Query)
		assert.NotNil(t, resp.Data.Summary)
		assert.Equal(t, "Test completed successfully", *resp.Data.Summary)
		assert.NotNil(t, resp.Data.CostUsd)
		assert.Equal(t, float32(0.05), *resp.Data.CostUsd)
		assert.NotNil(t, resp.Data.AutoAcceptEdits)
		assert.True(t, *resp.Data.AutoAcceptEdits)
	})

	t.Run("session not found", func(t *testing.T) {
		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-999").
			Return(nil, sql.ErrNoRows)

		w := makeRequest(t, router, "GET", "/api/v1/sessions/sess-999", nil)

		assertErrorResponse(t, w, "HLD-1002", "Session not found")
		assert.Equal(t, 404, w.Code)
	})
}

func TestSessionHandlers_UpdateSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	t.Run("update auto-accept edits", func(t *testing.T) {
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), "sess-123", store.SessionUpdate{
				AutoAcceptEdits: boolPtr(true),
			}).
			Return(nil)

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-123").
			Return(&store.Session{
				ID:              "sess-123",
				RunID:           "run-456",
				Status:          "running",
				Query:           "Test query",
				CreatedAt:       time.Now().Add(-10 * time.Minute),
				LastActivityAt:  time.Now(),
				AutoAcceptEdits: true,
				Archived:        false,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			AutoAcceptEdits: boolPtr(true),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-123", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-123", resp.Data.Id)
		assert.NotNil(t, resp.Data.AutoAcceptEdits)
		assert.True(t, *resp.Data.AutoAcceptEdits)
	})

	t.Run("archive session", func(t *testing.T) {
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), "sess-456", store.SessionUpdate{
				Archived: boolPtr(true),
			}).
			Return(nil)

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-456").
			Return(&store.Session{
				ID:              "sess-456",
				RunID:           "run-789",
				Status:          "completed",
				Query:           "Test query",
				CreatedAt:       time.Now().Add(-1 * time.Hour),
				LastActivityAt:  time.Now().Add(-30 * time.Minute),
				AutoAcceptEdits: false,
				Archived:        true,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			Archived: boolPtr(true),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-456", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.NotNil(t, resp.Data.Archived)
		assert.True(t, *resp.Data.Archived)
	})

	t.Run("update session title", func(t *testing.T) {
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), "sess-789", store.SessionUpdate{
				Title: stringPtr("Updated Task Title"),
			}).
			Return(nil)

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-789").
			Return(&store.Session{
				ID:              "sess-789",
				RunID:           "run-abc",
				Status:          "running",
				Query:           "Test query",
				Title:           "Updated Task Title",
				CreatedAt:       time.Now().Add(-10 * time.Minute),
				LastActivityAt:  time.Now(),
				AutoAcceptEdits: false,
				Archived:        false,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			Title: stringPtr("Updated Task Title"),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-789", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-789", resp.Data.Id)
		assert.NotNil(t, resp.Data.Title)
		assert.Equal(t, "Updated Task Title", *resp.Data.Title)
	})

	t.Run("session not found", func(t *testing.T) {
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), "sess-999", gomock.Any()).
			Return(sql.ErrNoRows)

		updateReq := api.UpdateSessionRequest{
			AutoAcceptEdits: boolPtr(false),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-999", updateReq)

		assertErrorResponse(t, w, "HLD-1002", "Session not found")
		assert.Equal(t, 404, w.Code)
	})
}

func TestSessionHandlers_GetHealth(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	t.Run("health check returns ok", func(t *testing.T) {
		w := makeRequest(t, router, "GET", "/api/v1/health", nil)

		var resp api.HealthResponse
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, api.Ok, resp.Status)
		assert.NotEmpty(t, resp.Version)
	})
}

// Helper functions
func floatPtr(f float64) *float64 {
	return &f
}

func intPtr(i int) *int {
	return &i
}

func boolPtr(b bool) *bool {
	return &b
}

func stringPtr(s string) *string {
	return &s
}

func modelPtr(m api.CreateSessionRequestModel) *api.CreateSessionRequestModel {
	return &m
}
