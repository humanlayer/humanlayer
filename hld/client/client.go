package client

import (
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// client provides a JSON-RPC 2.0 client for communicating with the HumanLayer daemon
type client struct {
	socketPath string
	conn       net.Conn
	mu         sync.Mutex
	id         int64
}

// New creates a new client that connects to the daemon's Unix socket
func New(socketPath string) (Client, error) {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to daemon at %s: %w", socketPath, err)
	}

	return &client{
		socketPath: socketPath,
		conn:       conn,
	}, nil
}

// Close closes the connection to the daemon
func (c *client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// jsonRPCRequest represents a JSON-RPC 2.0 request
type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
	ID      int64       `json:"id"`
}

// jsonRPCResponse represents a JSON-RPC 2.0 response
type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpc.Error      `json:"error,omitempty"`
	ID      int64           `json:"id"`
}

// call sends an RPC request and waits for the response
func (c *client) call(method string, params interface{}, result interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return fmt.Errorf("connection closed")
	}

	// Generate unique ID for this request
	id := atomic.AddInt64(&c.id, 1)

	// Create request
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	// Send request
	encoder := json.NewEncoder(c.conn)
	if err := encoder.Encode(req); err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}

	// Read response
	decoder := json.NewDecoder(c.conn)
	var resp jsonRPCResponse
	if err := decoder.Decode(&resp); err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	// Check for error
	if resp.Error != nil {
		return fmt.Errorf("RPC error %d: %s", resp.Error.Code, resp.Error.Message)
	}

	// Unmarshal result if provided
	if result != nil && len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, result); err != nil {
			return fmt.Errorf("failed to unmarshal result: %w", err)
		}
	}

	return nil
}

// Health checks if the daemon is healthy
func (c *client) Health() error {
	var resp rpc.HealthCheckResponse
	if err := c.call("health", nil, &resp); err != nil {
		return err
	}
	if resp.Status != "ok" {
		return fmt.Errorf("daemon unhealthy: %s", resp.Status)
	}
	return nil
}

// LaunchSession launches a new Claude Code session
func (c *client) LaunchSession(req rpc.LaunchSessionRequest) (*rpc.LaunchSessionResponse, error) {
	var resp rpc.LaunchSessionResponse
	if err := c.call("launchSession", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ListSessions lists all active sessions
func (c *client) ListSessions() (*rpc.ListSessionsResponse, error) {
	var resp rpc.ListSessionsResponse
	if err := c.call("listSessions", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// FetchApprovals fetches pending approvals from the daemon
func (c *client) FetchApprovals(sessionID string) ([]approval.PendingApproval, error) {
	req := rpc.FetchApprovalsRequest{
		SessionID: sessionID,
	}
	var resp rpc.FetchApprovalsResponse
	if err := c.call("fetchApprovals", req, &resp); err != nil {
		return nil, err
	}
	return resp.Approvals, nil
}

// SendDecision sends a decision (approve/deny/respond) for an approval
func (c *client) SendDecision(callID, approvalType, decision, comment string) error {
	req := rpc.SendDecisionRequest{
		CallID:   callID,
		Type:     approvalType,
		Decision: decision,
		Comment:  comment,
	}
	var resp rpc.SendDecisionResponse
	if err := c.call("sendDecision", req, &resp); err != nil {
		return err
	}
	if !resp.Success {
		return fmt.Errorf("decision failed: %s", resp.Error)
	}
	return nil
}

// Reconnect attempts to reconnect to the daemon
func (c *client) Reconnect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Close existing connection if any
	if c.conn != nil {
		c.conn.Close()
	}

	// Try to reconnect
	conn, err := net.Dial("unix", c.socketPath)
	if err != nil {
		return fmt.Errorf("failed to reconnect to daemon: %w", err)
	}

	c.conn = conn
	return nil
}

// Connect attempts to connect to the daemon with retries
func Connect(socketPath string, maxRetries int, retryDelay time.Duration) (Client, error) {
	var lastErr error

	for i := 0; i <= maxRetries; i++ {
		client, err := New(socketPath)
		if err == nil {
			// Test the connection
			if err := client.Health(); err == nil {
				return client, nil
			}
			client.Close()
		}

		lastErr = err
		if i < maxRetries {
			time.Sleep(retryDelay)
		}
	}

	return nil, fmt.Errorf("failed to connect to daemon after %d attempts: %w", maxRetries+1, lastErr)
}
