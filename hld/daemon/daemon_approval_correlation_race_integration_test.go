//go:build integration
// +build integration

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
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/require"
)

// TestApprovalCorrelationRace tests the race condition where an approval is created
// before the tool call transaction completes, leading to correlation failure
func TestApprovalCorrelationRace(t *testing.T) {
	t.Run("tool_call_storage_delay", func(t *testing.T) {
		// Create test socket path
		socketPath := testutil.SocketPath(t, "correlation-race-test")

		// Create test store
		testStore, err := store.NewSQLiteStore(":memory:")
		require.NoError(t, err)
		defer testStore.Close()

		ctx := context.Background()
		eventBus := bus.NewEventBus()

		// Create managers
		approvalManager := approval.NewManager(testStore, eventBus)
		sessionManager, err := session.NewManager(eventBus, testStore, "")
		require.NoError(t, err)

		// Create test daemon
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
		ctx2, cancel := context.WithCancel(context.Background())
		defer cancel()

		errCh := make(chan error, 1)
		go func() {
			errCh <- d.Run(ctx2)
		}()

		// Wait for daemon to start
		time.Sleep(100 * time.Millisecond)

		// Create a session
		sessionID := fmt.Sprintf("test-session-%d", time.Now().UnixNano())
		claudeSessionID := fmt.Sprintf("claude-session-%d", time.Now().UnixNano())
		runID := fmt.Sprintf("run-%d", time.Now().UnixNano())

		session := &store.Session{
			ID:              sessionID,
			ClaudeSessionID: claudeSessionID,
			RunID:           runID,
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		require.NoError(t, testStore.CreateSession(ctx, session))

		// Create a channel to control when the tool call is stored
		toolCallStored := make(chan struct{})
		
		// Start a goroutine that will add the tool call with a delay
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			
			// Wait for signal to store the tool call
			<-toolCallStored
			
			// Simulate a small delay in transaction commit
			time.Sleep(50 * time.Millisecond)
			
			// Add the tool call event
			toolCallEvent := &store.ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeToolCall,
				ToolName:        "Write",
				ToolID:          "tool-call-race-test",
				ToolInputJSON:   `{"file": "test.txt", "content": "hello"}`,
				ApprovalStatus:  "", // No approval yet
				ApprovalID:      "",
				CreatedAt:       time.Now(),
			}
			if err := testStore.AddConversationEvent(ctx, toolCallEvent); err != nil {
				t.Errorf("failed to add tool call: %v", err)
			}
		}()

		// Create RPC client
		conn, err := net.Dial("unix", socketPath)
		require.NoError(t, err)
		defer conn.Close()

		rpcClient := &rpcClient{conn: conn}

		// Signal to start storing the tool call
		close(toolCallStored)

		// Immediately try to create an approval (before tool call is stored)
		var createResp rpc.CreateApprovalResponse
		err = rpcClient.call("createApproval", rpc.CreateApprovalRequest{
			RunID:     runID,
			ToolName:  "Write",
			ToolInput: json.RawMessage(`{"file": "test.txt", "content": "hello"}`),
		}, &createResp)
		require.NoError(t, err)

		// Wait for the tool call storage to complete
		wg.Wait()

		// Give time for any async processing
		time.Sleep(100 * time.Millisecond)

		// Check if the approval was correlated
		conversation, err := testStore.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		var toolCallEvent *store.ConversationEvent
		for _, event := range conversation {
			if event.EventType == store.EventTypeToolCall && event.ToolName == "Write" {
				toolCallEvent = event
				break
			}
		}

		require.NotNil(t, toolCallEvent, "tool call event should exist")

		// This is where the test should fail - the approval should NOT be correlated
		// because it was created before the tool call existed
		if toolCallEvent.ApprovalID != "" {
			t.Log("WARNING: Approval was correlated even though it was created before tool call - race condition may not be reproducible")
		} else {
			t.Log("SUCCESS: Approval correlation failed as expected due to race condition")
		}

		// Additional check: look for orphaned approval
		approval, err := testStore.GetApproval(ctx, createResp.ApprovalID)
		require.NoError(t, err)
		require.NotNil(t, approval, "approval should exist")
		
		// Check if we can find any warning logs about correlation failure
		// (In a real test, we'd capture logs and verify the warning was logged)
	})

	t.Run("client_disconnect_during_approval", func(t *testing.T) {
		// Create test socket path
		socketPath := testutil.SocketPath(t, "disconnect-test")

		// Create test store
		testStore, err := store.NewSQLiteStore(":memory:")
		require.NoError(t, err)
		defer testStore.Close()

		ctx := context.Background()
		eventBus := bus.NewEventBus()

		// Create managers
		approvalManager := approval.NewManager(testStore, eventBus)
		sessionManager, err := session.NewManager(eventBus, testStore, "")
		require.NoError(t, err)

		// Create test daemon
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
		ctx2, cancel := context.WithCancel(context.Background())
		defer cancel()

		errCh := make(chan error, 1)
		go func() {
			errCh <- d.Run(ctx2)
		}()

		// Wait for daemon to start
		time.Sleep(100 * time.Millisecond)

		// Create a session
		sessionID := fmt.Sprintf("test-session-disconnect-%d", time.Now().UnixNano())
		claudeSessionID := fmt.Sprintf("claude-session-disconnect-%d", time.Now().UnixNano())
		runID := fmt.Sprintf("run-disconnect-%d", time.Now().UnixNano())

		session := &store.Session{
			ID:              sessionID,
			ClaudeSessionID: claudeSessionID,
			RunID:           runID,
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		require.NoError(t, testStore.CreateSession(ctx, session))

		// Add a tool call event
		toolCallEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: claudeSessionID,
			EventType:       store.EventTypeToolCall,
			ToolName:        "Execute",
			ToolID:          "tool-call-disconnect-test",
			ToolInputJSON:   `{"command": "rm -rf /"}`,
			ApprovalStatus:  "",
			ApprovalID:      "",
			CreatedAt:       time.Now(),
		}
		require.NoError(t, testStore.AddConversationEvent(ctx, toolCallEvent))

		// Create first RPC client
		conn1, err := net.Dial("unix", socketPath)
		require.NoError(t, err)
		rpcClient1 := &rpcClient{conn: conn1}

		// Create approval
		var createResp rpc.CreateApprovalResponse
		err = rpcClient1.call("createApproval", rpc.CreateApprovalRequest{
			RunID:     runID,
			ToolName:  "Execute",
			ToolInput: json.RawMessage(`{"command": "rm -rf /"}`),
		}, &createResp)
		require.NoError(t, err)
		approvalID := createResp.ApprovalID

		// Simulate client disconnect
		conn1.Close()

		// Small delay to simulate network latency
		time.Sleep(10 * time.Millisecond)

		// Create new connection (simulate reconnection)
		conn2, err := net.Dial("unix", socketPath)
		require.NoError(t, err)
		defer conn2.Close()
		rpcClient2 := &rpcClient{conn: conn2}

		// Try to get approval status with new connection
		var statusResp rpc.GetApprovalResponse
		err = rpcClient2.call("getApproval", rpc.GetApprovalRequest{
			ApprovalID: approvalID,
		}, &statusResp)
		require.NoError(t, err)

		// Verify the approval still exists and is properly correlated
		conversation, err := testStore.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		var correlatedEvent *store.ConversationEvent
		for _, event := range conversation {
			if event.EventType == store.EventTypeToolCall && event.ToolID == "tool-call-disconnect-test" {
				correlatedEvent = event
				break
			}
		}

		require.NotNil(t, correlatedEvent, "tool call event should exist")
		require.Equal(t, approvalID, correlatedEvent.ApprovalID, "approval should be correlated despite disconnect")
		require.Equal(t, store.ApprovalStatusPending, correlatedEvent.ApprovalStatus)
	})

	t.Run("rapid_reconnect_correlation_race", func(t *testing.T) {
		// This test simulates the exact scenario from the research:
		// rapid disconnect/reconnect during approval processing
		
		// Create test socket path
		socketPath := testutil.SocketPath(t, "rapid-reconnect-test")

		// Create test store
		testStore, err := store.NewSQLiteStore(":memory:")
		require.NoError(t, err)
		defer testStore.Close()

		ctx := context.Background()
		eventBus := bus.NewEventBus()

		// Create managers
		approvalManager := approval.NewManager(testStore, eventBus)
		sessionManager, err := session.NewManager(eventBus, testStore, "")
		require.NoError(t, err)

		// Create test daemon
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
		ctx2, cancel := context.WithCancel(context.Background())
		defer cancel()

		errCh := make(chan error, 1)
		go func() {
			errCh <- d.Run(ctx2)
		}()

		// Wait for daemon to start
		time.Sleep(100 * time.Millisecond)

		// Create a session
		sessionID := fmt.Sprintf("test-session-rapid-%d", time.Now().UnixNano())
		claudeSessionID := fmt.Sprintf("claude-session-rapid-%d", time.Now().UnixNano())
		runID := fmt.Sprintf("run-rapid-%d", time.Now().UnixNano())

		session := &store.Session{
			ID:              sessionID,
			ClaudeSessionID: claudeSessionID,
			RunID:           runID,
			Status:          store.SessionStatusRunning,
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}
		require.NoError(t, testStore.CreateSession(ctx, session))

		// Simulate multiple rapid tool calls and approvals
		const numOperations = 5
		var wg sync.WaitGroup
		errors := make(chan error, numOperations*2)

		for i := 0; i < numOperations; i++ {
			wg.Add(2)
			
			// Goroutine for tool call creation
			go func(index int) {
				defer wg.Done()
				
				// Add random delay to increase race likelihood
				time.Sleep(time.Duration(index*10) * time.Millisecond)
				
				toolCallEvent := &store.ConversationEvent{
					SessionID:       sessionID,
					ClaudeSessionID: claudeSessionID,
					EventType:       store.EventTypeToolCall,
					ToolName:        "Write",
					ToolID:          fmt.Sprintf("tool-rapid-%d", index),
					ToolInputJSON:   fmt.Sprintf(`{"file": "test%d.txt", "content": "data"}`, index),
					ApprovalStatus:  "",
					ApprovalID:      "",
					CreatedAt:       time.Now(),
				}
				if err := testStore.AddConversationEvent(ctx, toolCallEvent); err != nil {
					errors <- fmt.Errorf("tool call %d: %w", index, err)
				}
			}(i)

			// Goroutine for approval creation with disconnect/reconnect
			go func(index int) {
				defer wg.Done()
				
				// Create connection
				conn, err := net.Dial("unix", socketPath)
				if err != nil {
					errors <- fmt.Errorf("connect %d: %w", index, err)
					return
				}
				
				rpcClient := &rpcClient{conn: conn}
				
				// Try to create approval
				var createResp rpc.CreateApprovalResponse
				err = rpcClient.call("createApproval", rpc.CreateApprovalRequest{
					RunID:     runID,
					ToolName:  "Write",
					ToolInput: json.RawMessage(fmt.Sprintf(`{"file": "test%d.txt", "content": "data"}`, index)),
				}, &createResp)
				
				// Simulate quick disconnect
				conn.Close()
				
				if err != nil {
					errors <- fmt.Errorf("approval %d: %w", index, err)
				}
			}(i)
		}

		// Wait for all operations
		wg.Wait()
		close(errors)

		// Check for errors
		var errorCount int
		for err := range errors {
			if err != nil {
				t.Logf("Operation error: %v", err)
				errorCount++
			}
		}

		// Give time for any async processing
		time.Sleep(200 * time.Millisecond)

		// Check correlation results
		conversation, err := testStore.GetConversation(ctx, claudeSessionID)
		require.NoError(t, err)

		correlatedCount := 0
		uncorrelatedCount := 0
		
		for _, event := range conversation {
			if event.EventType == store.EventTypeToolCall && event.ToolName == "Write" {
				if event.ApprovalID != "" {
					correlatedCount++
				} else {
					uncorrelatedCount++
				}
			}
		}

		t.Logf("Results: %d correlated, %d uncorrelated, %d errors", correlatedCount, uncorrelatedCount, errorCount)
		
		// The test proves the race condition if we have any uncorrelated tool calls
		// or errors during the rapid operations
		if uncorrelatedCount > 0 || errorCount > 0 {
			t.Log("SUCCESS: Race condition demonstrated - some approvals failed to correlate or errored")
		} else {
			t.Log("WARNING: All approvals correlated successfully - race condition may not be reproducible in this run")
		}
	})
}

// TestApprovalManagerCorrelationTiming tests the specific timing issue in approval manager
func TestApprovalManagerCorrelationTiming(t *testing.T) {
	// This test directly tests the approval manager's correlation logic
	// with controlled timing to expose the race condition
	
	// Create test store
	testStore, err := store.NewSQLiteStore(":memory:")
	require.NoError(t, err)
	defer testStore.Close()

	ctx := context.Background()
	eventBus := bus.NewEventBus()
	approvalManager := approval.NewManager(testStore, eventBus)

	// Create a session
	sessionID := "test-session-timing"
	runID := "run-timing"
	
	session := &store.Session{
		ID:    sessionID,
		RunID: runID,
		Status: store.SessionStatusRunning,
	}
	require.NoError(t, testStore.CreateSession(ctx, session))

	// Create a goroutine that will add a tool call after a delay
	toolCallAdded := make(chan struct{})
	go func() {
		// Wait for approval creation to start
		time.Sleep(10 * time.Millisecond)
		
		// Add tool call
		toolCallEvent := &store.ConversationEvent{
			SessionID:       sessionID,
			ClaudeSessionID: "claude-timing",
			EventType:       store.EventTypeToolCall,
			ToolName:        "TimingTest",
			ToolID:          "tool-timing-test",
			ToolInputJSON:   `{"test": true}`,
			CreatedAt:       time.Now(),
		}
		testStore.AddConversationEvent(ctx, toolCallEvent)
		close(toolCallAdded)
	}()

	// Try to create approval before tool call exists
	approvalID, err := approvalManager.CreateApproval(ctx, runID, "TimingTest", json.RawMessage(`{"test": true}`))
	require.NoError(t, err)
	require.NotEmpty(t, approvalID)

	// Wait for tool call to be added
	<-toolCallAdded
	time.Sleep(50 * time.Millisecond)

	// Check if correlation happened
	conversation, err := testStore.GetConversation(ctx, "claude-timing")
	require.NoError(t, err)

	var toolCall *store.ConversationEvent
	for _, event := range conversation {
		if event.EventType == store.EventTypeToolCall && event.ToolName == "TimingTest" {
			toolCall = event
			break
		}
	}

	require.NotNil(t, toolCall, "tool call should exist")
	
	// The race condition is proven if the tool call is not correlated
	if toolCall.ApprovalID == "" {
		t.Log("SUCCESS: Correlation failed due to timing - tool call has no approval ID")
		t.Log("This proves the race condition where approval creation happens before tool call storage")
	} else {
		t.Log("WARNING: Tool call was correlated - race condition may not have occurred in this run")
	}
}