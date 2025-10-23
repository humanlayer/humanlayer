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
					LaunchSession(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, config session.LaunchSessionConfig, isDraft bool) (*session.Session, error) {
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
					LaunchSession(gomock.Any(), gomock.Any(), gomock.Any()).
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
							Command: stringPtr("node"),
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
					LaunchSession(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, config session.LaunchSessionConfig, isDraft bool) (*session.Session, error) {
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

	t.Run("list all sessions with leavesOnly=false", func(t *testing.T) {
		mockManager.EXPECT().
			ListSessions().
			Return(sessionInfos)

		w := makeRequest(t, router, "GET", "/api/v1/sessions?leavesOnly=false", nil)

		var resp struct {
			Data []api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Len(t, resp.Data, 3)
	})

	t.Run("filter normal sessions", func(t *testing.T) {
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

		// filter=normal should exclude archived
		w := makeRequest(t, router, "GET", "/api/v1/sessions?filter=normal", nil)

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
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-123", store.SessionUpdate{
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
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-456", store.SessionUpdate{
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
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-789", store.SessionUpdate{
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

	t.Run("update model with proxy configuration", func(t *testing.T) {
		newModel := "opus"
		proxyEnabled := true
		proxyModelOverride := "openai/gpt-oss-120b"

		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-model", store.SessionUpdate{
				Model:              &newModel,
				ProxyEnabled:       &proxyEnabled,
				ProxyModelOverride: &proxyModelOverride,
			}).
			Return(nil)

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-model").
			Return(&store.Session{
				ID:                 "sess-model",
				RunID:              "run-model",
				Status:             "running",
				Query:              "Test query",
				CreatedAt:          time.Now().Add(-10 * time.Minute),
				LastActivityAt:     time.Now(),
				Model:              newModel,
				ProxyEnabled:       proxyEnabled,
				ProxyModelOverride: proxyModelOverride,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			Model:              &newModel,
			ProxyEnabled:       &proxyEnabled,
			ProxyModelOverride: &proxyModelOverride,
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-model", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-model", resp.Data.Id)
		assert.NotNil(t, resp.Data.Model)
		assert.Equal(t, newModel, *resp.Data.Model)
	})

	t.Run("session not found", func(t *testing.T) {
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-999", gomock.Any()).
			Return(sql.ErrNoRows)

		updateReq := api.UpdateSessionRequest{
			AutoAcceptEdits: boolPtr(false),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-999", updateReq)

		assertErrorResponse(t, w, "HLD-1002", "Session not found")
		assert.Equal(t, 404, w.Code)
	})

	t.Run("auto-approve pending approvals when bypass permissions enabled", func(t *testing.T) {
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-auto", store.SessionUpdate{
				DangerouslySkipPermissions: boolPtr(true),
			}).
			Return(nil)

		// Mock getting pending approvals
		pendingApprovals := []*store.Approval{
			{
				ID:        "approval-1",
				SessionID: "sess-auto",
				ToolName:  "Bash",
				Status:    store.ApprovalStatusLocalPending,
			},
			{
				ID:        "approval-2",
				SessionID: "sess-auto",
				ToolName:  "Write",
				Status:    store.ApprovalStatusLocalPending,
			},
		}

		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), "sess-auto").
			Return(pendingApprovals, nil)

		// Expect each approval to be auto-approved
		mockApprovalManager.EXPECT().
			ApproveToolCall(gomock.Any(), "approval-1", "Auto-approved due to bypass permissions").
			Return(nil)
		mockApprovalManager.EXPECT().
			ApproveToolCall(gomock.Any(), "approval-2", "Auto-approved due to bypass permissions").
			Return(nil)

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-auto").
			Return(&store.Session{
				ID:                         "sess-auto",
				RunID:                      "run-auto",
				Status:                     "running",
				Query:                      "Test query",
				CreatedAt:                  time.Now().Add(-10 * time.Minute),
				LastActivityAt:             time.Now(),
				DangerouslySkipPermissions: true,
				Archived:                   false,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			DangerouslySkipPermissions: boolPtr(true),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-auto", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-auto", resp.Data.Id)
		assert.NotNil(t, resp.Data.DangerouslySkipPermissions)
		assert.True(t, *resp.Data.DangerouslySkipPermissions)
	})

	t.Run("auto-approve handles errors gracefully", func(t *testing.T) {
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-error", store.SessionUpdate{
				DangerouslySkipPermissions: boolPtr(true),
			}).
			Return(nil)

		// Mock getting pending approvals returns error
		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), "sess-error").
			Return(nil, fmt.Errorf("database error"))

		// Should still return success since auto-approval is best-effort
		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-error").
			Return(&store.Session{
				ID:                         "sess-error",
				RunID:                      "run-error",
				Status:                     "running",
				Query:                      "Test query",
				CreatedAt:                  time.Now().Add(-10 * time.Minute),
				LastActivityAt:             time.Now(),
				DangerouslySkipPermissions: true,
				Archived:                   false,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			DangerouslySkipPermissions: boolPtr(true),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-error", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-error", resp.Data.Id)
	})

	t.Run("no auto-approve when no pending approvals", func(t *testing.T) {
		mockManager.EXPECT().
			UpdateSessionSettings(gomock.Any(), "sess-none", store.SessionUpdate{
				DangerouslySkipPermissions: boolPtr(true),
			}).
			Return(nil)

		// Mock getting pending approvals - empty list
		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), "sess-none").
			Return([]*store.Approval{}, nil)

		// No calls to ApproveToolCall expected

		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-none").
			Return(&store.Session{
				ID:                         "sess-none",
				RunID:                      "run-none",
				Status:                     "running",
				Query:                      "Test query",
				CreatedAt:                  time.Now().Add(-10 * time.Minute),
				LastActivityAt:             time.Now(),
				DangerouslySkipPermissions: true,
				Archived:                   false,
			}, nil)

		updateReq := api.UpdateSessionRequest{
			DangerouslySkipPermissions: boolPtr(true),
		}
		w := makeRequest(t, router, "PATCH", "/api/v1/sessions/sess-none", updateReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "sess-none", resp.Data.Id)
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
		// Expect the new method calls
		mockManager.EXPECT().IsClaudeAvailable().Return(true).Times(1)
		mockManager.EXPECT().GetClaudeBinaryPath().Return("/usr/local/bin/claude").Times(1)
		mockManager.EXPECT().GetClaudeVersion().Return("1.0.110", nil).Times(1)

		w := makeRequest(t, router, "GET", "/api/v1/health", nil)

		var resp api.HealthResponse
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, api.Ok, resp.Status)
		assert.NotEmpty(t, resp.Version)
		// Check dependencies are populated
		assert.NotNil(t, resp.Dependencies)
		if resp.Dependencies != nil && resp.Dependencies.Claude != nil {
			assert.True(t, resp.Dependencies.Claude.Available)
			assert.NotNil(t, resp.Dependencies.Claude.Path)
		}
	})

	t.Run("health check returns degraded when claude unavailable", func(t *testing.T) {
		// Expect the new method calls
		mockManager.EXPECT().IsClaudeAvailable().Return(false).Times(1)
		mockManager.EXPECT().GetClaudeBinaryPath().Return("").Times(1)
		// GetClaudeVersion is not called when Claude is not available

		w := makeRequest(t, router, "GET", "/api/v1/health", nil)

		var resp api.HealthResponse
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, api.Degraded, resp.Status)
		assert.NotEmpty(t, resp.Version)
		// Check dependencies are populated
		assert.NotNil(t, resp.Dependencies)
		if resp.Dependencies != nil && resp.Dependencies.Claude != nil {
			assert.False(t, resp.Dependencies.Claude.Available)
			assert.NotNil(t, resp.Dependencies.Claude.Error)
		}
	})
}

func TestSessionHandlers_LaunchDraftSession_BypassPermissionsTimerRecalculation(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	t.Run("recalculates bypass permissions timer on draft launch", func(t *testing.T) {
		sessionID := "sess-draft-123"
		timeoutMs := int64(900000) // 15 minutes

		// Set an expiration time in the past to simulate a draft that was set up earlier
		pastExpiration := time.Now().Add(-5 * time.Minute)

		// The draft session with bypass permissions enabled
		draftSession := &store.Session{
			ID:                                  sessionID,
			RunID:                               "run-draft-456",
			Status:                              store.SessionStatusDraft,
			Query:                               "Test draft query",
			CreatedAt:                           time.Now().Add(-10 * time.Minute),
			LastActivityAt:                      time.Now().Add(-10 * time.Minute),
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &pastExpiration,
			DangerouslySkipPermissionsTimeoutMs: &timeoutMs,
		}

		// Mock getting the draft session
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(draftSession, nil).
			Times(1)

		// Expect UpdateSession to be called with recalculated expiration
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), sessionID, gomock.Any()).
			DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
				// Verify that the expiration was recalculated
				require.NotNil(t, update.DangerouslySkipPermissionsExpiresAt)
				require.NotNil(t, *update.DangerouslySkipPermissionsExpiresAt)

				newExpiration := **update.DangerouslySkipPermissionsExpiresAt
				now := time.Now()

				// The new expiration should be approximately now + 15 minutes
				expectedExpiration := now.Add(time.Duration(timeoutMs) * time.Millisecond)

				// Allow 2 seconds of tolerance for test execution time
				timeDiff := newExpiration.Sub(expectedExpiration)
				assert.True(t, timeDiff < 2*time.Second && timeDiff > -2*time.Second,
					"Expected expiration to be recalculated to ~15 minutes from now, got difference of %v", timeDiff)

				return nil
			}).
			Times(1)

		// Mock launching the draft session
		mockManager.EXPECT().
			LaunchDraftSession(gomock.Any(), sessionID, "Test prompt", false).
			Return(nil).
			Times(1)

		// Mock getting the updated session after launch
		launchedSession := &store.Session{
			ID:             sessionID,
			RunID:          "run-draft-456",
			Status:         store.SessionStatusStarting,
			Query:          "Test draft query",
			CreatedAt:      time.Now().Add(-10 * time.Minute),
			LastActivityAt: time.Now(),
		}
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(launchedSession, nil).
			Times(1)

		// Make the launch request
		launchReq := api.LaunchDraftSessionJSONBody{
			Prompt: "Test prompt",
		}
		w := makeRequest(t, router, "POST", fmt.Sprintf("/api/v1/sessions/%s/launch", sessionID), launchReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, sessionID, resp.Data.Id)
		assert.Equal(t, api.SessionStatusStarting, resp.Data.Status)
	})

	t.Run("does not recalculate timer when bypass permissions disabled", func(t *testing.T) {
		sessionID := "sess-draft-no-bypass"

		// Draft session without bypass permissions
		draftSession := &store.Session{
			ID:                         sessionID,
			RunID:                      "run-draft-789",
			Status:                     store.SessionStatusDraft,
			Query:                      "Test draft query",
			CreatedAt:                  time.Now().Add(-10 * time.Minute),
			LastActivityAt:             time.Now().Add(-10 * time.Minute),
			DangerouslySkipPermissions: false,
		}

		// Mock getting the draft session
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(draftSession, nil).
			Times(1)

		// UpdateSession should NOT be called since bypass permissions is disabled

		// Mock launching the draft session
		mockManager.EXPECT().
			LaunchDraftSession(gomock.Any(), sessionID, "Test prompt", false).
			Return(nil).
			Times(1)

		// Mock getting the updated session after launch
		launchedSession := &store.Session{
			ID:             sessionID,
			RunID:          "run-draft-789",
			Status:         store.SessionStatusStarting,
			Query:          "Test draft query",
			CreatedAt:      time.Now().Add(-10 * time.Minute),
			LastActivityAt: time.Now(),
		}
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(launchedSession, nil).
			Times(1)

		// Make the launch request
		launchReq := api.LaunchDraftSessionJSONBody{
			Prompt: "Test prompt",
		}
		w := makeRequest(t, router, "POST", fmt.Sprintf("/api/v1/sessions/%s/launch", sessionID), launchReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, sessionID, resp.Data.Id)
	})

	t.Run("does not recalculate timer when timeout not set", func(t *testing.T) {
		sessionID := "sess-draft-no-timeout"

		// Draft session with bypass permissions but no timeout
		draftSession := &store.Session{
			ID:                         sessionID,
			RunID:                      "run-draft-abc",
			Status:                     store.SessionStatusDraft,
			Query:                      "Test draft query",
			CreatedAt:                  time.Now().Add(-10 * time.Minute),
			LastActivityAt:             time.Now().Add(-10 * time.Minute),
			DangerouslySkipPermissions: true,
			// No timeout set - unlimited bypass
			DangerouslySkipPermissionsTimeoutMs: nil,
		}

		// Mock getting the draft session
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(draftSession, nil).
			Times(1)

		// UpdateSession should NOT be called since there's no timeout to recalculate

		// Mock launching the draft session
		mockManager.EXPECT().
			LaunchDraftSession(gomock.Any(), sessionID, "Test prompt", false).
			Return(nil).
			Times(1)

		// Mock getting the updated session after launch
		launchedSession := &store.Session{
			ID:             sessionID,
			RunID:          "run-draft-abc",
			Status:         store.SessionStatusStarting,
			Query:          "Test draft query",
			CreatedAt:      time.Now().Add(-10 * time.Minute),
			LastActivityAt: time.Now(),
		}
		mockStore.EXPECT().
			GetSession(gomock.Any(), sessionID).
			Return(launchedSession, nil).
			Times(1)

		// Make the launch request
		launchReq := api.LaunchDraftSessionJSONBody{
			Prompt: "Test prompt",
		}
		w := makeRequest(t, router, "POST", fmt.Sprintf("/api/v1/sessions/%s/launch", sessionID), launchReq)

		var resp struct {
			Data api.Session `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, sessionID, resp.Data.Id)
	})
}

func TestSessionHandlers_BulkRestoreDrafts(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockManager := session.NewMockSessionManager(ctrl)
	mockStore := store.NewMockConversationStore(ctrl)
	mockApprovalManager := approval.NewMockManager(ctrl)

	handlers := handlers.NewSessionHandlers(mockManager, mockStore, mockApprovalManager)
	router := setupTestRouter(t, handlers, nil, nil)

	t.Run("restores multiple discarded drafts", func(t *testing.T) {
		// Setup test with discarded drafts
		sessionIDs := []string{"sess-draft-1", "sess-draft-2", "sess-draft-3"}

		// Mock each session as discarded and update to draft
		for _, sessionID := range sessionIDs {
			sess := &store.Session{
				ID:             sessionID,
				Status:         store.SessionStatusDiscarded,
				Query:          "Discarded draft",
				LastActivityAt: time.Now().Add(-1 * time.Hour),
			}

			mockStore.EXPECT().
				GetSession(gomock.Any(), sessionID).
				Return(sess, nil)

			mockStore.EXPECT().
				UpdateSession(gomock.Any(), sessionID, gomock.Any()).
				DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
					// Verify we're updating to draft status
					require.NotNil(t, update.Status)
					assert.Equal(t, string(store.SessionStatusDraft), *update.Status)
					return nil
				})
		}

		// Make the bulk restore request
		restoreReq := api.BulkRestoreDraftsRequest{
			SessionIds: sessionIDs,
		}
		w := makeRequest(t, router, "POST", "/api/v1/sessions/restore", restoreReq)

		var resp struct {
			Data struct {
				Success        bool     `json:"success"`
				FailedSessions []string `json:"failed_sessions,omitempty"`
			} `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.True(t, resp.Data.Success)
		assert.Empty(t, resp.Data.FailedSessions)
	})

	t.Run("handles partial failure gracefully", func(t *testing.T) {
		// Setup with mix of discarded and non-discarded sessions
		sessionIDs := []string{"sess-discarded-1", "sess-active-1", "sess-not-found-1"}

		// First session is discarded and should be restored
		discardedSess := &store.Session{
			ID:             "sess-discarded-1",
			Status:         store.SessionStatusDiscarded,
			Query:          "Discarded draft",
			LastActivityAt: time.Now().Add(-1 * time.Hour),
		}
		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-discarded-1").
			Return(discardedSess, nil)
		mockStore.EXPECT().
			UpdateSession(gomock.Any(), "sess-discarded-1", gomock.Any()).
			Return(nil)

		// Second session is active (not discarded) - should fail
		activeSess := &store.Session{
			ID:             "sess-active-1",
			Status:         store.SessionStatusRunning,
			Query:          "Active session",
			LastActivityAt: time.Now(),
		}
		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-active-1").
			Return(activeSess, nil)

		// Third session doesn't exist - should fail
		mockStore.EXPECT().
			GetSession(gomock.Any(), "sess-not-found-1").
			Return(nil, sql.ErrNoRows)

		// Make the bulk restore request
		restoreReq := api.BulkRestoreDraftsRequest{
			SessionIds: sessionIDs,
		}
		w := makeRequest(t, router, "POST", "/api/v1/sessions/restore", restoreReq)

		var resp struct {
			Data struct {
				Success        bool     `json:"success"`
				FailedSessions []string `json:"failed_sessions,omitempty"`
			} `json:"data"`
		}
		assertJSONResponse(t, w, 207, &resp)

		assert.False(t, resp.Data.Success)
		assert.Len(t, resp.Data.FailedSessions, 2)
		assert.Contains(t, resp.Data.FailedSessions, "sess-active-1")
		assert.Contains(t, resp.Data.FailedSessions, "sess-not-found-1")
	})

	t.Run("validates empty session_ids", func(t *testing.T) {
		// Call with empty array
		restoreReq := api.BulkRestoreDraftsRequest{
			SessionIds: []string{},
		}
		w := makeRequest(t, router, "POST", "/api/v1/sessions/restore", restoreReq)

		var resp struct {
			Error api.ErrorDetail `json:"error"`
		}
		assertJSONResponse(t, w, 400, &resp)

		assert.Equal(t, "HLD-3002", resp.Error.Code)
		assert.Contains(t, resp.Error.Message, "session_ids is required and must not be empty")
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
