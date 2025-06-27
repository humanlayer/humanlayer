//go:build integration

package daemon

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	humanlayer "github.com/humanlayer/humanlayer/humanlayer-go"
)

// TestSessionStateTransitionsIntegration tests the full flow of session state changes
// when approvals are created and resolved
func TestSessionStateTransitionsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	// Create temporary socket path for test
	socketPath := testutil.SocketPath(t, "session-state")

	// Use a temporary database file instead of :memory: to ensure all connections
	// access the same database (in-memory databases are unique per connection)
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	
	// Create the store
	testStore, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	defer testStore.Close()
	
	// Set environment variables to ensure consistent test behavior
	t.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	t.Setenv("HUMANLAYER_API_KEY", "test-key")

	// Create event bus
	eventBus := bus.NewEventBus()

	// Create mock API client
	mockClient := &mockSessionStateAPIClient{
		functionCalls: make(map[string]*humanlayer.FunctionCall),
	}

	// Create real approval components
	approvalStore := approval.NewMemoryStore()
	poller := approval.NewPoller(mockClient, approvalStore, testStore, 50*time.Millisecond, eventBus)

	// Create approval manager
	approvalManager := &approval.DefaultManager{
		Client:            mockClient,
		Store:             approvalStore,
		Poller:            poller,
		EventBus:          eventBus,
		ConversationStore: testStore,
	}

	// Create session manager
	sessionManager, err := session.NewManager(eventBus, testStore)
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

		// 2. Add a tool call that needs approval
		toolCall := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			Sequence:        1,
			EventType:       store.EventTypeToolCall,
			ToolID:          "tool-001",
			ToolName:        "dangerous_function",
			ToolInputJSON:   `{"action": "delete_all"}`,
			CreatedAt:       time.Now(),
		}
		if err := testStore.AddConversationEvent(ctx, toolCall); err != nil {
			t.Fatalf("failed to add tool call: %v", err)
		}

		// 3. Simulate an approval coming from HumanLayer API
		approvalID := "approval-001"
		mockClient.AddFunctionCall(humanlayer.FunctionCall{
			CallID: approvalID,
			RunID:  runID,
			Spec: humanlayer.FunctionCallSpec{
				Fn: "dangerous_function",
				Kwargs: map[string]interface{}{
					"action": "delete_all",
				},
			},
		})

		// 4. Wait for poller to pick up the approval and correlate it
		time.Sleep(150 * time.Millisecond)

		// 5. Check that session status changed to waiting_input
		updatedSession, err := testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get session: %v", err)
		}
		if updatedSession.Status != store.SessionStatusWaitingInput {
			t.Errorf("expected session status to be waiting_input, got %s", updatedSession.Status)
		}

		// 6. Check that approval was correlated
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

		// 7. Approve the function call via client
		if err := c.SendDecision(approvalID, "function_call", "approve", "Approved for testing"); err != nil {
			t.Fatalf("failed to send approval: %v", err)
		}

		// Give time for status update
		time.Sleep(100 * time.Millisecond)

		// 8. Check that session status changed back to running
		finalSession, err := testStore.GetSession(ctx, sessionID)
		if err != nil {
			t.Fatalf("failed to get final session: %v", err)
		}
		if finalSession.Status != store.SessionStatusRunning {
			t.Errorf("expected session status to be running after approval, got %s", finalSession.Status)
		}

		// 9. Check that approval status was updated
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

// Mock API client for session state testing
type mockSessionStateAPIClient struct {
	functionCalls map[string]*humanlayer.FunctionCall
}

func (m *mockSessionStateAPIClient) AddFunctionCall(fc humanlayer.FunctionCall) {
	m.functionCalls[fc.CallID] = &fc
}

func (m *mockSessionStateAPIClient) GetPendingFunctionCalls(ctx context.Context) ([]humanlayer.FunctionCall, error) {
	var result []humanlayer.FunctionCall
	for _, fc := range m.functionCalls {
		if fc.Status == nil || fc.Status.RespondedAt == nil {
			result = append(result, *fc)
		}
	}
	return result, nil
}

func (m *mockSessionStateAPIClient) GetPendingHumanContacts(ctx context.Context) ([]humanlayer.HumanContact, error) {
	return []humanlayer.HumanContact{}, nil
}

func (m *mockSessionStateAPIClient) ApproveFunctionCall(ctx context.Context, callID string, comment string) error {
	if fc, ok := m.functionCalls[callID]; ok {
		if fc.Status == nil {
			fc.Status = &humanlayer.FunctionCallStatus{}
		}
		now := humanlayer.CustomTime{Time: time.Now()}
		fc.Status.RespondedAt = &now
		approved := true
		fc.Status.Approved = &approved
		fc.Status.Comment = comment
		return nil
	}
	return fmt.Errorf("function call not found: %s", callID)
}

func (m *mockSessionStateAPIClient) DenyFunctionCall(ctx context.Context, callID string, reason string) error {
	if fc, ok := m.functionCalls[callID]; ok {
		if fc.Status == nil {
			fc.Status = &humanlayer.FunctionCallStatus{}
		}
		now := humanlayer.CustomTime{Time: time.Now()}
		fc.Status.RespondedAt = &now
		approved := false
		fc.Status.Approved = &approved
		fc.Status.Comment = reason
		return nil
	}
	return fmt.Errorf("function call not found: %s", callID)
}

func (m *mockSessionStateAPIClient) RespondToHumanContact(ctx context.Context, callID string, response string) error {
	return fmt.Errorf("not implemented")
}
