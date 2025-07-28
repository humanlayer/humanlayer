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
	config := claudecode.SessionConfig{
		Query: "test query",
		MCPConfig: &claudecode.MCPConfig{
			MCPServers: map[string]claudecode.MCPServer{
				"test-server": {
					Command: "test-cmd",
					Args:    []string{"arg1", "arg2"},
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
	session, err := manager.ContinueSession(context.Background(), req)

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

	session, err := manager.ContinueSession(context.Background(), req)

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
