package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TODO(1): Remove nolint directive once handler tests are implemented
// setupTestRouter creates a test Gin router with the given handlers
//
//nolint:unused // Will be used in handler tests
func setupTestRouter(t *testing.T, sessionHandlers *handlers.SessionHandlers, approvalHandlers *handlers.ApprovalHandlers, sseHandler *handlers.SSEHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)

	router := gin.New()

	// Create server implementation
	serverImpl := handlers.NewServerImpl(sessionHandlers, approvalHandlers, sseHandler)

	// Create strict handler
	strictHandler := api.NewStrictHandler(serverImpl, nil)

	// Register handlers using generated code
	api.RegisterHandlers(router, strictHandler)

	// Register SSE endpoint
	if sseHandler != nil {
		router.GET("/api/v1/events", sseHandler.StreamEvents)
	}

	return router
}

// TODO(1): Remove nolint directive once handler tests are implemented
// makeRequest is a helper to make HTTP requests in tests
//
//nolint:unused // Will be used in handler tests
func makeRequest(t *testing.T, router *gin.Engine, method, path string, body interface{}) *httptest.ResponseRecorder {
	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		require.NoError(t, err)
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(reqBody))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	return w
}

// TODO(1): Remove nolint directive once handler tests are implemented
// assertErrorResponse validates error response format
//
//nolint:unused // Will be used in handler tests
func assertErrorResponse(t *testing.T, w *httptest.ResponseRecorder, expectedCode string, expectedMessageContains string) {
	var errResp struct {
		Error api.ErrorDetail `json:"error"`
	}

	err := json.Unmarshal(w.Body.Bytes(), &errResp)
	require.NoError(t, err, "Failed to unmarshal error response")

	assert.Equal(t, expectedCode, errResp.Error.Code)
	assert.Contains(t, errResp.Error.Message, expectedMessageContains)
}

// TODO(1): Remove nolint directive once handler tests are implemented
// assertJSONResponse validates successful JSON response
//
//nolint:unused // Will be used in handler tests
func assertJSONResponse(t *testing.T, w *httptest.ResponseRecorder, statusCode int, v interface{}) {
	assert.Equal(t, statusCode, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

	if v != nil {
		err := json.Unmarshal(w.Body.Bytes(), v)
		require.NoError(t, err, "Failed to unmarshal response")
	}
}
