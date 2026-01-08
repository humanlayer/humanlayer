package handlers_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestTerminalHandler_HandleWebSocket_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		path           string
		prepareStore   func(t *testing.T, mockStore *store.MockConversationStore)
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "missing session id",
			path:           "/terminal",
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "sessionId is required",
		},
		{
			name: "session not found",
			path: "/terminal?sessionId=missing",
			prepareStore: func(t *testing.T, mockStore *store.MockConversationStore) {
				mockStore.EXPECT().
					GetSession(gomock.Any(), "missing").
					Return(nil, fmt.Errorf("not found"))
			},
			expectedStatus: http.StatusNotFound,
			expectedBody:   "session not found",
		},
		{
			name: "session with no working directory",
			path: "/terminal?sessionId=sess-no-dir",
			prepareStore: func(t *testing.T, mockStore *store.MockConversationStore) {
				mockStore.EXPECT().
					GetSession(gomock.Any(), "sess-no-dir").
					Return(&store.Session{ID: "sess-no-dir", WorkingDir: ""}, nil)
			},
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "working directory",
		},
		{
			name: "working directory does not exist",
			path: "/terminal?sessionId=sess-bad-dir",
			prepareStore: func(t *testing.T, mockStore *store.MockConversationStore) {
				missingDir := filepath.Join(t.TempDir(), "does-not-exist")
				mockStore.EXPECT().
					GetSession(gomock.Any(), "sess-bad-dir").
					Return(&store.Session{ID: "sess-bad-dir", WorkingDir: missingDir}, nil)
			},
			expectedStatus: http.StatusBadRequest,
			expectedBody:   "working directory does not exist",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var (
				ctrl      *gomock.Controller
				convStore store.ConversationStore
			)

			if tt.prepareStore != nil {
				ctrl = gomock.NewController(t)
				defer ctrl.Finish()

				mockStore := store.NewMockConversationStore(ctrl)
				tt.prepareStore(t, mockStore)
				convStore = mockStore
			}

			handler := handlers.NewTerminalHandler(nil, convStore)
			router := gin.New()
			router.GET("/terminal", handler.HandleWebSocket)

			req := httptest.NewRequest("GET", tt.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)
			assert.Contains(t, w.Body.String(), tt.expectedBody)
		})
	}
}
