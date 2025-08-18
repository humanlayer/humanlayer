//go:build integration

package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestDaemonApprovalIntegration(t *testing.T) {
	// Create test database path
	dbPath := testutil.DatabasePath(t, "daemon-approval-test")
	httpPort := getFreePort(t)

	// Set environment variables for daemon config
	oldDBPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	oldHTTPPort := os.Getenv("HUMANLAYER_DAEMON_HTTP_PORT")
	oldHTTPHost := os.Getenv("HUMANLAYER_DAEMON_HTTP_HOST")

	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")

	t.Cleanup(func() {
		if oldDBPath != "" {
			os.Setenv("HUMANLAYER_DATABASE_PATH", oldDBPath)
		} else {
			os.Unsetenv("HUMANLAYER_DATABASE_PATH")
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
	})

	// Create daemon using New() which properly initializes everything
	d, err := New()
	if err != nil {
		t.Fatalf("failed to create daemon: %v", err)
	}

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for HTTP server to start
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", httpPort)
	var httpReady bool
	for i := 0; i < 50; i++ { // 5 seconds timeout
		resp, err := http.Get(fmt.Sprintf("%s/api/v1/health", baseURL))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				httpReady = true
				break
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !httpReady {
		t.Fatal("HTTP server failed to start")
	}

	// Create HTTP client
	client := &http.Client{}

	// Test scenario: Create local approvals and test REST operations

	// First, create test sessions directly in the store
	ctx2 := context.Background()

	// Create test sessions
	session1 := &store.Session{
		ID:             "test-session-1",
		RunID:          "test-run-1",
		Query:          "Test query 1",
		Status:         store.SessionStatusRunning,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
	if err := d.store.CreateSession(ctx2, session1); err != nil {
		t.Fatalf("failed to create session 1: %v", err)
	}

	session2 := &store.Session{
		ID:             "test-session-2",
		RunID:          "test-run-2",
		Query:          "Test query 2",
		Status:         store.SessionStatusRunning,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}
	if err := d.store.CreateSession(ctx2, session2); err != nil {
		t.Fatalf("failed to create session 2: %v", err)
	}

	// Create approvals via the REST API

	// Approval 1
	createReq1 := api.CreateApprovalRequest{
		RunId:     "test-run-1",
		ToolName:  "dangerous_function",
		ToolInput: map[string]interface{}{"action": "delete_all"},
	}

	body1, _ := json.Marshal(createReq1)
	resp1, err := client.Post(
		fmt.Sprintf("%s/api/v1/approvals", baseURL),
		"application/json",
		bytes.NewReader(body1),
	)
	if err != nil {
		t.Fatalf("failed to create approval 1: %v", err)
	}
	defer resp1.Body.Close()

	if resp1.StatusCode != 201 {
		t.Fatalf("expected status 201, got %d", resp1.StatusCode)
	}

	var createResp1 api.CreateApprovalResponse
	if err := json.NewDecoder(resp1.Body).Decode(&createResp1); err != nil {
		t.Fatalf("failed to decode approval 1 response: %v", err)
	}
	approval1ID := createResp1.Data.ApprovalId

	// Approval 2
	createReq2 := api.CreateApprovalRequest{
		RunId:     "test-run-2",
		ToolName:  "safe_function",
		ToolInput: map[string]interface{}{"action": "read_only"},
	}

	body2, _ := json.Marshal(createReq2)
	resp2, err := client.Post(
		fmt.Sprintf("%s/api/v1/approvals", baseURL),
		"application/json",
		bytes.NewReader(body2),
	)
	if err != nil {
		t.Fatalf("failed to create approval 2: %v", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode != 201 {
		t.Fatalf("expected status 201, got %d", resp2.StatusCode)
	}

	var createResp2 api.CreateApprovalResponse
	if err := json.NewDecoder(resp2.Body).Decode(&createResp2); err != nil {
		t.Fatalf("failed to decode approval 2 response: %v", err)
	}
	approval2ID := createResp2.Data.ApprovalId

	// Test 1: Fetch all approvals (should be empty without session filter)
	resp, err := client.Get(fmt.Sprintf("%s/api/v1/approvals", baseURL))
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}
	defer resp.Body.Close()

	var listResp struct {
		Data []api.Approval `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}

	if len(listResp.Data) != 0 {
		t.Errorf("expected 0 approvals without session filter, got %d", len(listResp.Data))
	}

	// Test 2: Fetch approvals for session 1
	resp, err = client.Get(fmt.Sprintf("%s/api/v1/approvals?sessionId=test-session-1", baseURL))
	if err != nil {
		t.Fatalf("failed to fetch approvals for session 1: %v", err)
	}
	defer resp.Body.Close()

	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}

	if len(listResp.Data) != 1 {
		t.Errorf("expected 1 approval for session 1, got %d", len(listResp.Data))
	}

	// Test 3: Approve a function call
	comment := "Looks good"
	decideReq1 := api.DecideApprovalRequest{
		Decision: api.Approve,
		Comment:  &comment,
	}

	body, _ := json.Marshal(decideReq1)
	resp, err = client.Post(
		fmt.Sprintf("%s/api/v1/approvals/%s/decide", baseURL, approval1ID),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatalf("failed to send approval decision: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	var decideResp struct {
		Data struct {
			Success bool    `json:"success"`
			Error   *string `json:"error,omitempty"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decideResp); err != nil {
		t.Fatalf("failed to decode decide response: %v", err)
	}

	if !decideResp.Data.Success {
		errMsg := ""
		if decideResp.Data.Error != nil {
			errMsg = *decideResp.Data.Error
		}
		t.Errorf("expected success, got error: %s", errMsg)
	}

	// Test 4: Deny a function call
	denyComment := "Too risky"
	decideReq2 := api.DecideApprovalRequest{
		Decision: api.Deny,
		Comment:  &denyComment,
	}

	body, _ = json.Marshal(decideReq2)
	resp, err = client.Post(
		fmt.Sprintf("%s/api/v1/approvals/%s/decide", baseURL, approval2ID),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatalf("failed to send deny decision: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(&decideResp); err != nil {
		t.Fatalf("failed to decode decide response: %v", err)
	}

	if !decideResp.Data.Success {
		errMsg := ""
		if decideResp.Data.Error != nil {
			errMsg = *decideResp.Data.Error
		}
		t.Errorf("expected success, got error: %s", errMsg)
	}

	// Test 5: Verify approvals are no longer pending
	resp, err = client.Get(fmt.Sprintf("%s/api/v1/approvals?sessionId=test-session-1", baseURL))
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}
	defer resp.Body.Close()

	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}

	if len(listResp.Data) != 0 {
		t.Errorf("expected 0 pending approvals for session 1 after approval, got %d", len(listResp.Data))
	}

	// Test 6: Try to approve non-existent approval
	failComment := "Should fail"
	decideReq3 := api.DecideApprovalRequest{
		Decision: api.Approve,
		Comment:  &failComment,
	}

	body, _ = json.Marshal(decideReq3)
	resp, err = client.Post(
		fmt.Sprintf("%s/api/v1/approvals/non-existent/decide", baseURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}
	defer resp.Body.Close()

	// Should get a 404 for non-existent approval
	if resp.StatusCode != 404 {
		t.Errorf("expected status 404 for non-existent approval, got %d", resp.StatusCode)
	}

	// Shutdown daemon
	cancel()
	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled {
			t.Errorf("daemon error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon shutdown timeout")
	}
}

// getFreePort finds an available port for testing
func getFreePort(t *testing.T) int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to get free port: %v", err)
	}
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}
