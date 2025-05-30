package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

func TestDaemonLifecycle(t *testing.T) {
	socketPath := testutil.SocketPath(t, "lifecycle")

	// Override the default socket path for testing
	d := &Daemon{
		socketPath: socketPath,
	}

	// Start daemon in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errChan := make(chan error, 1)
	go func() {
		errChan <- d.Run(ctx)
	}()

	// Wait for daemon to start
	time.Sleep(100 * time.Millisecond)

	// Test 1: Connect to daemon
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to connect to daemon: %v", err)
	}
	defer conn.Close()

	// Test 2: Send health check request
	request := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "health",
		"id":      1,
	}

	encoder := json.NewEncoder(conn)
	if err := encoder.Encode(request); err != nil {
		t.Fatalf("failed to send request: %v", err)
	}

	// Test 3: Read response
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response received")
	}

	var response map[string]interface{}
	if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// Test 4: Verify response
	if response["jsonrpc"] != "2.0" {
		t.Errorf("expected jsonrpc 2.0, got %v", response["jsonrpc"])
	}

	if response["id"] != float64(1) {
		t.Errorf("expected id 1, got %v", response["id"])
	}

	result, ok := response["result"].(map[string]interface{})
	if !ok {
		t.Fatalf("result not a map: %T", response["result"])
	}

	if result["status"] != "ok" {
		t.Errorf("expected status ok, got %v", result["status"])
	}

	if result["version"] != rpc.Version {
		t.Errorf("expected version %s, got %v", rpc.Version, result["version"])
	}

	// Test 5: Graceful shutdown
	cancel()

	select {
	case err := <-errChan:
		if err != nil {
			t.Errorf("daemon returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon did not shut down in time")
	}

	// Test 6: Socket should be cleaned up
	if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
		t.Error("socket file not cleaned up after shutdown")
	}
}

func TestDaemonRefusesDoubleStart(t *testing.T) {
	// Set up a temporary config directory
	socketPath := testutil.SocketPath(t, "double")

	// Override config loading for test
	t.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)

	// Start first daemon
	d1, err := New()
	if err != nil {
		t.Fatalf("failed to create first daemon: %v", err)
	}

	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()

	go d1.Run(ctx1)

	// Wait for first daemon to start
	time.Sleep(100 * time.Millisecond)

	// Try to create second daemon - should fail with ErrDaemonAlreadyRunning
	d2, err := New()
	if err == nil {
		t.Fatal("expected error when creating second daemon, but succeeded")
	}

	if !errors.Is(err, ErrDaemonAlreadyRunning) {
		t.Errorf("expected ErrDaemonAlreadyRunning, got: %v", err)
	}

	if d2 != nil {
		t.Error("daemon instance should be nil when creation fails")
	}
}

func TestDaemonConcurrentConnections(t *testing.T) {
	// Use a shorter test-specific socket path to avoid macOS path length limits
	socketPath := testutil.SocketPath(t, "concurrent")

	d := &Daemon{
		socketPath: socketPath,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go d.Run(ctx)

	// Wait longer for daemon to fully start
	time.Sleep(200 * time.Millisecond)

	// Connect multiple clients concurrently
	numClients := 5
	done := make(chan bool, numClients)

	for i := 0; i < numClients; i++ {
		go func(clientID int) {
			conn, err := net.Dial("unix", socketPath)
			if err != nil {
				t.Errorf("client %d: failed to connect: %v", clientID, err)
				done <- false
				return
			}
			defer conn.Close()

			// Send request
			request := map[string]interface{}{
				"jsonrpc": "2.0",
				"method":  "health",
				"id":      clientID,
			}

			encoder := json.NewEncoder(conn)
			if err := encoder.Encode(request); err != nil {
				t.Errorf("client %d: failed to send request: %v", clientID, err)
				done <- false
				return
			}

			// Read response
			scanner := bufio.NewScanner(conn)
			if !scanner.Scan() {
				t.Errorf("client %d: no response received", clientID)
				done <- false
				return
			}

			var response map[string]interface{}
			if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
				t.Errorf("client %d: failed to parse response: %v", clientID, err)
				done <- false
				return
			}

			// Verify ID matches
			if int(response["id"].(float64)) != clientID {
				t.Errorf("client %d: response ID mismatch, got %v", clientID, response["id"])
				done <- false
				return
			}

			done <- true
		}(i)
	}

	// Wait for all clients to complete
	successCount := 0
	for i := 0; i < numClients; i++ {
		if <-done {
			successCount++
		}
	}

	if successCount != numClients {
		t.Errorf("only %d/%d clients succeeded", successCount, numClients)
	}
}

// TestIntegrationRPCRoundTrip is the main integration test required by Phase 1
func TestIntegrationRPCRoundTrip(t *testing.T) {
	// Use a test-specific socket path for true isolation
	socketPath := testutil.SocketPath(t, "rpc")

	// Create daemon with test socket path
	d := &Daemon{
		socketPath: socketPath,
		config:     &config.Config{SocketPath: socketPath}, // Mock config
	}

	// Create RPC server
	d.rpcServer = rpc.NewServer()

	// Start daemon
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go d.Run(ctx)

	// Wait for daemon to be ready
	time.Sleep(200 * time.Millisecond)

	// Connect as a client
	conn, err := net.Dial("unix", d.socketPath)
	if err != nil {
		t.Fatalf("failed to connect to daemon: %v", err)
	}
	defer conn.Close()

	// Send health check request
	request := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "health",
		"params":  nil,
		"id":      42,
	}

	data, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	if _, err := conn.Write(append(data, '\n')); err != nil {
		t.Fatalf("failed to write request: %v", err)
	}

	// Read response
	scanner := bufio.NewScanner(conn)
	if !scanner.Scan() {
		t.Fatal("no response received from daemon")
	}

	var response rpc.Response
	if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	// Verify response
	if response.JSONRPC != "2.0" {
		t.Errorf("expected JSONRPC 2.0, got %s", response.JSONRPC)
	}

	if response.ID != float64(42) {
		t.Errorf("expected ID 42, got %v", response.ID)
	}

	if response.Error != nil {
		t.Fatalf("unexpected error in response: %+v", response.Error)
	}

	// Check result
	resultMap, ok := response.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("result is not a map: %T", response.Result)
	}

	if resultMap["status"] != "ok" {
		t.Errorf("expected status 'ok', got %v", resultMap["status"])
	}

	if resultMap["version"] != rpc.Version {
		t.Errorf("expected version %s, got %v", rpc.Version, resultMap["version"])
	}

	t.Logf("Integration test passed: daemon responded with status=%s, version=%s",
		resultMap["status"], resultMap["version"])
}
