//go:build integration
// +build integration

package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// TestSessionLaunchIntegration tests launching a session through the daemon
func TestSessionLaunchIntegration(t *testing.T) {
	socketPath := testutil.SocketPath(t, "session")
	_ = testutil.DatabasePath(t, "session") // This sets HUMANLAYER_DATABASE_PATH

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	defer os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
	// Disable API key to prevent approval manager issues in tests
	os.Setenv("HUMANLAYER_API_KEY", "")
	defer os.Unsetenv("HUMANLAYER_API_KEY")
	// Use a temporary config directory to avoid loading user's config
	tempDir := t.TempDir()
	os.Setenv("XDG_CONFIG_HOME", tempDir)
	defer os.Unsetenv("XDG_CONFIG_HOME")

	// Create an empty config file to override any existing config
	configDir := filepath.Join(tempDir, "humanlayer")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configFile := filepath.Join(configDir, "humanlayer.json")
	if err := os.WriteFile(configFile, []byte(`{}`), 0644); err != nil {
		t.Fatalf("Failed to create empty config file: %v", err)
	}

	// Create and start daemon
	daemon, err := New()
	if err != nil {
		t.Fatalf("Failed to create daemon: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	errCh := make(chan error, 1)
	go func() {
		errCh <- daemon.Run(ctx)
	}()

	// Wait for daemon to be ready
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			conn.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify socket is actually ready
	_, err = net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("Daemon socket not ready after 5 seconds: %v", err)
	}

	// Test launching a session
	t.Run("LaunchSession", func(t *testing.T) {
		// Connect to daemon
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("Failed to connect to daemon: %v", err)
		}
		defer conn.Close()
		// Check if claude binary exists
		if _, err := os.Stat("/usr/bin/claude"); os.IsNotExist(err) {
			t.Skip("Claude binary not found, skipping launch test")
		}

		request := rpc.LaunchSessionRequest{
			Query: "Say hello and exit immediately",
			Model: "sonnet",
			MCPConfig: &claudecode.MCPConfig{
				MCPServers: map[string]claudecode.MCPServer{
					"test-server": {
						Command: "echo",
						Args:    []string{"test"},
						Env:     make(map[string]string),
					},
				},
			},
		}

		// Send LaunchSession request
		reqData, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "launchSession",
			"params":  request,
			"id":      1,
		})

		if _, err := conn.Write(append(reqData, '\n')); err != nil {
			t.Fatalf("Failed to send request: %v", err)
		}

		// Read response
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer for large responses
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				t.Fatalf("Scanner error: %v", err)
			}
			t.Fatal("Failed to read response")
		}

		var resp map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to parse response: %v", err)
		}

		// Check for error
		if errObj, ok := resp["error"]; ok {
			t.Fatalf("RPC error: %v", errObj)
		}

		// Verify response
		result, ok := resp["result"].(map[string]interface{})
		if !ok {
			t.Fatalf("Invalid result type: %T", resp["result"])
		}

		sessionID, ok := result["session_id"].(string)
		if !ok || sessionID == "" {
			t.Error("Missing or invalid session_id")
		}

		runID, ok := result["run_id"].(string)
		if !ok || runID == "" {
			t.Error("Missing or invalid run_id")
		}

		t.Logf("Launched session: %s with run_id: %s", sessionID, runID)

		// Verify HUMANLAYER_RUN_ID was set in MCP config
		if request.MCPConfig.MCPServers["test-server"].Env["HUMANLAYER_RUN_ID"] != runID {
			t.Error("HUMANLAYER_RUN_ID not set in MCP config")
		}
	})

	// Test listing sessions
	t.Run("ListSessions", func(t *testing.T) {
		// Connect to daemon
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("Failed to connect to daemon: %v", err)
		}
		defer conn.Close()
		// Send ListSessions request
		reqData, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "listSessions",
			"params":  map[string]interface{}{},
			"id":      2,
		})

		if _, err := conn.Write(append(reqData, '\n')); err != nil {
			t.Fatalf("Failed to send request: %v", err)
		}

		// Read response
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer for large responses
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				t.Fatalf("Scanner error: %v", err)
			}
			t.Fatal("Failed to read response")
		}

		var resp map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to parse response: %v", err)
		}

		// Check for error
		if errObj, ok := resp["error"]; ok {
			t.Fatalf("RPC error: %v", errObj)
		}

		// Verify response
		result, ok := resp["result"].(map[string]interface{})
		if !ok {
			t.Fatalf("Invalid result type: %T", resp["result"])
		}

		sessions, ok := result["sessions"].([]interface{})
		if !ok {
			t.Fatalf("Invalid sessions type: %T", result["sessions"])
		}

		t.Logf("Found %d sessions", len(sessions))

		// If we launched a session, it should be in the list
		if len(sessions) > 0 {
			session := sessions[0].(map[string]interface{})
			if _, ok := session["id"]; !ok {
				t.Error("Session missing id field")
			}
			if _, ok := session["run_id"]; !ok {
				t.Error("Session missing run_id field")
			}
			if _, ok := session["status"]; !ok {
				t.Error("Session missing status field")
			}
		}
	})

	// Test GetSessionLeaves - should return same sessions as listSessions for now since no hierarchy
	t.Run("GetSessionLeaves", func(t *testing.T) {
		// Connect to daemon
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("Failed to connect to daemon: %v", err)
		}
		defer conn.Close()

		// Send GetSessionLeaves request
		reqData, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "getSessionLeaves",
			"params":  map[string]interface{}{},
			"id":      3,
		})

		if _, err := conn.Write(append(reqData, '\n')); err != nil {
			t.Fatalf("Failed to send request: %v", err)
		}

		// Read response
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer for large responses
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				t.Fatalf("Scanner error: %v", err)
			}
			t.Fatal("Failed to read response")
		}

		var resp map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
			t.Fatalf("Failed to parse response: %v", err)
		}

		// Check for error
		if errObj, ok := resp["error"]; ok {
			t.Fatalf("GetSessionLeaves failed: %v", errObj)
		}

		// Check result
		result, ok := resp["result"].(map[string]interface{})
		if !ok {
			t.Fatalf("Invalid result type: %T", resp["result"])
		}

		sessions, ok := result["sessions"].([]interface{})
		if !ok {
			t.Fatalf("Invalid sessions type: %T", result["sessions"])
		}

		t.Logf("Found %d leaf sessions", len(sessions))

		// Verify each session has expected fields
		for i, sess := range sessions {
			session := sess.(map[string]interface{})
			if _, ok := session["id"]; !ok {
				t.Errorf("Session %d missing id field", i)
			}
			if _, ok := session["run_id"]; !ok {
				t.Errorf("Session %d missing run_id field", i)
			}
			if _, ok := session["status"]; !ok {
				t.Errorf("Session %d missing status field", i)
			}
			// Check that parent_session_id field exists (even if empty)
			if _, ok := session["parent_session_id"]; !ok {
				t.Errorf("Session %d missing parent_session_id field", i)
			}
		}
	})

	// Shutdown daemon
	cancel()

	// Wait for daemon to exit
	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("Daemon exited with error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not exit in time")
	}
}

// TestConcurrentSessions tests launching multiple sessions concurrently
func TestConcurrentSessions(t *testing.T) {
	socketPath := testutil.SocketPath(t, "concurrent")
	_ = testutil.DatabasePath(t, "concurrent") // This sets HUMANLAYER_DATABASE_PATH

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	defer os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
	// Disable API key to prevent approval manager issues in tests
	os.Setenv("HUMANLAYER_API_KEY", "")
	defer os.Unsetenv("HUMANLAYER_API_KEY")
	// Use a temporary config directory to avoid loading user's config
	tempDir := t.TempDir()
	os.Setenv("XDG_CONFIG_HOME", tempDir)
	defer os.Unsetenv("XDG_CONFIG_HOME")

	// Create an empty config file to override any existing config
	configDir := filepath.Join(tempDir, "humanlayer")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("Failed to create config dir: %v", err)
	}
	configFile := filepath.Join(configDir, "humanlayer.json")
	if err := os.WriteFile(configFile, []byte(`{}`), 0644); err != nil {
		t.Fatalf("Failed to create empty config file: %v", err)
	}

	// Create and start daemon
	daemon, err := New()
	if err != nil {
		t.Fatalf("Failed to create daemon: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	go daemon.Run(ctx)

	// Wait for daemon to be ready
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.Dial("unix", socketPath)
		if err == nil {
			conn.Close()
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify socket is actually ready
	_, err = net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("Daemon socket not ready after 5 seconds: %v", err)
	}

	// Launch 5 concurrent sessions
	numSessions := 5
	results := make(chan error, numSessions)

	for i := 0; i < numSessions; i++ {
		go func(sessionNum int) {
			// Connect to daemon
			conn, err := net.Dial("unix", socketPath)
			if err != nil {
				results <- fmt.Errorf("session %d: failed to connect: %w", sessionNum, err)
				return
			}
			defer conn.Close()

			// Launch session
			request := rpc.LaunchSessionRequest{
				Query: fmt.Sprintf("Test session %d", sessionNum),
			}

			reqData, _ := json.Marshal(map[string]interface{}{
				"jsonrpc": "2.0",
				"method":  "launchSession",
				"params":  request,
				"id":      sessionNum,
			})

			if _, err := conn.Write(append(reqData, '\n')); err != nil {
				results <- fmt.Errorf("session %d: failed to send: %w", sessionNum, err)
				return
			}

			// Read response
			scanner := bufio.NewScanner(conn)
			scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer
			if !scanner.Scan() {
				if err := scanner.Err(); err != nil {
					results <- fmt.Errorf("session %d: scanner error: %w", sessionNum, err)
				} else {
					results <- fmt.Errorf("session %d: failed to read response", sessionNum)
				}
				return
			}

			var resp map[string]interface{}
			if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
				results <- fmt.Errorf("session %d: failed to parse: %w", sessionNum, err)
				return
			}

			if errObj, ok := resp["error"]; ok {
				results <- fmt.Errorf("session %d: RPC error: %v", sessionNum, errObj)
				return
			}

			results <- nil
		}(i)
	}

	// Wait for all sessions to complete
	for i := 0; i < numSessions; i++ {
		if err := <-results; err != nil {
			// Check if it's due to missing claude binary
			if os.IsNotExist(err) {
				t.Skip("Claude binary not found, skipping concurrent test")
			}
			t.Error(err)
		}
	}

	// Verify all sessions are tracked
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("Failed to connect for verification: %v", err)
	}
	defer conn.Close()

	// List sessions
	reqData, _ := json.Marshal(map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  "listSessions",
		"params":  map[string]interface{}{},
		"id":      999,
	})

	if _, err := conn.Write(append(reqData, '\n')); err != nil {
		t.Fatalf("Failed to send list request: %v", err)
	}

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer for large responses
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			t.Fatalf("Failed to read list response: %v", err)
		}
		t.Fatal("Failed to read list response: no data")
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse list response: %v", err)
	}

	result := resp["result"].(map[string]interface{})
	sessions := result["sessions"].([]interface{})

	// We should have at least numSessions (could be more from previous test)
	if len(sessions) < numSessions {
		t.Errorf("Expected at least %d sessions, got %d", numSessions, len(sessions))
	}
}
