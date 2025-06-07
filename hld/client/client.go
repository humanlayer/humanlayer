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
	// Track subscription connections to close them when client closes
	subConns []net.Conn
	subMu    sync.Mutex
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

// Subscribe subscribes to events from the daemon
func (c *client) Subscribe(req rpc.SubscribeRequest) (<-chan rpc.EventNotification, error) {
	// Create a separate connection for subscription
	conn, err := net.Dial("unix", c.socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create subscription connection: %w", err)
	}

	// Track this subscription connection
	c.subMu.Lock()
	c.subConns = append(c.subConns, conn)
	c.subMu.Unlock()

	// Send subscribe request
	encoder := json.NewEncoder(conn)
	jsonReq := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  "Subscribe",
		Params:  req,
		ID:      atomic.AddInt64(&c.id, 1),
	}
	if err := encoder.Encode(jsonReq); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to send subscribe request: %w", err)
	}

	// Create channel for events
	eventChan := make(chan rpc.EventNotification, 100)

	// Create a channel to signal when subscription is confirmed
	ready := make(chan struct{})

	// Start goroutine to read events
	go func() {
		defer close(eventChan)
		defer func() { _ = conn.Close() }()
		defer func() {
			// Remove this connection from tracked subscriptions
			c.subMu.Lock()
			for i, subConn := range c.subConns {
				if subConn == conn {
					c.subConns = append(c.subConns[:i], c.subConns[i+1:]...)
					break
				}
			}
			c.subMu.Unlock()
		}()

		decoder := json.NewDecoder(conn)
		subscriptionConfirmed := false

		for {
			var resp jsonRPCResponse
			if err := decoder.Decode(&resp); err != nil {
				// Connection closed or error
				return
			}

			// Skip non-result messages
			if resp.Error != nil || len(resp.Result) == 0 {
				continue
			}

			// First check if it's a subscription response
			if !subscriptionConfirmed {
				var subResp rpc.SubscribeResponse
				if err := json.Unmarshal(resp.Result, &subResp); err == nil && subResp.SubscriptionID != "" {
					// This is the initial subscription confirmation
					subscriptionConfirmed = true
					close(ready)
					continue
				}
			}

			// Check if it's a heartbeat
			var heartbeat map[string]interface{}
			if err := json.Unmarshal(resp.Result, &heartbeat); err == nil {
				if hbType, ok := heartbeat["type"].(string); ok && hbType == "heartbeat" {
					// Skip heartbeats
					continue
				}
			}

			// Try to decode as event notification
			var notification rpc.EventNotification
			if err := json.Unmarshal(resp.Result, &notification); err == nil && notification.Event.Type != "" {
				select {
				case eventChan <- notification:
				default:
					// Channel full, drop event
				}
			}
		}
	}()

	// Wait for subscription confirmation with timeout
	select {
	case <-ready:
		// Subscription confirmed
		return eventChan, nil
	case <-time.After(5 * time.Second):
		_ = conn.Close()
		return nil, fmt.Errorf("timeout waiting for subscription confirmation")
	}
}

// Close closes the connection to the daemon
func (c *client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Close all subscription connections
	c.subMu.Lock()
	for _, conn := range c.subConns {
		_ = conn.Close()
	}
	c.subConns = nil
	c.subMu.Unlock()

	// Close main connection
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
	ID      interface{}     `json:"id,omitempty"` // Can be number, string, or null for notifications
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
		_ = c.conn.Close()
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
			_ = client.Close()
		}

		lastErr = err
		if i < maxRetries {
			time.Sleep(retryDelay)
		}
	}

	return nil, fmt.Errorf("failed to connect to daemon after %d attempts: %w", maxRetries+1, lastErr)
}
