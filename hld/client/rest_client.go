package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
)

// RESTClient provides access to the HLD REST API
type RESTClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewRESTClient creates a new REST API client
func NewRESTClient(baseURL string) *RESTClient {
	return &RESTClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// doRequest performs an HTTP request and decodes the response
func (c *RESTClient) doRequest(ctx context.Context, method, path string, body interface{}, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode >= 400 {
		var errorResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errorResp); err != nil {
			return fmt.Errorf("HTTP %d: failed to decode error response", resp.StatusCode)
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, errorResp.Error.Message)
	}

	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}
	}

	return nil
}

// CreateSession creates a new session
func (c *RESTClient) CreateSession(ctx context.Context, req api.CreateSessionRequest) (*api.CreateSession201JSONResponse, error) {
	var resp api.CreateSession201JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/sessions", req, &resp)
	return &resp, err
}

// ListSessions retrieves all sessions
func (c *RESTClient) ListSessions(ctx context.Context, leafOnly bool, includeArchived bool) (*api.ListSessions200JSONResponse, error) {
	path := fmt.Sprintf("/api/v1/sessions?leafOnly=%t&includeArchived=%t", leafOnly, includeArchived)
	var resp api.ListSessions200JSONResponse
	err := c.doRequest(ctx, "GET", path, nil, &resp)
	return &resp, err
}

// GetSession retrieves a specific session by ID
func (c *RESTClient) GetSession(ctx context.Context, sessionID string) (*api.GetSession200JSONResponse, error) {
	var resp api.GetSession200JSONResponse
	err := c.doRequest(ctx, "GET", "/api/v1/sessions/"+sessionID, nil, &resp)
	return &resp, err
}

// UpdateSession updates session settings
func (c *RESTClient) UpdateSession(ctx context.Context, sessionID string, req api.UpdateSessionRequest) (*api.UpdateSession200JSONResponse, error) {
	var resp api.UpdateSession200JSONResponse
	err := c.doRequest(ctx, "PATCH", "/api/v1/sessions/"+sessionID, req, &resp)
	return &resp, err
}

// ContinueSession creates a new session continuing from an existing one
func (c *RESTClient) ContinueSession(ctx context.Context, sessionID string, req api.ContinueSessionRequest) (*api.ContinueSession201JSONResponse, error) {
	var resp api.ContinueSession201JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/continue", req, &resp)
	return &resp, err
}

// InterruptSession interrupts a running session
func (c *RESTClient) InterruptSession(ctx context.Context, sessionID string) (*api.InterruptSession200JSONResponse, error) {
	var resp api.InterruptSession200JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/sessions/"+sessionID+"/interrupt", nil, &resp)
	return &resp, err
}

// GetSessionMessages retrieves conversation history for a session
func (c *RESTClient) GetSessionMessages(ctx context.Context, sessionID string) (*api.GetSessionMessages200JSONResponse, error) {
	var resp api.GetSessionMessages200JSONResponse
	err := c.doRequest(ctx, "GET", "/api/v1/sessions/"+sessionID+"/messages", nil, &resp)
	return &resp, err
}

// GetSessionSnapshots retrieves file snapshots for a session
func (c *RESTClient) GetSessionSnapshots(ctx context.Context, sessionID string) (*api.GetSessionSnapshots200JSONResponse, error) {
	var resp api.GetSessionSnapshots200JSONResponse
	err := c.doRequest(ctx, "GET", "/api/v1/sessions/"+sessionID+"/snapshots", nil, &resp)
	return &resp, err
}

// BulkArchiveSessions archives or unarchives multiple sessions
func (c *RESTClient) BulkArchiveSessions(ctx context.Context, req api.BulkArchiveRequest) (*api.BulkArchiveSessions200JSONResponse, error) {
	var resp api.BulkArchiveSessions200JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/sessions/bulk-archive", req, &resp)
	return &resp, err
}

// GetRecentPaths retrieves recently used working directories
func (c *RESTClient) GetRecentPaths(ctx context.Context, limit *int) (*api.GetRecentPaths200JSONResponse, error) {
	path := "/api/v1/sessions/recent-paths"
	if limit != nil {
		path = fmt.Sprintf("%s?limit=%d", path, *limit)
	}
	var resp api.GetRecentPaths200JSONResponse
	err := c.doRequest(ctx, "GET", path, nil, &resp)
	return &resp, err
}

// CreateApproval creates a new approval request
func (c *RESTClient) CreateApproval(ctx context.Context, req api.CreateApprovalRequest) (*api.CreateApproval201JSONResponse, error) {
	var resp api.CreateApproval201JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/approvals", req, &resp)
	return &resp, err
}

// ListApprovals retrieves approval requests
func (c *RESTClient) ListApprovals(ctx context.Context, sessionID *string) (*api.ListApprovals200JSONResponse, error) {
	path := "/api/v1/approvals"
	if sessionID != nil {
		path = fmt.Sprintf("%s?sessionId=%s", path, *sessionID)
	}
	var resp api.ListApprovals200JSONResponse
	err := c.doRequest(ctx, "GET", path, nil, &resp)
	return &resp, err
}

// GetApproval retrieves a specific approval by ID
func (c *RESTClient) GetApproval(ctx context.Context, approvalID string) (*api.GetApproval200JSONResponse, error) {
	var resp api.GetApproval200JSONResponse
	err := c.doRequest(ctx, "GET", "/api/v1/approvals/"+approvalID, nil, &resp)
	return &resp, err
}

// DecideApproval approves or denies an approval request
func (c *RESTClient) DecideApproval(ctx context.Context, approvalID string, req api.DecideApprovalRequest) (*api.DecideApproval200JSONResponse, error) {
	var resp api.DecideApproval200JSONResponse
	err := c.doRequest(ctx, "POST", "/api/v1/approvals/"+approvalID+"/decide", req, &resp)
	return &resp, err
}

// GetHealth returns the health status of the daemon
func (c *RESTClient) GetHealth(ctx context.Context) (*api.HealthResponse, error) {
	var resp api.HealthResponse
	err := c.doRequest(ctx, "GET", "/api/v1/health", nil, &resp)
	return &resp, err
}
