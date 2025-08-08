package session

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"go.uber.org/mock/gomock"
)

func TestNewManager(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Create mock store
	mockStore := store.NewMockConversationStore(ctrl)

	var eventBus bus.EventBus = nil // no bus for this test
	manager, err := NewManager(eventBus, mockStore, "")

	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	if manager == nil {
		t.Fatal("Manager should not be nil")
	}

	// Manager is successfully created with store
}

func TestNewManager_RequiresStore(t *testing.T) {
	var eventBus bus.EventBus = nil
	_, err := NewManager(eventBus, nil, "")

	if err == nil {
		t.Fatal("Expected error when store is nil")
	}

	if err.Error() != "store is required" {
		t.Errorf("Expected 'store is required' error, got: %v", err)
	}
}

func TestListSessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Test empty list
	mockStore.EXPECT().ListSessions(gomock.Any()).Return([]*store.Session{}, nil)

	sessions := manager.ListSessions()
	if len(sessions) != 0 {
		t.Errorf("Expected 0 sessions, got %d", len(sessions))
	}

	// Test with sessions
	dbSessions := []*store.Session{
		{
			ID:        "test-1",
			RunID:     "run-1",
			Status:    "running",
			Query:     "test query",
			CreatedAt: time.Now(),
		},
	}
	mockStore.EXPECT().ListSessions(gomock.Any()).Return(dbSessions, nil)

	sessions = manager.ListSessions()
	if len(sessions) != 1 {
		t.Errorf("Expected 1 session, got %d", len(sessions))
	}
}

func TestGetSessionInfo(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Test not found
	mockStore.EXPECT().GetSession(gomock.Any(), "not-found").Return(nil, fmt.Errorf("not found"))

	_, err := manager.GetSessionInfo("not-found")
	if err == nil {
		t.Error("Expected error for non-existent session")
	}

	// Test found
	dbSession := &store.Session{
		ID:        "test-1",
		RunID:     "run-1",
		Status:    "running",
		Query:     "test query",
		CreatedAt: time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "test-1").Return(dbSession, nil)

	info, err := manager.GetSessionInfo("test-1")
	if err != nil {
		t.Fatalf("Failed to get session info: %v", err)
	}
	if info.ID != "test-1" {
		t.Errorf("Expected ID test-1, got %s", info.ID)
	}
}

// Note: Most of the old tests were removed because they tested internal implementation
// details (in-memory maps) that no longer exist. The real functionality is now
// tested by the integration tests which use actual SQLite database.

func TestContinueSession_ValidatesParentExists(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Test parent not found
	mockStore.EXPECT().GetSession(gomock.Any(), "not-found").Return(nil, fmt.Errorf("session not found"))

	req := ContinueSessionConfig{
		ParentSessionID: "not-found",
		Query:           "continue this",
	}
	_, err := manager.ContinueSession(context.Background(), req)
	if err == nil {
		t.Error("Expected error for non-existent parent session")
	}
	if err.Error() != "failed to get parent session: session not found" {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestContinueSession_ValidatesParentStatus(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	testCases := []struct {
		name          string
		parentStatus  string
		expectedError string
	}{
		{
			name:          "failed session",
			parentStatus:  store.SessionStatusFailed,
			expectedError: "cannot continue session with status failed (must be completed, interrupted, or running)",
		},
		{
			name:          "starting session",
			parentStatus:  store.SessionStatusStarting,
			expectedError: "cannot continue session with status starting (must be completed, interrupted, or running)",
		},
		{
			name:          "waiting input session",
			parentStatus:  store.SessionStatusWaitingInput,
			expectedError: "cannot continue session with status waiting_input (must be completed, interrupted, or running)",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			parentSession := &store.Session{
				ID:              "parent-1",
				RunID:           "run-1",
				ClaudeSessionID: "claude-1",
				Status:          tc.parentStatus,
				Query:           "original query",
				CreatedAt:       time.Now(),
			}
			mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

			req := ContinueSessionConfig{
				ParentSessionID: "parent-1",
				Query:           "continue this",
			}
			_, err := manager.ContinueSession(context.Background(), req)
			if err == nil {
				t.Error("Expected error for invalid parent session status")
			}
			if err.Error() != tc.expectedError {
				t.Errorf("Expected error '%s', got: %v", tc.expectedError, err)
			}
		})
	}
}

func TestContinueSession_ValidatesClaudeSessionID(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Parent without claude_session_id
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "", // Empty
		Status:          store.SessionStatusCompleted,
		Query:           "original query",
		WorkingDir:      "/tmp",
		CreatedAt:       time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

	req := ContinueSessionConfig{
		ParentSessionID: "parent-1",
		Query:           "continue this",
	}
	_, err := manager.ContinueSession(context.Background(), req)
	if err == nil {
		t.Error("Expected error for parent without claude_session_id")
	}
	if err.Error() != "parent session missing claude_session_id (cannot resume)" {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestLaunchSession_SetsMCPEnvironment(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	testSocketPath := "/test/daemon.sock"
	manager, _ := NewManager(nil, mockStore, testSocketPath)

	// Store the session config that gets passed to CreateSession
	mockStore.EXPECT().CreateSession(gomock.Any(), gomock.Any()).Return(nil)

	// Store the MCP servers that get passed to StoreMCPServers
	var capturedMCPServers []store.MCPServer
	mockStore.EXPECT().StoreMCPServers(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx context.Context, sessionID string, servers []store.MCPServer) error {
			capturedMCPServers = servers
			return nil
		})

	// Update session to running
	mockStore.EXPECT().UpdateSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	// Launch session with MCP config
	config := LaunchSessionConfig{
		SessionConfig: claudecode.SessionConfig{
			Query: "test query",
			MCPConfig: &claudecode.MCPConfig{
				MCPServers: map[string]claudecode.MCPServer{
					"test-server": {
						Command: "test-cmd",
						Args:    []string{"arg1", "arg2"},
					},
				},
			},
		},
	}

	_, err := manager.LaunchSession(context.Background(), config)
	if err != nil {
		t.Fatalf("Failed to launch session: %v", err)
	}

	// Verify MCP servers have the correct environment variables
	if len(capturedMCPServers) != 1 {
		t.Fatalf("Expected 1 MCP server, got %d", len(capturedMCPServers))
	}

	server := capturedMCPServers[0]

	// Parse the environment JSON
	var env map[string]string
	if err := json.Unmarshal([]byte(server.EnvJSON), &env); err != nil {
		t.Fatalf("Failed to unmarshal env JSON: %v", err)
	}

	// Check HUMANLAYER_RUN_ID is set
	if env["HUMANLAYER_RUN_ID"] == "" {
		t.Error("HUMANLAYER_RUN_ID not set in MCP server environment")
	}

	// Check HUMANLAYER_DAEMON_SOCKET is set to our test socket path
	if env["HUMANLAYER_DAEMON_SOCKET"] != testSocketPath {
		t.Errorf("Expected HUMANLAYER_DAEMON_SOCKET to be %s, got %s", testSocketPath, env["HUMANLAYER_DAEMON_SOCKET"])
	}
}

func TestContinueSession_ValidatesWorkingDirectory(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Parent without working directory
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "claude-1",
		Status:          store.SessionStatusCompleted,
		Query:           "original query",
		WorkingDir:      "", // Empty
		CreatedAt:       time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

	req := ContinueSessionConfig{
		ParentSessionID: "parent-1",
		Query:           "continue this",
	}
	_, err := manager.ContinueSession(context.Background(), req)
	if err == nil {
		t.Error("Expected error for parent without working_dir")
	}
	if err.Error() != "parent session missing working_dir (cannot resume session without working directory)" {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestContinueSession_CreatesNewSessionWithParentReference(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Create a context that gets cancelled when test finishes
	ctx, cancel := context.WithCancel(context.Background())
	defer func() {
		cancel()
		// Give goroutines a moment to clean up
		time.Sleep(50 * time.Millisecond)
	}()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Mock parent session
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "claude-1",
		Status:          store.SessionStatusCompleted,
		Query:           "original query",
		Model:           "claude-3-opus",
		WorkingDir:      "/test/dir",
		CreatedAt:       time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

	// Expect GetMCPServers call (even if it returns empty)
	mockStore.EXPECT().GetMCPServers(gomock.Any(), "parent-1").Return([]store.MCPServer{}, nil)

	// Expect session creation with parent reference
	mockStore.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx interface{}, session *store.Session) error {
			// Validate the created session
			if session.ParentSessionID != "parent-1" {
				t.Errorf("Expected parent_session_id to be 'parent-1', got '%s'", session.ParentSessionID)
			}
			if session.Query != "continue this" {
				t.Errorf("Expected query 'continue this', got '%s'", session.Query)
			}
			if session.Status != store.SessionStatusStarting {
				t.Errorf("Expected status 'starting', got '%s'", session.Status)
			}
			// Should not inherit claude_session_id (will be set from streaming events)
			if session.ClaudeSessionID != "" {
				t.Errorf("Expected empty claude_session_id, got '%s'", session.ClaudeSessionID)
			}
			return nil
		})

	// Expect MCP servers to be stored (may or may not be called)
	mockStore.EXPECT().StoreMCPServers(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	// Expect status update to running (we can't test the full flow without mocking Claude client)
	// May be called twice if Claude fails to launch in background
	mockStore.EXPECT().UpdateSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	req := ContinueSessionConfig{
		ParentSessionID: "parent-1",
		Query:           "continue this",
	}

	// Try to continue session - this tests our logic, not Claude launch
	session, err := manager.ContinueSession(ctx, req)

	// If Claude binary exists, it might succeed; if not, it will fail
	// Either way, our mock expectations should have been met (session created with parent)
	if err != nil {
		// Expected - Claude binary might not exist in test environment
		if !containsError(err, "failed to launch resumed Claude session") {
			t.Errorf("Unexpected error: %v", err)
		}
	} else {
		// Claude launched successfully - verify session has expected properties
		if session.ID == "" {
			t.Error("Expected session ID to be set")
		}
		if session.RunID == "" {
			t.Error("Expected run ID to be set")
		}
	}
}

func TestContinueSession_HandlesOptionalOverrides(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Create a context that gets cancelled when test finishes
	ctx, cancel := context.WithCancel(context.Background())
	defer func() {
		cancel()
		// Give goroutines a moment to clean up
		time.Sleep(50 * time.Millisecond)
	}()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Mock parent session
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "claude-1",
		Status:          store.SessionStatusCompleted,
		Query:           "original query",
		WorkingDir:      "/tmp",
		CreatedAt:       time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

	// Expect GetMCPServers call (even if it returns empty)
	mockStore.EXPECT().GetMCPServers(gomock.Any(), "parent-1").Return([]store.MCPServer{}, nil)

	// Test with various overrides
	req := ContinueSessionConfig{
		ParentSessionID:      "parent-1",
		Query:                "continue with overrides",
		SystemPrompt:         "You are a pirate",
		AppendSystemPrompt:   "Always say arr",
		PermissionPromptTool: "mcp__custom__tool",
		AllowedTools:         []string{"tool1", "tool2"},
		DisallowedTools:      []string{"dangerous_tool"},
		CustomInstructions:   "Be helpful",
		MaxTurns:             5,
	}

	// Expect session creation
	mockStore.EXPECT().CreateSession(gomock.Any(), gomock.Any()).DoAndReturn(
		func(ctx interface{}, session *store.Session) error {
			// Validate overrides are stored
			if session.SystemPrompt != "You are a pirate" {
				t.Errorf("Expected system prompt override, got '%s'", session.SystemPrompt)
			}
			if session.CustomInstructions != "Be helpful" {
				t.Errorf("Expected custom instructions override, got '%s'", session.CustomInstructions)
			}
			if session.MaxTurns != 5 {
				t.Errorf("Expected max turns 5, got %d", session.MaxTurns)
			}
			return nil
		})

	// Expect MCP servers to be stored (if MCPConfig override is provided)
	mockStore.EXPECT().StoreMCPServers(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	// Expect status update
	// May be called twice if Claude fails to launch in background
	mockStore.EXPECT().UpdateSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	session, err := manager.ContinueSession(ctx, req)

	// Test passes if our mock expectations were met (session created with overrides)
	// Whether Claude actually launches depends on the environment
	if err != nil {
		// Expected - Claude binary might not exist
		if !containsError(err, "failed to launch resumed Claude session") {
			t.Errorf("Unexpected error: %v", err)
		}
	} else {
		// Claude launched - verify session properties
		if session.ID == "" {
			t.Error("Expected session ID to be set")
		}
		if session.RunID == "" {
			t.Error("Expected run ID to be set")
		}
	}
}

// Helper function to check if error contains a substring
func containsError(err error, substr string) bool {
	if err == nil {
		return false
	}
	return contains(err.Error(), substr)
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestInterruptSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Test interrupting non-existent session
	err := manager.InterruptSession(context.Background(), "not-found")
	if err == nil {
		t.Error("Expected error for non-existent session")
	}
	if err.Error() != "session not found or not active" {
		t.Errorf("Expected 'session not found or not active' error, got: %v", err)
	}

	// Test interrupting session - just test the session lookup logic
	sessionID := "test-interrupt"

	// Test that non-existent session returns appropriate error
	err = manager.InterruptSession(context.Background(), sessionID)
	if err == nil {
		t.Error("Expected error for non-existent session")
	}
	if err.Error() != "session not found or not active" {
		t.Errorf("Expected 'session not found or not active' error, got: %v", err)
	}
}

func TestContinueSession_InterruptsRunningSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	t.Run("running session without claude_session_id", func(t *testing.T) {
		// Create a running parent session without claude_session_id (orphaned state)
		runningParentSession := &store.Session{
			ID:              "parent-orphaned",
			RunID:           "run-orphaned",
			ClaudeSessionID: "", // Missing - can't be resumed
			Status:          store.SessionStatusRunning,
			Query:           "original query",
			CreatedAt:       time.Now(),
		}

		mockStore.EXPECT().GetSession(gomock.Any(), "parent-orphaned").Return(runningParentSession, nil)

		req := ContinueSessionConfig{
			ParentSessionID: "parent-orphaned",
			Query:           "continue orphaned session",
		}

		_, err := manager.ContinueSession(context.Background(), req)

		// Should fail with claude_session_id validation error, not interrupt error
		if err == nil {
			t.Error("Expected error for orphaned running session")
		}
		if err.Error() != "parent session missing claude_session_id (cannot resume)" {
			t.Errorf("Expected claude_session_id validation error, got: %v", err)
		}
	})

	t.Run("running session with claude_session_id but no active process", func(t *testing.T) {
		// Create a running parent session with claude_session_id but no active process
		runningParentSession := &store.Session{
			ID:              "parent-running",
			RunID:           "run-parent",
			ClaudeSessionID: "claude-parent", // Has session ID
			Status:          store.SessionStatusRunning,
			Query:           "original query",
			WorkingDir:      "/tmp",
			CreatedAt:       time.Now(),
		}

		mockStore.EXPECT().GetSession(gomock.Any(), "parent-running").Return(runningParentSession, nil)

		req := ContinueSessionConfig{
			ParentSessionID: "parent-running",
			Query:           "continue running session",
		}

		_, err := manager.ContinueSession(context.Background(), req)

		// Should fail when trying to interrupt because no active process exists
		if err == nil {
			t.Error("Expected error trying to interrupt non-existent Claude process")
		}
		if err.Error() != "failed to interrupt running session: session not found or not active" {
			t.Errorf("Expected interrupt error, got: %v", err)
		}
	})
}

func TestStopAllSessions_NoActiveSessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Test with no active sessions
	err := manager.StopAllSessions(5 * time.Second)
	if err != nil {
		t.Errorf("Expected no error when no active sessions, got: %v", err)
	}
}

func TestStopAllSessions_FiltersSessionsByStatus(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create mock Claude sessions
	mockClaudeSession1 := NewMockClaudeSession(ctrl)
	mockClaudeSession2 := NewMockClaudeSession(ctrl)
	mockClaudeSession3 := NewMockClaudeSession(ctrl)

	// Set up expectations for the running session (should be interrupted)
	mockClaudeSession1.EXPECT().Interrupt().Return(nil).Times(1)

	// Set up expectations for the waiting session (should be interrupted)
	mockClaudeSession3.EXPECT().Interrupt().Return(nil).Times(1)

	// Add Kill() expectations for sessions that might timeout
	mockClaudeSession2.EXPECT().Kill().Return(nil).MaxTimes(1) // Completed session might be force killed

	// Manually populate activeProcesses for testing
	manager.activeProcesses["session-running"] = mockClaudeSession1
	manager.activeProcesses["session-completed"] = mockClaudeSession2
	manager.activeProcesses["session-waiting"] = mockClaudeSession3

	// Mock GetSessionInfo calls
	mockStore.EXPECT().GetSession(gomock.Any(), "session-running").Return(&store.Session{
		ID:     "session-running",
		Status: store.SessionStatusRunning,
	}, nil)
	mockStore.EXPECT().GetSession(gomock.Any(), "session-completed").Return(&store.Session{
		ID:     "session-completed",
		Status: store.SessionStatusCompleted,
	}, nil)
	mockStore.EXPECT().GetSession(gomock.Any(), "session-waiting").Return(&store.Session{
		ID:     "session-waiting",
		Status: store.SessionStatusWaitingInput,
	}, nil)

	// Expect update calls only for running and waiting sessions
	mockStore.EXPECT().UpdateSession(gomock.Any(), "session-running", gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate session cleanup after interrupt
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})
	mockStore.EXPECT().UpdateSession(gomock.Any(), "session-waiting", gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate session cleanup after interrupt
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})

	// The function should only try to interrupt running and waiting sessions
	err := manager.StopAllSessions(500 * time.Millisecond)

	// Should timeout because completed session remains in activeProcesses
	if err != context.DeadlineExceeded {
		t.Errorf("Expected timeout error, got: %v", err)
	}
}

func TestStopAllSessions_HandlesInterruptErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create a session that will fail to get info
	mockClaudeSession := NewMockClaudeSession(ctrl)
	mockClaudeSession.EXPECT().Interrupt().Return(nil).Times(1)
	manager.activeProcesses["session-error"] = mockClaudeSession

	// Mock GetSessionInfo to return error
	mockStore.EXPECT().GetSession(gomock.Any(), "session-error").Return(nil, fmt.Errorf("database error"))

	// Mock UpdateSession for interrupt
	mockStore.EXPECT().UpdateSession(gomock.Any(), "session-error", gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate session cleanup after interrupt
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})

	// The session should still be attempted to be interrupted despite GetSessionInfo error
	err := manager.StopAllSessions(500 * time.Millisecond)

	// Should succeed since we simulate cleanup
	if err != nil {
		t.Errorf("Expected success, got error: %v", err)
	}
}

func TestStopAllSessions_SuccessfulShutdown(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// No active sessions means immediate success
	err := manager.StopAllSessions(5 * time.Second)
	if err != nil {
		t.Errorf("Expected successful shutdown with no sessions, got: %v", err)
	}
}

func TestStopAllSessions_TimeoutBehavior(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Add a mock session that won't be removed
	mockClaudeSession := NewMockClaudeSession(ctrl)
	// Set up expectations for forced kill since it won't stop gracefully
	mockClaudeSession.EXPECT().Interrupt().Return(nil).Times(1)
	mockClaudeSession.EXPECT().Kill().Return(nil).Times(1)
	manager.activeProcesses["stuck-session"] = mockClaudeSession

	// Mock GetSessionInfo
	mockStore.EXPECT().GetSession(gomock.Any(), "stuck-session").Return(&store.Session{
		ID:     "stuck-session",
		Status: store.SessionStatusRunning,
	}, nil)

	// Mock UpdateSession for interrupt
	mockStore.EXPECT().UpdateSession(gomock.Any(), "stuck-session", gomock.Any()).Return(nil)

	// Test with very short timeout
	start := time.Now()
	err := manager.StopAllSessions(200 * time.Millisecond)
	elapsed := time.Since(start)

	// Should timeout
	if err != context.DeadlineExceeded {
		t.Errorf("Expected context.DeadlineExceeded, got: %v", err)
	}

	// Should respect timeout duration
	if elapsed < 200*time.Millisecond || elapsed > 400*time.Millisecond {
		t.Errorf("Expected timeout around 200ms, got: %v", elapsed)
	}
}

// TestStopAllSessions_RaceConditions tests for race conditions using the -race detector
func TestStopAllSessions_RaceConditions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Add multiple sessions
	for i := 0; i < 10; i++ {
		sessionID := fmt.Sprintf("session-%d", i)
		mockSession := NewMockClaudeSession(ctrl)
		mockSession.EXPECT().Interrupt().Return(nil).Times(1)
		mockSession.EXPECT().Kill().Return(nil).MaxTimes(1) // Might be force killed if timeout
		manager.activeProcesses[sessionID] = mockSession

		// Mock GetSessionInfo for each session
		mockStore.EXPECT().GetSession(gomock.Any(), sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: store.SessionStatusRunning,
		}, nil).AnyTimes()

		// Mock UpdateSession for each session
		mockStore.EXPECT().UpdateSession(gomock.Any(), sessionID, gomock.Any()).DoAndReturn(
			func(ctx context.Context, id string, update store.SessionUpdate) error {
				// Simulate session cleanup after interrupt
				go func() {
					time.Sleep(50 * time.Millisecond)
					manager.mu.Lock()
					delete(manager.activeProcesses, id)
					manager.mu.Unlock()
				}()
				return nil
			}).AnyTimes()
	}

	// Also prepare mocks for new sessions that might be added during the test
	for i := 0; i < 5; i++ {
		newSessionID := fmt.Sprintf("new-session-%d", i)
		mockStore.EXPECT().GetSession(gomock.Any(), newSessionID).Return(&store.Session{
			ID:     newSessionID,
			Status: store.SessionStatusRunning,
		}, nil).AnyTimes()
		mockStore.EXPECT().UpdateSession(gomock.Any(), newSessionID, gomock.Any()).Return(nil).AnyTimes()
	}

	// Start multiple goroutines to simulate concurrent operations
	done := make(chan bool)

	// Goroutine 1: Call StopAllSessions
	go func() {
		_ = manager.StopAllSessions(100 * time.Millisecond)
		done <- true
	}()

	// Goroutine 2: Concurrently add/remove sessions
	go func() {
		for i := 0; i < 5; i++ {
			manager.mu.Lock()
			newSessionID := fmt.Sprintf("new-session-%d", i)
			mockNewSession := NewMockClaudeSession(ctrl)
			mockNewSession.EXPECT().Interrupt().Return(nil).MaxTimes(1)
			mockNewSession.EXPECT().Kill().Return(nil).MaxTimes(1) // Might be force killed
			manager.activeProcesses[newSessionID] = mockNewSession
			manager.mu.Unlock()

			time.Sleep(10 * time.Millisecond)

			manager.mu.Lock()
			delete(manager.activeProcesses, fmt.Sprintf("session-%d", i))
			manager.mu.Unlock()
		}
		done <- true
	}()

	// Goroutine 3: Concurrently read active sessions
	go func() {
		for i := 0; i < 10; i++ {
			manager.mu.RLock()
			_ = len(manager.activeProcesses)
			manager.mu.RUnlock()
			time.Sleep(5 * time.Millisecond)
		}
		done <- true
	}()

	// Wait for all goroutines to complete
	for i := 0; i < 3; i++ {
		select {
		case <-done:
			// Good
		case <-time.After(2 * time.Second):
			t.Error("Test timed out waiting for goroutines")
		}
	}
}

// TestStopAllSessions_ForceKillBehavior tests the force kill functionality
func TestStopAllSessions_ForceKillBehavior(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Track interrupt calls on mock Claude session
	mockClaudeSession := NewMockClaudeSession(ctrl)
	// Session should be interrupted multiple times as we retry
	mockClaudeSession.EXPECT().Interrupt().Return(nil).MinTimes(1)
	// Eventually it should be force killed
	mockClaudeSession.EXPECT().Kill().Return(nil).Times(1)

	manager.activeProcesses["stubborn-session"] = mockClaudeSession

	// Mock GetSessionInfo
	mockStore.EXPECT().GetSession(gomock.Any(), "stubborn-session").Return(&store.Session{
		ID:     "stubborn-session",
		Status: store.SessionStatusRunning,
	}, nil)

	// Mock UpdateSession for interrupt
	mockStore.EXPECT().UpdateSession(gomock.Any(), "stubborn-session", gomock.Any()).Return(nil)

	// Call with short timeout to trigger force kill
	err := manager.StopAllSessions(50 * time.Millisecond)

	// Should timeout and attempt force kill
	if err != context.DeadlineExceeded {
		t.Errorf("Expected timeout error, got: %v", err)
	}

}
