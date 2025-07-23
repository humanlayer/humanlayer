package hldsdk

import (
    "context"
    "github.com/humanlayer/humanlayer/hld/api"
    "github.com/humanlayer/humanlayer/hld/bus"
    "github.com/humanlayer/humanlayer/hld/client"
)

// Client wraps the generated REST client for public SDK use
type Client struct {
    restClient *client.RESTClient
    sseClient  *client.SSEClient
    baseURL    string
}

// NewClient creates a new HLD SDK client
func NewClient(baseURL string) *Client {
    return &Client{
        restClient: client.NewRESTClient(baseURL),
        sseClient:  client.NewSSEClient(baseURL),
        baseURL:    baseURL,
    }
}

// CreateSession creates a new session
func (c *Client) CreateSession(ctx context.Context, req api.CreateSessionRequest) (*api.Session, error) {
    resp, err := c.restClient.CreateSession(ctx, req)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// ListSessions retrieves all sessions
func (c *Client) ListSessions(ctx context.Context, leafOnly bool, includeArchived bool) ([]api.Session, error) {
    resp, err := c.restClient.ListSessions(ctx, leafOnly, includeArchived)
    if err != nil {
        return nil, err
    }
    return resp.Data, nil
}

// GetSession retrieves a specific session by ID
func (c *Client) GetSession(ctx context.Context, sessionID string) (*api.Session, error) {
    resp, err := c.restClient.GetSession(ctx, sessionID)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// UpdateSession updates session settings
func (c *Client) UpdateSession(ctx context.Context, sessionID string, autoAcceptEdits *bool, archived *bool) (*api.Session, error) {
    req := api.UpdateSessionRequest{}
    if autoAcceptEdits != nil {
        req.AutoAcceptEdits = autoAcceptEdits
    }
    if archived != nil {
        req.Archived = archived
    }
    resp, err := c.restClient.UpdateSession(ctx, sessionID, req)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// ContinueSession creates a new session continuing from an existing one
func (c *Client) ContinueSession(ctx context.Context, sessionID string, req api.ContinueSessionRequest) (*api.ContinueSessionResponse_Data, error) {
    resp, err := c.restClient.ContinueSession(ctx, sessionID, req)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// InterruptSession interrupts a running session
func (c *Client) InterruptSession(ctx context.Context, sessionID string) (*api.InterruptSessionResponse_Data, error) {
    resp, err := c.restClient.InterruptSession(ctx, sessionID)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// GetSessionMessages retrieves conversation history for a session
func (c *Client) GetSessionMessages(ctx context.Context, sessionID string) ([]api.ConversationEvent, error) {
    resp, err := c.restClient.GetSessionMessages(ctx, sessionID)
    if err != nil {
        return nil, err
    }
    return resp.Data, nil
}

// GetSessionSnapshots retrieves file snapshots for a session
func (c *Client) GetSessionSnapshots(ctx context.Context, sessionID string) ([]api.FileSnapshot, error) {
    resp, err := c.restClient.GetSessionSnapshots(ctx, sessionID)
    if err != nil {
        return nil, err
    }
    return resp.Data, nil
}

// BulkArchiveSessions archives or unarchives multiple sessions
func (c *Client) BulkArchiveSessions(ctx context.Context, sessionIDs []string, archived bool) (*api.BulkArchiveResponse_Data, error) {
    req := api.BulkArchiveRequest{
        SessionIds: sessionIDs,
        Archived:   archived,
    }
    resp, err := c.restClient.BulkArchiveSessions(ctx, req)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// GetRecentPaths retrieves recently used working directories
func (c *Client) GetRecentPaths(ctx context.Context, limit *int) ([]api.RecentPath, error) {
    resp, err := c.restClient.GetRecentPaths(ctx, limit)
    if err != nil {
        return nil, err
    }
    return resp.Data, nil
}

// CreateApproval creates a new approval request
func (c *Client) CreateApproval(ctx context.Context, req api.CreateApprovalRequest) (string, error) {
    resp, err := c.restClient.CreateApproval(ctx, req)
    if err != nil {
        return "", err
    }
    return resp.Data.ApprovalId, nil
}

// ListApprovals retrieves approval requests
func (c *Client) ListApprovals(ctx context.Context, sessionID *string) ([]api.Approval, error) {
    resp, err := c.restClient.ListApprovals(ctx, sessionID)
    if err != nil {
        return nil, err
    }
    return resp.Data, nil
}

// GetApproval retrieves a specific approval by ID
func (c *Client) GetApproval(ctx context.Context, approvalID string) (*api.Approval, error) {
    resp, err := c.restClient.GetApproval(ctx, approvalID)
    if err != nil {
        return nil, err
    }
    return &resp.Data, nil
}

// DecideApproval approves or denies an approval request
func (c *Client) DecideApproval(ctx context.Context, approvalID string, decision string, comment *string) error {
    req := api.DecideApprovalRequest{
        Decision: api.DecideApprovalRequestDecision(decision),
        Comment:  comment,
    }
    _, err := c.restClient.DecideApproval(ctx, approvalID, req)
    return err
}

// SubscribeToEvents subscribes to SSE events
func (c *Client) SubscribeToEvents(ctx context.Context, filter client.EventFilter) (<-chan bus.Event, error) {
    return c.sseClient.SubscribeToEvents(ctx, filter)
}

// GetHealth returns the health status of the daemon
func (c *Client) GetHealth(ctx context.Context) (*api.HealthResponse, error) {
    return c.restClient.GetHealth(ctx)
}