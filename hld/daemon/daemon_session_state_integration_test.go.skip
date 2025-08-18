//go:build integration

package daemon

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestDaemonSessionStateIntegration(t *testing.T) {
	// This test verifies that session state transitions work correctly with local approvals

	// Create test socket
	socketPath := testutil.SocketPath(t, "test")

	// Create test database
	dbPath := filepath.Join(t.TempDir(), "test.db")
	testStore, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer testStore.Close()

	// Create event bus
	eventBus := bus.NewEventBus()

	// Create local approval manager
	approvalManager := approval.NewManager(testStore, eventBus)

	// Create session manager
	sessionManager, err := session.NewManager(eventBus, testStore, "")
	if err != nil {
		t.Fatalf("failed to create session manager: %v", err)
	}

	// Create daemon
	d := &Daemon{
		config: &config.Config{
			SocketPath: socketPath,
			APIKey:     "test-key",
		},
		socketPath: socketPath,
		sessions:   sessionManager,
		approvals:  approvalManager,
		eventBus:   eventBus,
		store:      testStore,
	}

	// Start daemon
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	doneCh := make(chan error)
	go func() {
		doneCh <- d.Run(ctx)
	}()

	// Give daemon time to start
	time.Sleep(100 * time.Millisecond)

	// Create client
	c, err := client.New(socketPath)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer c.Close()

	// Test scenario: Create session with tool call that needs approval
	t.Run("session_state_transitions", func(t *testing.T) {
		// 1. Create a session manually in the database
		sessionID := "test-session-001"
		runID := "test-run-001"
		claudeSessionID := "claude-sess-001"

		ctx := context.Background()
		session := &store.Session{
			ID:              sessionID,
			RunID:           runID,
			ClaudeSessionID: claudeSessionID,
			Query:           "Test query",
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		if err := testStore.CreateSession(ctx, session); err != nil {
			t.Fatalf("failed to create session: %v", err)
		}

		// 2. Add a tool call event that would need approval
		toolCallEvent := &store.ConversationEvent{
			SessionID:       sessionID, // Use the actual session ID from sessions table
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolName:        "dangerous_function",
			ToolID:          "tool-call-123",
			ToolInputJSON:   `{"action": "delete_all"}`,
			ApprovalStatus:  "", // No approval yet
			ApprovalID:      "",
			CreatedAt:       time.Now(),
		}
		if err := testStore.AddConversationEvent(ctx, toolCallEvent); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// 3. Create an approval via RPC (simulating MCP creating approval)
		// We need to use the rpcClient directly for this test
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("failed to connect to daemon: %v", err)
		}
		defer conn.Close()

		rpcClient := &rpcClient{conn: conn}
		var createResp rpc.CreateApprovalResponse
		if err := rpcClient.call("createApproval", rpc.CreateApprovalRequest{
			RunID:     runID,
			ToolName:  "dangerous_function",
			ToolInput: json.RawMessage(`{"action": "delete_all"}`),
		}, &createResp); err != nil {
			t.Fatalf("failed to create approval: %v", err)
		}
		approvalID := createResp.ApprovalID

		// 4. Give time for event bus to propagate and correlation to happen
		time.Sleep(100 * time.Millisecond)

		// 5. Check that session status changed to waiting_input
		updatedSession, err := testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get session: %v", err)
		}
		if updatedSession.Status != store.SessionStatusWaitingInput {
			t.Errorf("expected session status to be waiting_input, got %s", updatedSession.Status)
		}

		// 6. Check that approval was created in database
		approval, err := testStore.GetApproval(ctx, approvalID)
		if err != nil {
			t.Fatalf("failed to get approval: %v", err)
		}
		if approval.Status != store.ApprovalStatusLocalPending {
			t.Errorf("expected approval status to be pending, got %s", approval.Status)
		}

		// 7. Check that approval was correlated with tool call
		conversation, err := testStore.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get conversation: %v", err)
		}

		var correlatedEvent *store.ConversationEvent
		for _, event := range conversation {
			if event.EventType == store.EventTypeToolCall && event.ToolName == "dangerous_function" {
				correlatedEvent = event
				break
			}
		}

		if correlatedEvent == nil {
			t.Fatal("tool call event not found")
		}
		if correlatedEvent.ApprovalStatus != store.ApprovalStatusPending {
			t.Errorf("expected approval status to be pending, got %s", correlatedEvent.ApprovalStatus)
		}
		if correlatedEvent.ApprovalID != approvalID {
			t.Errorf("expected approval ID to be %s, got %s", approvalID, correlatedEvent.ApprovalID)
		}

		// 8. Approve the function call via client
		if err := c.SendDecision(approvalID, "approve", "Approved for testing"); err != nil {
			t.Fatalf("failed to send approval: %v", err)
		}

		// Give time for status update
		time.Sleep(100 * time.Millisecond)

		// 9. Check that session status changed back to running
		finalSession, err := testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get final session: %v", err)
		}
		if finalSession.Status != store.SessionStatusRunning {
			t.Errorf("expected session status to be running after approval, got %s", finalSession.Status)
		}

		// 10. Check that approval status was updated
		finalApproval, err := testStore.GetApproval(ctx, approvalID)
		if err != nil {
			t.Fatalf("failed to get final approval: %v", err)
		}
		if finalApproval.Status != store.ApprovalStatusLocalApproved {
			t.Errorf("expected approval status to be approved, got %s", finalApproval.Status)
		}

		// 11. Check that approval status was updated in conversation
		finalConversation, err := testStore.GetConversation(ctx, claudeSessionID)
		if err != nil {
			t.Fatalf("failed to get final conversation: %v", err)
		}

		var finalEvent *store.ConversationEvent
		for _, event := range finalConversation {
			if event.EventType == store.EventTypeToolCall && event.ToolName == "dangerous_function" {
				finalEvent = event
				break
			}
		}

		if finalEvent == nil {
			t.Fatal("tool call event not found in final conversation")
		}
		if finalEvent.ApprovalStatus != store.ApprovalStatusApproved {
			t.Errorf("expected approval status to be approved, got %s", finalEvent.ApprovalStatus)
		}
	})

	// Cleanup
	cancel()
	select {
	case err := <-doneCh:
		if err != nil {
			t.Errorf("daemon returned error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Error("daemon did not shut down in time")
	}
}
