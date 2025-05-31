//go:build integration

package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// mockAPIClient is a test implementation of the HumanLayer API client
// This simulates a backend API for integration testing
type mockAPIClient struct {
	functionCalls []humanlayer.FunctionCall
	humanContacts []humanlayer.HumanContact
	decisions     map[string]string // call_id -> decision
	mu            sync.Mutex
}

func newMockAPIClient() *mockAPIClient {
	return &mockAPIClient{
		decisions: make(map[string]string),
	}
}

func (m *mockAPIClient) GetPendingFunctionCalls(ctx context.Context) ([]humanlayer.FunctionCall, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Return only function calls that haven't been decided
	var pending []humanlayer.FunctionCall
	for _, fc := range m.functionCalls {
		if _, decided := m.decisions[fc.CallID]; !decided {
			pending = append(pending, fc)
		}
	}
	return pending, nil
}

func (m *mockAPIClient) GetPendingHumanContacts(ctx context.Context) ([]humanlayer.HumanContact, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Return only contacts that haven't been decided
	var pending []humanlayer.HumanContact
	for _, hc := range m.humanContacts {
		if _, decided := m.decisions[hc.CallID]; !decided {
			pending = append(pending, hc)
		}
	}
	return pending, nil
}

func (m *mockAPIClient) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.decisions[callID] = "approved"
	return nil
}

func (m *mockAPIClient) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.decisions[callID] = "denied"
	return nil
}

func (m *mockAPIClient) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.decisions[callID] = "responded"
	return nil
}

func TestDaemonApprovalIntegration(t *testing.T) {
	// Create test socket path
	socketPath := testutil.SocketPath(t, "daemon-approval-test")

	// Create mock API client with test data
	mockClient := newMockAPIClient()
	mockClient.functionCalls = []humanlayer.FunctionCall{
		{
			CallID: "fc-1",
			RunID:  "test-run-1",
			Spec: humanlayer.FunctionCallSpec{
				Fn: "dangerous_function",
				Kwargs: map[string]interface{}{
					"action": "delete_all",
				},
			},
		},
		{
			CallID: "fc-2",
			RunID:  "test-run-2",
			Spec: humanlayer.FunctionCallSpec{
				Fn: "safe_function",
			},
		},
	}
	mockClient.humanContacts = []humanlayer.HumanContact{
		{
			CallID: "hc-1",
			RunID:  "test-run-1",
			Spec: humanlayer.HumanContactSpec{
				Msg: "Need human help",
			},
		},
	}

	// Create real approval components for integration testing
	store := approval.NewMemoryStore()
	poller := approval.NewPoller(mockClient, store, 50*time.Millisecond, nil)

	// We need to manually construct the manager with our test client
	approvalManager := &approval.DefaultManager{
		Client: mockClient,
		Store:  store,
		Poller: poller,
	}

	// Create test daemon with approval manager
	d := &Daemon{
		config: &config.Config{
			SocketPath: socketPath,
			APIKey:     "test-key",
		},
		socketPath: socketPath,
		approvals:  approvalManager,
	}

	// Create session manager (we don't need real sessions for this test)
	sessionManager, err := session.NewManager(nil)
	if err != nil {
		t.Fatalf("failed to create session manager: %v", err)
	}
	d.sessions = sessionManager

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

	// Wait for poller to fetch initial data
	time.Sleep(100 * time.Millisecond)

	// Test 1: Fetch all approvals
	var fetchResp rpc.FetchApprovalsResponse
	err = client.call("fetchApprovals", rpc.FetchApprovalsRequest{}, &fetchResp)
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}

	if len(fetchResp.Approvals) != 3 {
		t.Errorf("expected 3 approvals, got %d", len(fetchResp.Approvals))
	}

	// Test 2: Approve a function call
	var decisionResp rpc.SendDecisionResponse
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   "fc-1",
		Type:     "function_call",
		Decision: "approve",
		Comment:  "Looks good",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}

	if !decisionResp.Success {
		t.Errorf("expected success, got error: %s", decisionResp.Error)
	}

	// Verify the decision was recorded
	if mockClient.decisions["fc-1"] != "approved" {
		t.Errorf("expected fc-1 to be approved, got %s", mockClient.decisions["fc-1"])
	}

	// Test 3: Deny a function call
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   "fc-2",
		Type:     "function_call",
		Decision: "deny",
		Comment:  "Too risky",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}

	if !decisionResp.Success {
		t.Errorf("expected success, got error: %s", decisionResp.Error)
	}

	// Test 4: Respond to human contact
	err = client.call("sendDecision", rpc.SendDecisionRequest{
		CallID:   "hc-1",
		Type:     "human_contact",
		Decision: "respond",
		Comment:  "Here's the help you need",
	}, &decisionResp)
	if err != nil {
		t.Fatalf("failed to send decision: %v", err)
	}

	if !decisionResp.Success {
		t.Errorf("expected success, got error: %s", decisionResp.Error)
	}

	// Wait for next poll cycle
	time.Sleep(100 * time.Millisecond)

	// Test 5: Verify approvals are no longer pending
	err = client.call("fetchApprovals", rpc.FetchApprovalsRequest{}, &fetchResp)
	if err != nil {
		t.Fatalf("failed to fetch approvals: %v", err)
	}

	if len(fetchResp.Approvals) != 0 {
		t.Errorf("expected 0 pending approvals after decisions, got %d", len(fetchResp.Approvals))
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
