package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestApprovalHandlers_CreateApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockApprovalManager := approval.NewMockManager(ctrl)
	mockSessionManager := session.NewMockSessionManager(ctrl)

	handlers := handlers.NewApprovalHandlers(mockApprovalManager, mockSessionManager)
	router := setupTestRouter(t, nil, handlers, nil)

	tests := []struct {
		name           string
		request        api.CreateApprovalRequest
		mockSetup      func()
		expectedStatus int
		expectedError  *api.ErrorDetail
		validateBody   func(*testing.T, *api.CreateApprovalResponse)
	}{
		{
			name: "successful approval creation",
			request: api.CreateApprovalRequest{
				RunId:     "run-123",
				ToolName:  "bash",
				ToolInput: map[string]interface{}{"command": "ls -la"},
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					CreateApproval(gomock.Any(), "run-123", "bash", json.RawMessage(`{"command":"ls -la"}`)).
					Return("appr-456", nil)
			},
			expectedStatus: 201,
			validateBody: func(t *testing.T, resp *api.CreateApprovalResponse) {
				assert.Equal(t, "appr-456", resp.Data.ApprovalId)
			},
		},
		{
			name: "approval creation failure",
			request: api.CreateApprovalRequest{
				RunId:     "run-789",
				ToolName:  "write_file",
				ToolInput: map[string]interface{}{"path": "/etc/passwd", "content": "malicious"},
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					CreateApproval(gomock.Any(), "run-789", "write_file", json.RawMessage(`{"content":"malicious","path":"/etc/passwd"}`)).
					Return("", fmt.Errorf("permission denied"))
			},
			expectedStatus: 500,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-4001",
				Message: "permission denied",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.mockSetup != nil {
				tt.mockSetup()
			}

			w := makeRequest(t, router, "POST", "/api/v1/approvals", tt.request)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedError != nil {
				assertErrorResponse(t, w, tt.expectedError.Code, tt.expectedError.Message)
			} else if tt.validateBody != nil {
				var resp api.CreateApprovalResponse
				assertJSONResponse(t, w, tt.expectedStatus, &resp)
				tt.validateBody(t, &resp)
			}
		})
	}
}

func TestApprovalHandlers_ListApprovals(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockApprovalManager := approval.NewMockManager(ctrl)
	mockSessionManager := session.NewMockSessionManager(ctrl)

	handlers := handlers.NewApprovalHandlers(mockApprovalManager, mockSessionManager)
	router := setupTestRouter(t, nil, handlers, nil)

	approvals := []store.Approval{
		{
			ID:        "appr-1",
			RunID:     "run-1",
			SessionID: "sess-1",
			Status:    "pending",
			CreatedAt: time.Now().Add(-10 * time.Minute),
			ToolName:  "bash",
			ToolInput: json.RawMessage(`{"command": "rm -rf /tmp/test"}`),
		},
		{
			ID:          "appr-2",
			RunID:       "run-1",
			SessionID:   "sess-1",
			Status:      "approved",
			CreatedAt:   time.Now().Add(-5 * time.Minute),
			RespondedAt: timePtr(time.Now().Add(-3 * time.Minute)),
			ToolName:    "write_file",
			ToolInput:   json.RawMessage(`{"path": "/tmp/test.txt", "content": "Hello"}`),
			Comment:     "Safe operation",
		},
		{
			ID:          "appr-3",
			RunID:       "run-2",
			SessionID:   "sess-1",
			Status:      "denied",
			CreatedAt:   time.Now().Add(-15 * time.Minute),
			RespondedAt: timePtr(time.Now().Add(-10 * time.Minute)),
			ToolName:    "bash",
			ToolInput:   json.RawMessage(`{"command": "rm -rf /"}`),
			Comment:     "Dangerous command",
		},
	}

	t.Run("list approvals by session ID", func(t *testing.T) {
		// Convert to []*store.Approval
		approvalPtrs := make([]*store.Approval, len(approvals))
		for i := range approvals {
			approvalPtrs[i] = &approvals[i]
		}

		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), "sess-1").
			Return(approvalPtrs, nil)

		w := makeRequest(t, router, "GET", "/api/v1/approvals?sessionId=sess-1", nil)

		var resp struct {
			Data []api.Approval `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Len(t, resp.Data, 3)
		assert.Equal(t, "appr-1", resp.Data[0].Id)
		assert.Equal(t, api.ApprovalStatusPending, resp.Data[0].Status)

		assert.Equal(t, "appr-2", resp.Data[1].Id)
		assert.Equal(t, api.ApprovalStatusApproved, resp.Data[1].Status)
		assert.NotNil(t, resp.Data[1].Comment)
		assert.Equal(t, "Safe operation", *resp.Data[1].Comment)
		assert.NotNil(t, resp.Data[1].RespondedAt)

		assert.Equal(t, "appr-3", resp.Data[2].Id)
		assert.Equal(t, api.ApprovalStatusDenied, resp.Data[2].Status)
		assert.NotNil(t, resp.Data[2].Comment)
		assert.Equal(t, "Dangerous command", *resp.Data[2].Comment)
	})

	t.Run("list approvals without session ID returns empty", func(t *testing.T) {
		w := makeRequest(t, router, "GET", "/api/v1/approvals", nil)

		var resp struct {
			Data []api.Approval `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Empty(t, resp.Data)
	})

	t.Run("error fetching approvals", func(t *testing.T) {
		mockApprovalManager.EXPECT().
			GetPendingApprovals(gomock.Any(), "sess-error").
			Return(nil, fmt.Errorf("database error"))

		w := makeRequest(t, router, "GET", "/api/v1/approvals?sessionId=sess-error", nil)

		assertErrorResponse(t, w, "HLD-4001", "database error")
		assert.Equal(t, 500, w.Code)
	})
}

func TestApprovalHandlers_GetApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockApprovalManager := approval.NewMockManager(ctrl)
	mockSessionManager := session.NewMockSessionManager(ctrl)

	handlers := handlers.NewApprovalHandlers(mockApprovalManager, mockSessionManager)
	router := setupTestRouter(t, nil, handlers, nil)

	t.Run("get existing approval", func(t *testing.T) {
		approval := store.Approval{
			ID:        "appr-123",
			RunID:     "run-456",
			SessionID: "sess-789",
			Status:    "pending",
			CreatedAt: time.Now().Add(-5 * time.Minute),
			ToolName:  "edit_file",
			ToolInput: json.RawMessage(`{"path": "/tmp/test.py", "old_content": "def foo():", "new_content": "def bar():"}`),
		}

		mockApprovalManager.EXPECT().
			GetApproval(gomock.Any(), "appr-123").
			Return(&approval, nil)

		w := makeRequest(t, router, "GET", "/api/v1/approvals/appr-123", nil)

		var resp struct {
			Data api.Approval `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, "appr-123", resp.Data.Id)
		assert.Equal(t, "run-456", resp.Data.RunId)
		assert.Equal(t, "sess-789", resp.Data.SessionId)
		assert.Equal(t, api.ApprovalStatusPending, resp.Data.Status)
		assert.Equal(t, "edit_file", resp.Data.ToolName)
		// Tool input is converted to map[string]interface{} in API response
		expectedToolInput := map[string]interface{}{
			"path":        "/tmp/test.py",
			"old_content": "def foo():",
			"new_content": "def bar():",
		}
		assert.Equal(t, expectedToolInput, resp.Data.ToolInput)
		assert.Nil(t, resp.Data.RespondedAt)
		assert.Nil(t, resp.Data.Comment)
	})

	t.Run("get approved approval with comment", func(t *testing.T) {
		respondedAt := time.Now().Add(-1 * time.Minute)
		approval := store.Approval{
			ID:          "appr-456",
			RunID:       "run-789",
			SessionID:   "sess-012",
			Status:      "approved",
			CreatedAt:   time.Now().Add(-10 * time.Minute),
			RespondedAt: &respondedAt,
			ToolName:    "bash",
			ToolInput:   json.RawMessage(`{"command": "npm install"}`),
			Comment:     "Installing dependencies is safe",
		}

		mockApprovalManager.EXPECT().
			GetApproval(gomock.Any(), "appr-456").
			Return(&approval, nil)

		w := makeRequest(t, router, "GET", "/api/v1/approvals/appr-456", nil)

		var resp struct {
			Data api.Approval `json:"data"`
		}
		assertJSONResponse(t, w, 200, &resp)

		assert.Equal(t, api.ApprovalStatusApproved, resp.Data.Status)
		assert.NotNil(t, resp.Data.RespondedAt)
		assert.NotNil(t, resp.Data.Comment)
		assert.Equal(t, "Installing dependencies is safe", *resp.Data.Comment)
	})

	t.Run("approval not found", func(t *testing.T) {
		mockApprovalManager.EXPECT().
			GetApproval(gomock.Any(), "appr-999").
			Return(nil, &store.NotFoundError{Type: "approval", ID: "appr-999"})

		w := makeRequest(t, router, "GET", "/api/v1/approvals/appr-999", nil)

		assertErrorResponse(t, w, "HLD-1002", "Approval not found")
		assert.Equal(t, 404, w.Code)
	})
}

func TestApprovalHandlers_DecideApproval(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockApprovalManager := approval.NewMockManager(ctrl)
	mockSessionManager := session.NewMockSessionManager(ctrl)

	handlers := handlers.NewApprovalHandlers(mockApprovalManager, mockSessionManager)
	router := setupTestRouter(t, nil, handlers, nil)

	tests := []struct {
		name           string
		approvalID     string
		request        api.DecideApprovalRequest
		mockSetup      func()
		expectedStatus int
		expectedError  *api.ErrorDetail
	}{
		{
			name:       "approve decision",
			approvalID: "appr-123",
			request: api.DecideApprovalRequest{
				Decision: api.Approve,
				Comment:  stringPtr("Looks good!"),
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					ApproveToolCall(gomock.Any(), "appr-123", "Looks good!").
					Return(nil)
			},
			expectedStatus: 200,
		},
		{
			name:       "approve without comment",
			approvalID: "appr-124",
			request: api.DecideApprovalRequest{
				Decision: api.Approve,
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					ApproveToolCall(gomock.Any(), "appr-124", "").
					Return(nil)
			},
			expectedStatus: 200,
		},
		{
			name:       "deny decision with required comment",
			approvalID: "appr-456",
			request: api.DecideApprovalRequest{
				Decision: api.Deny,
				Comment:  stringPtr("This could delete important files"),
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					DenyToolCall(gomock.Any(), "appr-456", "This could delete important files").
					Return(nil)
			},
			expectedStatus: 200,
		},
		{
			name:       "deny without comment fails validation",
			approvalID: "appr-789",
			request: api.DecideApprovalRequest{
				Decision: api.Deny,
			},
			expectedStatus: 400,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-3001",
				Message: "comment is required when denying",
			},
		},
		{
			name:       "deny with empty comment fails validation",
			approvalID: "appr-790",
			request: api.DecideApprovalRequest{
				Decision: api.Deny,
				Comment:  stringPtr(""),
			},
			expectedStatus: 400,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-3001",
				Message: "comment is required when denying",
			},
		},
		{
			name:       "approval not found",
			approvalID: "appr-999",
			request: api.DecideApprovalRequest{
				Decision: api.Approve,
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					ApproveToolCall(gomock.Any(), "appr-999", "").
					Return(&store.NotFoundError{Type: "approval", ID: "appr-999"})
			},
			expectedStatus: 404,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-1002",
				Message: "Approval not found",
			},
		},
		{
			name:       "approval already decided",
			approvalID: "appr-111",
			request: api.DecideApprovalRequest{
				Decision: api.Approve,
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					ApproveToolCall(gomock.Any(), "appr-111", "").
					Return(&store.AlreadyDecidedError{ID: "appr-111", Status: "approved"})
			},
			expectedStatus: 400,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-3002",
				Message: "approval appr-111 already decided with status: approved",
			},
		},
		{
			name:       "generic error",
			approvalID: "appr-222",
			request: api.DecideApprovalRequest{
				Decision: api.Approve,
			},
			mockSetup: func() {
				mockApprovalManager.EXPECT().
					ApproveToolCall(gomock.Any(), "appr-222", "").
					Return(fmt.Errorf("database connection lost"))
			},
			expectedStatus: 500,
			expectedError: &api.ErrorDetail{
				Code:    "HLD-4001",
				Message: "database connection lost",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.mockSetup != nil {
				tt.mockSetup()
			}

			w := makeRequest(t, router, "POST", "/api/v1/approvals/"+tt.approvalID+"/decide", tt.request)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedError != nil {
				assertErrorResponse(t, w, tt.expectedError.Code, tt.expectedError.Message)
			} else {
				var resp api.DecideApprovalResponse
				assertJSONResponse(t, w, tt.expectedStatus, &resp)
				assert.True(t, resp.Data.Success)
			}
		})
	}
}

func TestApprovalHandlers_HTTPSpecificBehavior(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockApprovalManager := approval.NewMockManager(ctrl)
	mockSessionManager := session.NewMockSessionManager(ctrl)

	handlers := handlers.NewApprovalHandlers(mockApprovalManager, mockSessionManager)
	router := setupTestRouter(t, nil, handlers, nil)

	t.Run("malformed JSON in create approval", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/v1/approvals", bytes.NewReader([]byte(`{bad json`)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		assert.Equal(t, 400, w.Code)
	})

	t.Run("invalid approval ID format", func(t *testing.T) {
		// Test with special characters in ID
		// Note: The router normalizes the path, so this becomes a valid ID that doesn't exist
		w := makeRequest(t, router, "GET", "/api/v1/approvals/../../../etc/passwd", nil)
		assert.Equal(t, 404, w.Code) // Returns 404 for non-existent approval
	})

	t.Run("method not allowed", func(t *testing.T) {
		// Try DELETE on an endpoint that doesn't support it
		// Note: Gin returns 404 for unregistered routes
		w := makeRequest(t, router, "DELETE", "/api/v1/approvals/appr-123", nil)
		assert.Equal(t, 404, w.Code) // Gin returns 404 for unregistered routes
	})
}

// Helper function
func timePtr(t time.Time) *time.Time {
	return &t
}
