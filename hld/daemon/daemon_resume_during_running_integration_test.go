package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestIntegrationResumeDuringRunning(t *testing.T) {
	// Use test-specific socket path
	socketPath := testutil.SocketPath(t, "resume-during-running")

	// Create daemon components
	eventBus := bus.NewEventBus()
	sqliteStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer func() { _ = sqliteStore.Close() }()

	sessionManager, err := session.NewManager(eventBus, sqliteStore, "")
	if err != nil {
		t.Fatalf("Failed to create session manager: %v", err)
	}

	// Create daemon
	d := &Daemon{
		socketPath: socketPath,
		config:     &config.Config{SocketPath: socketPath, DatabasePath: ":memory:"},
		eventBus:   eventBus,
		store:      sqliteStore,
		sessions:   sessionManager,
		rpcServer:  rpc.NewServer(),
	}

	// Register RPC handlers
	// Pass nil for approval manager since this test doesn't test approval functionality
	sessionHandlers := rpc.NewSessionHandlers(sessionManager, sqliteStore, nil)
	sessionHandlers.Register(d.rpcServer)

	// Start daemon
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := d.Run(ctx); err != nil {
			t.Logf("daemon run error: %v", err)
		}
	}()

	// Wait for daemon to be ready
	time.Sleep(200 * time.Millisecond)

	// Create helper function to send RPC requests
	sendRPC := func(t *testing.T, method string, params interface{}) (json.RawMessage, error) {
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("failed to connect to daemon: %v", err)
		}
		defer func() { _ = conn.Close() }()

		request := map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  method,
			"params":  params,
			"id":      1,
		}

		data, err := json.Marshal(request)
		if err != nil {
			t.Fatalf("failed to marshal request: %v", err)
		}

		if _, err := conn.Write(append(data, '\n')); err != nil {
			t.Fatalf("failed to write request: %v", err)
		}

		scanner := bufio.NewScanner(conn)
		if !scanner.Scan() {
			t.Fatal("no response received")
		}

		var response map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if errObj, ok := response["error"]; ok {
			if errMap, ok := errObj.(map[string]interface{}); ok {
				if msg, ok := errMap["message"].(string); ok {
					return nil, fmt.Errorf("%s", msg)
				}
			}
			return nil, fmt.Errorf("RPC error: %v", errObj)
		}

		if result, ok := response["result"]; ok {
			resultBytes, err := json.Marshal(result)
			if err != nil {
				t.Fatalf("failed to marshal result: %v", err)
			}
			return resultBytes, nil
		}

		return nil, fmt.Errorf("no result in response")
	}

	t.Run("ResumeRunningSession_WithMockRunningSession", func(t *testing.T) {
		// Create a parent session in the database that appears to be running
		// but doesn't have an actual Claude process (for testing purposes)
		parentSessionID := "parent-mock-running"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-mock-parent",
			ClaudeSessionID: "claude-mock-parent",
			Status:          store.SessionStatusRunning, // Mock running state
			Query:           "original mock query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		// Insert parent session directly into database
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create mock running parent session: %v", err)
		}

		// Try to continue the "running" session
		req := rpc.ContinueSessionRequest{
			SessionID: parentSessionID,
			Query:     "continue this running session",
		}

		// This should fail because there's no actual Claude process to interrupt
		_, err := sendRPC(t, "continueSession", req)
		if err == nil {
			t.Error("Expected error when trying to interrupt non-existent Claude process")
		}

		// Verify it's the expected error about invalid state
		// The new error handling returns "Invalid state transition" for invalid session states
		if !strings.Contains(err.Error(), "Invalid state transition") {
			t.Errorf("Expected 'Invalid state transition' error, got: %v", err)
		}
	})

	t.Run("ResumeCompletedSession_StillWorks", func(t *testing.T) {
		// Verify that the existing completed session resume functionality still works
		parentSessionID := "parent-completed"
		claudeSessionID := "claude-completed"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-completed",
			ClaudeSessionID: claudeSessionID,
			Status:          store.SessionStatusCompleted,
			Query:           "original completed query",
			Model:           "claude-3-opus",
			WorkingDir:      "/tmp", // Use /tmp as a valid working directory for tests
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		// Insert parent session
		if err := d.store.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create completed parent session: %v", err)
		}

		// Resume the completed session - this should work
		req := rpc.ContinueSessionRequest{
			SessionID: parentSessionID,
			Query:     "continue this completed session",
		}

		result, err := sendRPC(t, "continueSession", req)
		if err != nil {
			t.Fatalf("Failed to continue completed session: %v", err)
		}

		var continueResp rpc.ContinueSessionResponse
		if err := json.Unmarshal(result, &continueResp); err != nil {
			t.Fatalf("Failed to unmarshal continue response: %v", err)
		}

		// Verify response
		if continueResp.SessionID == "" {
			t.Error("Expected non-empty session ID")
		}
		if continueResp.RunID == "" {
			t.Error("Expected non-empty run ID")
		}
		if continueResp.ParentSessionID != parentSessionID {
			t.Errorf("Expected parent session ID %s, got %s", parentSessionID, continueResp.ParentSessionID)
		}

		t.Logf("Successfully resumed completed session: new session ID %s", continueResp.SessionID)
	})

	t.Run("ValidateStateTransitionLogic", func(t *testing.T) {
		// Test that our new state validation logic allows both completed and running
		// but still rejects other states

		testCases := []struct {
			name          string
			status        string
			shouldSucceed bool
			expectedError string
		}{
			{
				name:          "completed session",
				status:        store.SessionStatusCompleted,
				shouldSucceed: true,
			},
			{
				name:          "running session (no active process)",
				status:        store.SessionStatusRunning,
				shouldSucceed: false, // Fails due to no active process, not validation
				expectedError: "Invalid state transition",
			},
			{
				name:          "failed session",
				status:        store.SessionStatusFailed,
				shouldSucceed: false,
				expectedError: "Invalid state transition",
			},
			{
				name:          "starting session",
				status:        store.SessionStatusStarting,
				shouldSucceed: false,
				expectedError: "Invalid state transition",
			},
		}

		for i, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				sessionID := fmt.Sprintf("test-state-%d", i)
				testSession := &store.Session{
					ID:              sessionID,
					RunID:           fmt.Sprintf("run-%d", i),
					ClaudeSessionID: fmt.Sprintf("claude-%d", i),
					Status:          tc.status,
					Query:           fmt.Sprintf("test query %d", i),
					WorkingDir:      "/tmp",
					CreatedAt:       time.Now(),
					LastActivityAt:  time.Now(),
				}

				if tc.status == store.SessionStatusCompleted {
					now := time.Now()
					testSession.CompletedAt = &now
				}

				// Insert test session
				if err := d.store.CreateSession(ctx, testSession); err != nil {
					t.Fatalf("Failed to create test session: %v", err)
				}

				req := rpc.ContinueSessionRequest{
					SessionID: sessionID,
					Query:     "test continue",
				}

				_, err := sendRPC(t, "continueSession", req)

				if tc.shouldSucceed {
					if err != nil {
						t.Errorf("Expected success but got error: %v", err)
					}
				} else {
					if err == nil {
						t.Error("Expected error but got success")
					} else if tc.expectedError != "" && !strings.Contains(err.Error(), tc.expectedError) {
						t.Errorf("Expected error containing '%s', got: %v", tc.expectedError, err)
					}
				}
			})
		}
	})
}
