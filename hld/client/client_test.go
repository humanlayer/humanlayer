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

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
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
	os.Remove(socketPath)

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
	defer conn.Close()
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
	s.listener.Close()
}

func TestClient_Health(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()
	server.start()

	// Give server time to start
	time.Sleep(10 * time.Millisecond)

	c, err := New(socketPath)
	require.NoError(t, err)
	defer c.Close()

	err = c.Health()
	assert.NoError(t, err)
}

func TestClient_FetchApprovals(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()

	// Create test approvals that match what the TUI expects
	testApprovals := []approval.PendingApproval{
		{
			Type: "function_call",
			FunctionCall: &humanlayer.FunctionCall{
				CallID: "fc-123",
				Spec: humanlayer.FunctionCallSpec{
					Fn: "test_function",
					Kwargs: map[string]interface{}{
							"arg": "value",
						},
				},
				RunID: "run-123",
			},
		},
		{
			Type: "human_contact",
			HumanContact: &humanlayer.HumanContact{
				CallID: "hc-456",
				Spec: humanlayer.HumanContactSpec{
					Msg: "Need help with something",
				},
				RunID: "run-456",
			},
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
	defer c.Close()

	approvals, err := c.FetchApprovals("")
	assert.NoError(t, err)
	assert.Len(t, approvals, 2)

	// Verify function call
	assert.Equal(t, "function_call", approvals[0].Type)
	assert.NotNil(t, approvals[0].FunctionCall)
	assert.Equal(t, "fc-123", approvals[0].FunctionCall.CallID)

	// Verify human contact
	assert.Equal(t, "human_contact", approvals[1].Type)
	assert.NotNil(t, approvals[1].HumanContact)
	assert.Equal(t, "hc-456", approvals[1].HumanContact.CallID)
}

func TestClient_SendDecision(t *testing.T) {
	server, socketPath := newMockRPCServer(t)
	defer server.stop()

	server.setHandler("sendDecision", func(params json.RawMessage) (interface{}, error) {
		var req rpc.SendDecisionRequest
		json.Unmarshal(params, &req)

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
	defer c.Close()

	// Test approve
	err = c.SendDecision("test-123", "function_call", "approve", "looks good")
	assert.NoError(t, err)

	// Test deny
	err = c.SendDecision("test-456", "function_call", "deny", "too risky")
	assert.NoError(t, err)

	// Test respond
	err = c.SendDecision("test-789", "human_contact", "respond", "here is my response")
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
