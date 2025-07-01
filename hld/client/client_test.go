package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRPCServer simulates the daemon's RPC server for testing
type mockRPCServer struct {
	socketPath string
	listener   net.Listener
	handlers   map[string]func(params json.RawMessage) (interface{}, error)
	shutdown   chan struct{}
}

func newMockRPCServer(t *testing.T) (*mockRPCServer, string) {
	socketPath := testutil.CreateTestSocket(t)

	// Remove existing socket if any
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	require.NoError(t, err)

	server := &mockRPCServer{
		socketPath: socketPath,
		listener:   listener,
		handlers:   make(map[string]func(params json.RawMessage) (interface{}, error)),
		shutdown:   make(chan struct{}),
	}

	// Default health handler
	server.handlers["health"] = func(params json.RawMessage) (interface{}, error) {
		return rpc.HealthCheckResponse{
			Status:  "ok",
			Version: "test",
		}, nil
	}

	return server, socketPath
}

func (s *mockRPCServer) setHandler(method string, handler func(params json.RawMessage) (interface{}, error)) {
	s.handlers[method] = handler
}

func (s *mockRPCServer) start() {
	go func() {
		for {
			select {
			case <-s.shutdown:
				return
			default:
				conn, err := s.listener.Accept()
				if err != nil {
					return
				}
				go s.handleConnection(conn)
			}
		}
	}()
}

func (s *mockRPCServer) handleConnection(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	for {
		var req jsonRPCRequest
		if err := decoder.Decode(&req); err != nil {
			if err != io.EOF {
				fmt.Printf("decode error: %v\n", err)
			}
			return
		}

		handler, ok := s.handlers[req.Method]

		var resp jsonRPCResponse
		resp.JSONRPC = "2.0"
		resp.ID = req.ID

		if !ok {
			resp.Error = &rpc.Error{
				Code:    rpc.MethodNotFound,
				Message: fmt.Sprintf("method %s not found", req.Method),
			}
		} else {
			paramsBytes, _ := json.Marshal(req.Params)
			result, err := handler(paramsBytes)
			if err != nil {
				resp.Error = &rpc.Error{
					Code:    rpc.InternalError,
					Message: err.Error(),
				}
			} else {
				resp.Result, _ = json.Marshal(result)
			}
		}

		if err := encoder.Encode(resp); err != nil {
			return
		}
	}
}

func (s *mockRPCServer) stop() {
	close(s.shutdown)
	_ = s.listener.Close()
}

func TestClient_Health(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()
	server.start()

	// Give server time to start
	time.Sleep(10 * time.Millisecond)

	c, err := New(socketPath)
	require.NoError(t, err)
	defer func() { _ = c.Close() }()

	err = c.Health()
	assert.NoError(t, err)
}

func TestClient_FetchApprovals(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()

	// Create test approvals with new local format
	testApprovals := []*store.Approval{
		{
			ID:        "local-123",
			RunID:     "run-123",
			SessionID: "session-123",
			Status:    store.ApprovalStatusLocalPending,
			CreatedAt: time.Now(),
			ToolName:  "test_function",
			ToolInput: json.RawMessage(`{"arg": "value"}`),
		},
		{
			ID:        "local-456",
			RunID:     "run-456",
			SessionID: "session-456",
			Status:    store.ApprovalStatusLocalPending,
			CreatedAt: time.Now(),
			ToolName:  "another_function",
			ToolInput: json.RawMessage(`{"msg": "test message"}`),
		},
	}

	server.setHandler("fetchApprovals", func(params json.RawMessage) (interface{}, error) {
		return rpc.FetchApprovalsResponse{
			Approvals: testApprovals,
		}, nil
	})

	server.start()
	time.Sleep(10 * time.Millisecond)

	c, err := New(socketPath)
	require.NoError(t, err)
	defer func() { _ = c.Close() }()

	approvals, err := c.FetchApprovals("")
	assert.NoError(t, err)
	assert.Len(t, approvals, 2)

	// Verify first approval
	assert.Equal(t, "local-123", approvals[0].ID)
	assert.Equal(t, "test_function", approvals[0].ToolName)
	assert.Equal(t, store.ApprovalStatusLocalPending, approvals[0].Status)

	// Verify second approval
	assert.Equal(t, "local-456", approvals[1].ID)
	assert.Equal(t, "another_function", approvals[1].ToolName)
	assert.Equal(t, store.ApprovalStatusLocalPending, approvals[1].Status)
}

func TestClient_SendDecision(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()

	server.setHandler("sendDecision", func(params json.RawMessage) (interface{}, error) {
		var req rpc.SendDecisionRequest
		_ = json.Unmarshal(params, &req)

		// Simple validation
		if req.CallID == "" {
			return rpc.SendDecisionResponse{
				Success: false,
				Error:   "call_id required",
			}, nil
		}

		return rpc.SendDecisionResponse{
			Success: true,
		}, nil
	})

	server.start()
	time.Sleep(10 * time.Millisecond)

	c, err := New(socketPath)
	require.NoError(t, err)
	defer func() { _ = c.Close() }()

	// Test approve
	err = c.SendDecision("test-123", "approve", "looks good")
	assert.NoError(t, err)

	// Test deny
	err = c.SendDecision("test-456", "deny", "too risky")
	assert.NoError(t, err)

	// Test the convenience methods
	err = c.ApproveToolCall("test-789", "approved")
	assert.NoError(t, err)

	err = c.DenyToolCall("test-890", "not allowed")
	assert.NoError(t, err)
}

func TestConnect_WithRetries(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "test.sock")

	// Try to connect when no server is running
	client, err := Connect(socketPath, 2, 10*time.Millisecond)
	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "failed to connect to daemon after 3 attempts")
}

func TestClient_InterruptSession(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()

	server.setHandler("interruptSession", func(params json.RawMessage) (interface{}, error) {
		var req struct {
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, err
		}

		// Simple validation
		if req.SessionID == "" {
			return nil, fmt.Errorf("session_id required")
		}

		return struct{}{}, nil
	})

	server.start()
	time.Sleep(10 * time.Millisecond)

	c, err := New(socketPath)
	require.NoError(t, err)
	defer func() { _ = c.Close() }()

	// Test successful interrupt
	err = c.InterruptSession("test-123")
	assert.NoError(t, err)

	// Test missing session ID
	err = c.InterruptSession("")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session_id required")
}
