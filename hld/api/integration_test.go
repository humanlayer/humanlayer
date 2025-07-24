//go:build integration
// +build integration

package api_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/daemon"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRESTAndRPCCoexistence(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Setup test environment
	socketPath := testutil.SocketPath(t, "integration")
	dbPath := testutil.DatabasePath(t, "integration")
	httpPort := getFreePort(t)

	// Set environment variables for daemon config
	oldSocketPath := os.Getenv("HUMANLAYER_DAEMON_SOCKET_PATH")
	oldDBPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	oldHTTPPort := os.Getenv("HUMANLAYER_DAEMON_HTTP_PORT")
	oldHTTPHost := os.Getenv("HUMANLAYER_DAEMON_HTTP_HOST")

	os.Setenv("HUMANLAYER_DAEMON_SOCKET_PATH", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	t.Cleanup(func() {
		if oldSocketPath != "" {
			os.Setenv("HUMANLAYER_DAEMON_SOCKET_PATH", oldSocketPath)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_SOCKET_PATH")
		}
		if oldHTTPPort != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", oldHTTPPort)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
		}
		if oldHTTPHost != "" {
			os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", oldHTTPHost)
		} else {
			os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
		}
		// Note: oldDBPath cleanup is handled by testutil.DatabasePath
	})

	// Start daemon with both RPC and REST
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	d, err := daemon.New()
	require.NoError(t, err, "Failed to create daemon")

	errChan := make(chan error, 1)
	go func() {
		errChan <- d.Run(ctx)
	}()

	// Wait for daemon to start
	require.Eventually(t, func() bool {
		_, err := os.Stat(socketPath)
		return err == nil
	}, 5*time.Second, 100*time.Millisecond, "Daemon failed to create socket")

	// Wait for HTTP server to start
	require.Eventually(t, func() bool {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		if err == nil {
			resp.Body.Close()
			return resp.StatusCode == 200
		}
		return false
	}, 5*time.Second, 100*time.Millisecond, "HTTP server failed to start")

	t.Run("create session via REST and retrieve via RPC", func(t *testing.T) {
		// Create session using REST API
		restClient := &http.Client{}
		createReq := api.CreateSessionRequest{
			Query: "Test session from REST",
			Model: "claude-3-sonnet",
		}

		body, _ := json.Marshal(createReq)
		resp, err := restClient.Post(
			fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort),
			"application/json",
			bytes.NewReader(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 201, resp.StatusCode)

		var createResp struct {
			Data api.CreateSessionResponse_Data `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&createResp)
		require.NoError(t, err)

		sessionID := createResp.Data.SessionId

		// Retrieve session using RPC client
		rpcClient, err := client.Connect(socketPath, 3, time.Second)
		require.NoError(t, err)
		defer rpcClient.Close()

		// Get session state via RPC
		stateResp, err := rpcClient.GetSessionState(sessionID)
		require.NoError(t, err)

		assert.Equal(t, sessionID, stateResp.Session.ID)
		assert.Equal(t, "Test session from REST", stateResp.Session.Query)
		assert.Equal(t, createResp.Data.RunId, stateResp.Session.RunID)
	})

	t.Run("create approval via RPC and decide via REST", func(t *testing.T) {
		// First create a session via RPC
		rpcClient, err := client.Connect(socketPath, 3, time.Second)
		require.NoError(t, err)
		defer rpcClient.Close()

		// Create a simple approval (not tied to a real session for this test)
		runID := fmt.Sprintf("test-run-%d", time.Now().Unix())

		// Create approval via RPC
		createApprovalResp, err := rpcClient.CreateApproval(rpc.CreateApprovalRequest{
			RunID:     runID,
			ToolName:  "bash",
			ToolInput: `{"command": "echo test"}`,
		})
		require.NoError(t, err)

		approvalID := createApprovalResp.ApprovalID

		// Decide approval using REST API
		restClient := &http.Client{}
		decideReq := api.DecideApprovalRequest{
			Decision: api.DecideApprovalRequestDecisionApprove,
			Comment:  stringPtr("Approved via REST"),
		}

		body, _ := json.Marshal(decideReq)
		resp, err := restClient.Post(
			fmt.Sprintf("http://127.0.0.1:%d/api/v1/approvals/%s/decide", httpPort, approvalID),
			"application/json",
			bytes.NewReader(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		// Verify via RPC that approval was decided
		fetchResp, err := rpcClient.FetchApprovals(runID)
		require.NoError(t, err)
		require.Len(t, fetchResp.Approvals, 1)

		approval := fetchResp.Approvals[0]
		assert.Equal(t, "approved", approval.Status)
		assert.Equal(t, "Approved via REST", approval.Comment)
	})

	t.Run("SSE events from RPC operations", func(t *testing.T) {
		// Subscribe to SSE events
		sseURL := fmt.Sprintf("http://127.0.0.1:%d/api/v1/events", httpPort)

		// Start SSE connection
		resp, err := http.Get(sseURL)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))

		// Create a channel to receive parsed events
		eventChan := make(chan api.Event, 10)

		// Start goroutine to read SSE events
		go func() {
			scanner := bufio.NewScanner(resp.Body)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "data: ") {
					data := strings.TrimPrefix(line, "data: ")
					var event api.Event
					if err := json.Unmarshal([]byte(data), &event); err == nil {
						eventChan <- event
					}
				}
			}
		}()

		// Create approval via RPC
		rpcClient, err := client.Connect(socketPath, 3, time.Second)
		require.NoError(t, err)
		defer rpcClient.Close()

		runID := fmt.Sprintf("test-run-sse-%d", time.Now().Unix())
		createApprovalResp, err := rpcClient.CreateApproval(rpc.CreateApprovalRequest{
			RunID:     runID,
			ToolName:  "write_file",
			ToolInput: `{"path": "/tmp/test.txt", "content": "test"}`,
		})
		require.NoError(t, err)

		approvalID := createApprovalResp.ApprovalID

		// Wait for new_approval event
		select {
		case event := <-eventChan:
			assert.Equal(t, "new_approval", string(event.Type))
			assert.Equal(t, approvalID, event.Data["approvalId"])
			assert.Equal(t, runID, event.Data["runId"])
		case <-time.After(2 * time.Second):
			t.Fatal("Timeout waiting for new_approval event")
		}

		// Decide approval via RPC
		err = rpcClient.SendDecision(approvalID, "approve", "")
		require.NoError(t, err)

		// Wait for approval_resolved event
		select {
		case event := <-eventChan:
			assert.Equal(t, "approval_resolved", string(event.Type))
			assert.Equal(t, approvalID, event.Data["approvalId"])
			assert.Equal(t, "approved", event.Data["decision"])
		case <-time.After(2 * time.Second):
			t.Fatal("Timeout waiting for approval_resolved event")
		}
	})

	t.Run("concurrent operations via REST and RPC", func(t *testing.T) {
		// Create multiple sessions concurrently using both REST and RPC
		numOperations := 5
		results := make(chan string, numOperations*2)
		errors := make(chan error, numOperations*2)

		// Create RPC client
		rpcClient, err := client.Connect(socketPath, 3, time.Second)
		require.NoError(t, err)
		defer rpcClient.Close()

		// Launch REST sessions
		for i := 0; i < numOperations; i++ {
			go func(index int) {
				restClient := &http.Client{}
				createReq := api.CreateSessionRequest{
					Query: fmt.Sprintf("REST session %d", index),
					Model: "claude-3-sonnet",
				}

				body, _ := json.Marshal(createReq)
				resp, err := restClient.Post(
					fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort),
					"application/json",
					bytes.NewReader(body),
				)
				if err != nil {
					errors <- err
					return
				}
				defer resp.Body.Close()

				var createResp struct {
					Data api.CreateSessionResponse_Data `json:"data"`
				}
				if err := json.NewDecoder(resp.Body).Decode(&createResp); err != nil {
					errors <- err
					return
				}

				results <- createResp.Data.SessionId
			}(i)
		}

		// Launch RPC sessions
		for i := 0; i < numOperations; i++ {
			go func(index int) {
				resp, err := rpcClient.LaunchSession(rpc.LaunchSessionRequest{
					Query: fmt.Sprintf("RPC session %d", index),
					Model: "claude-3-sonnet",
				})
				if err != nil {
					errors <- err
					return
				}
				results <- resp.SessionID
			}(i)
		}

		// Collect results
		sessionIDs := make([]string, 0, numOperations*2)
		for i := 0; i < numOperations*2; i++ {
			select {
			case sessionID := <-results:
				sessionIDs = append(sessionIDs, sessionID)
			case err := <-errors:
				t.Fatalf("Concurrent operation failed: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("Timeout waiting for concurrent operations")
			}
		}

		assert.Len(t, sessionIDs, numOperations*2)

		// Verify all sessions exist by listing them via both protocols
		// Via REST
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort))
		require.NoError(t, err)
		defer resp.Body.Close()

		var listResp struct {
			Data []api.Session `json:"data"`
		}
		err = json.NewDecoder(resp.Body).Decode(&listResp)
		require.NoError(t, err)

		// Via RPC
		rpcListResp, err := rpcClient.GetSessionLeaves()
		require.NoError(t, err)

		// Both should return the same sessions
		assert.Equal(t, len(rpcListResp.Sessions), len(listResp.Data))
	})

	t.Run("health check via both protocols", func(t *testing.T) {
		// Check health via REST
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var healthResp api.HealthResponse
		err = json.NewDecoder(resp.Body).Decode(&healthResp)
		require.NoError(t, err)
		assert.Equal(t, api.HealthResponseStatusOk, healthResp.Status)

		// Check health via RPC
		rpcClient, err := client.Connect(socketPath, 3, time.Second)
		require.NoError(t, err)
		defer rpcClient.Close()

		err = rpcClient.Health()
		assert.NoError(t, err)
	})

	// Cleanup
	cancel()

	select {
	case err := <-errChan:
		// Context cancelled error is expected
		if err != nil && err != context.Canceled {
			t.Fatalf("Daemon exited with error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for daemon to shutdown")
	}
}

func TestRESTAPIErrorHandling(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Setup test environment
	socketPath := testutil.SocketPath(t, "error-handling")
	dbPath := testutil.DatabasePath(t, "error-handling")
	httpPort := getFreePort(t)

	// Set environment variables
	os.Setenv("HUMANLAYER_DAEMON_SOCKET_PATH", socketPath)
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	d, err := daemon.New()
	require.NoError(t, err)

	go func() {
		_ = d.Run(ctx)
	}()

	// Wait for HTTP server to start
	require.Eventually(t, func() bool {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		if err == nil {
			resp.Body.Close()
			return resp.StatusCode == 200
		}
		return false
	}, 5*time.Second, 100*time.Millisecond)

	t.Run("404 for non-existent resource", func(t *testing.T) {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions/non-existent-id", httpPort))
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 404, resp.StatusCode)

		var errResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		err = json.NewDecoder(resp.Body).Decode(&errResp)
		require.NoError(t, err)

		assert.Equal(t, "HLD-1002", errResp.Error.Code)
		assert.Contains(t, errResp.Error.Message, "not found")
	})

	t.Run("400 for invalid request", func(t *testing.T) {
		// Try to deny an approval without a comment
		decideReq := api.DecideApprovalRequest{
			Decision: api.DecideApprovalRequestDecisionDeny,
			// Missing required comment
		}

		body, _ := json.Marshal(decideReq)
		resp, err := http.Post(
			fmt.Sprintf("http://127.0.0.1:%d/api/v1/approvals/some-id/decide", httpPort),
			"application/json",
			bytes.NewReader(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 400, resp.StatusCode)

		var errResp struct {
			Error api.ErrorDetail `json:"error"`
		}
		err = json.NewDecoder(resp.Body).Decode(&errResp)
		require.NoError(t, err)

		assert.Equal(t, "HLD-3001", errResp.Error.Code)
		assert.Contains(t, errResp.Error.Message, "comment is required")
	})

	t.Run("405 for unsupported method", func(t *testing.T) {
		req, _ := http.NewRequest("DELETE", fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort), nil)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 405, resp.StatusCode)
	})

	cancel()
}

func getFreePort(t *testing.T) int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}

func stringPtr(s string) *string {
	return &s
}
