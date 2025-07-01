//go:build integration

package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestDaemonApprovalIntegration(t *testing.T) {
	// Create test socket path
	socketPath := testutil.SocketPath(t, "daemon-approval-test")

	// Create a minimal in-memory store for testing
	testStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	defer testStore.Close()

	// Create event bus for the approval manager
	eventBus := bus.NewEventBus()

	// Create local approval manager
	approvalManager := approval.NewManager(testStore, eventBus)

	// Create session manager
	sessionManager, err := session.NewManager(eventBus, testStore)
	if err != nil {
		t.Fatalf("failed to create session manager: %v", err)
	}

	// Create test daemon with approval manager
	d := &Daemon{
		config: &config.Config{
			SocketPath: socketPath,
			APIKey:     "test-key",
		},
		socketPath: socketPath,
		approvals:  approvalManager,
		sessions:   sessionManager,
		eventBus:   eventBus,
		store:      testStore,
	}

	// Start daemon
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for daemon to start
	time.Sleep(100 * time.Millisecond)

	// Connect to daemon
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to connect to daemon: %v", err)
	}
	defer conn.Close()

	// Create RPC client
	client := &rpcClient{conn: conn}

	// Test scenario: Create local approvals and test RPC operations

	// First, create test sessions and approvals in the database
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
	if err := testStore.CreateSession(ctx2, session1); err != nil {
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
	if err := testStore.CreateSession(ctx2, session2); err != nil {
		t.Fatalf("failed to create session 2: %v", err)
	}

	// Create approvals via the RPC interface
	var createResp rpc.CreateApprovalResponse

	// Approval 1
	err = client.call("createApproval", rpc.CreateApprovalRequest{
		RunID:     "test-run-1",
		ToolName:  "dangerous_function",
		ToolInput: json.RawMessage(`{"action": "delete_all"}`),
	}, &createResp)
	if err != nil {
		t.Fatalf("failed to create approval 1: %v", err)
	}
	approval1ID := createResp.ApprovalID

	// Approval 2
	err = client.call("createApproval", rpc.CreateApprovalRequest{
		RunID:     "test-run-2",
		ToolName:  "safe_function",
		ToolInput: json.RawMessage(`{"action": "read_only"}`),
	}, &createResp)
	if err != nil {
		t.Fatalf("failed to create approval 2: %v", err)
	}
	approval2ID := createResp.ApprovalID

	// Test 1: Fetch all approvals (should be empty without session filter)
	var fetchResp rpc.FetchApprovalsResponse
	err = client.call("fetchApprovals", rpc.FetchApprovalsRequest{}, &fetchResp)
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}

	if len(fetchResp.Approvals) != 0 {
		t.Errorf("expected 0 approvals without session filter, got %d", len(fetchResp.Approvals))
	}

	// Test 2: Fetch approvals for session 1
	err = client.call("fetchApprovals", rpc.FetchApprovalsRequest{
		SessionID: "test-session-1",
	}, &fetchResp)
	if err != nil {
		t.Fatalf("failed to fetch approvals for session 1: %v", err)
	}

	if len(fetchResp.Approvals) != 1 {
		t.Errorf("expected 1 approval for session 1, got %d", len(fetchResp.Approvals))
	}

	// Test 3: Approve a function call
	var decisionResp rpc.SendDecisionResponse
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   approval1ID,
		Type:     "function_call",
		Decision: "approve",
		Comment:  "Looks good",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send approval decision: %v", err)
	}

	if !decisionResp.Success {
		t.Errorf("expected success, got error: %s", decisionResp.Error)
	}

	// Test 4: Deny a function call
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   approval2ID,
		Type:     "function_call",
		Decision: "deny",
		Comment:  "Too risky",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send deny decision: %v", err)
	}

	if !decisionResp.Success {
		t.Errorf("expected success, got error: %s", decisionResp.Error)
	}

	// Test 5: Verify approvals are no longer pending
	err = client.call("fetchApprovals", rpc.FetchApprovalsRequest{
		SessionID: "test-session-1",
	}, &fetchResp)
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}

	if len(fetchResp.Approvals) != 0 {
		t.Errorf("expected 0 pending approvals for session 1 after approval, got %d", len(fetchResp.Approvals))
	}

	// Test 6: Try to approve non-existent approval
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   "non-existent",
		Type:     "function_call",
		Decision: "approve",
		Comment:  "Should fail",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}

	if decisionResp.Success {
		t.Error("expected failure for non-existent approval")
	}

	// Test 7: Human contact is no longer supported
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   "some-id",
		Type:     "human_contact",
		Decision: "respond",
		Comment:  "Should fail",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}

	if decisionResp.Success {
		t.Error("expected failure for human contact type")
	}
	if decisionResp.Error != "human contact approvals are no longer supported" {
		t.Errorf("expected specific error for human contact, got: %s", decisionResp.Error)
	}

	// Shutdown daemon
	cancel()
	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("daemon error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon shutdown timeout")
	}
}

// rpcClient is a simple JSON-RPC client for testing
type rpcClient struct {
	conn net.Conn
	id   int
}

func (c *rpcClient) call(method string, params interface{}, result interface{}) error {
	c.id++

	// Send request
	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
		"id":      c.id,
	}

	encoder := json.NewEncoder(c.conn)
	if err := encoder.Encode(req); err != nil {
		return err
	}

	// Read response
	var resp map[string]interface{}
	decoder := json.NewDecoder(c.conn)
	if err := decoder.Decode(&resp); err != nil {
		return err
	}

	// Check for error
	if errObj, ok := resp["error"]; ok {
		errMap := errObj.(map[string]interface{})
		return fmt.Errorf("RPC error: %v", errMap["message"])
	}

	// Unmarshal result
	if resp["result"] != nil {
		resultBytes, err := json.Marshal(resp["result"])
		if err != nil {
			return err
		}
		return json.Unmarshal(resultBytes, result)
	}

	return nil
}
