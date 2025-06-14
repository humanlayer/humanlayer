//go:build integration
// +build integration

package api_test

import (
	"encoding/json"
	"net"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/testutil"
)

// mockRPCServer implements a mock JSON-RPC server for testing
type mockRPCServer struct {
	listener   net.Listener
	socketPath string
	responses  map[string]interface{}
	t          *testing.T
}

func newMockRPCServer(t *testing.T) *mockRPCServer {
	socketPath := testutil.SocketPath(t, "api-integration")

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to create listener: %v", err)
	}

	server := &mockRPCServer{
		listener:   listener,
		socketPath: socketPath,
		responses:  make(map[string]interface{}),
		t:          t,
	}

	// Start server in background
	go server.serve()

	// Register cleanup
	t.Cleanup(func() {
		listener.Close()
	})

	return server
}

func (s *mockRPCServer) serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			// Server shutting down
			return
		}
		go s.handleConnection(conn)
	}
}

func (s *mockRPCServer) handleConnection(conn net.Conn) {
	defer conn.Close()

	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	for {
		var req rpc.Request
		if err := decoder.Decode(&req); err != nil {
			return
		}

		// Look up response
		resp := rpc.Response{
			ID:      req.ID,
			JSONRPC: "2.0",
		}

		if response, ok := s.responses[req.Method]; ok {
			respBytes, _ := json.Marshal(response)
			resp.Result = json.RawMessage(respBytes)
		} else {
			resp.Error = &rpc.Error{
				Code:    -32601,
				Message: "Method not found",
			}
		}

		if err := encoder.Encode(resp); err != nil {
			return
		}
	}
}

func (s *mockRPCServer) setResponse(method string, response interface{}) {
	s.responses[method] = response
}

func TestAPIClient_FetchRequests_Integration(t *testing.T) {
	// Start mock RPC server
	server := newMockRPCServer(t)

	// Set up mock responses
	server.setResponse("fetchApprovals", []interface{}{})
	server.setResponse("listSessions", map[string]interface{}{
		"sessions": []interface{}{},
	})

	// Wait for server to start
	deadline := time.Now().Add(5 * time.Second)
	var daemonClient client.Client
	var err error
	for time.Now().Before(deadline) {
		daemonClient, err = client.New(server.socketPath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("failed to connect to mock server: %v", err)
	}
	defer daemonClient.Close()

	// Create API client
	apiClient := api.NewClient(daemonClient)

	// Test FetchRequests
	cmd := apiClient.FetchRequests()
	msg := cmd()

	result, ok := msg.(domain.FetchRequestsMsg)
	if !ok {
		t.Fatalf("expected domain.FetchRequestsMsg, got %T", msg)
	}

	if result.Err != nil {
		t.Errorf("unexpected error: %v", result.Err)
	}

	if len(result.Requests) != 0 {
		t.Errorf("expected 0 requests, got %d", len(result.Requests))
	}
}

func TestAPIClient_ConnectionFailure_Integration(t *testing.T) {
	// Try to connect to non-existent daemon
	socketPath := testutil.SocketPath(t, "nonexistent")

	daemonClient, err := client.New(socketPath)
	if err == nil {
		daemonClient.Close()
		t.Fatal("expected connection error, got nil")
	}

	// Verify error message
	if err.Error() != "failed to connect to daemon" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestAPIClient_ConcurrentRequests_Integration(t *testing.T) {
	// Start mock RPC server
	server := newMockRPCServer(t)

	// Set up mock responses
	server.setResponse("fetchApprovals", []interface{}{})
	server.setResponse("listSessions", map[string]interface{}{
		"sessions": []interface{}{},
	})

	// Connect to server
	daemonClient, err := client.New(server.socketPath)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer daemonClient.Close()

	// Create API client
	apiClient := api.NewClient(daemonClient)

	// Run multiple concurrent requests
	done := make(chan bool, 3)

	go func() {
		cmd := apiClient.FetchRequests()
		cmd()
		done <- true
	}()

	go func() {
		cmd := apiClient.FetchSessions()
		cmd()
		done <- true
	}()

	go func() {
		cmd := apiClient.FetchSessionApprovals("test-session")
		cmd()
		done <- true
	}()

	// Wait for all requests to complete
	for i := 0; i < 3; i++ {
		select {
		case <-done:
			// Success
		case <-time.After(5 * time.Second):
			t.Fatal("concurrent request timed out")
		}
	}
}
