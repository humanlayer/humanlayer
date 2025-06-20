package session

import (
	"context"
	"fmt"
	"testing"
	"time"

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
	manager, err := NewManager(eventBus, mockStore)

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
	_, err := NewManager(eventBus, nil)

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
	manager, _ := NewManager(nil, mockStore)

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
	manager, _ := NewManager(nil, mockStore)

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
	manager, _ := NewManager(nil, mockStore)

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
	manager, _ := NewManager(nil, mockStore)

	testCases := []struct {
		name          string
		parentStatus  string
		expectedError string
	}{
		{
			name:          "running session",
			parentStatus:  store.SessionStatusRunning,
			expectedError: "cannot continue session with status running (must be completed)",
		},
		{
			name:          "failed session",
			parentStatus:  store.SessionStatusFailed,
			expectedError: "cannot continue session with status failed (must be completed)",
		},
		{
			name:          "starting session",
			parentStatus:  store.SessionStatusStarting,
			expectedError: "cannot continue session with status starting (must be completed)",
		},
		{
			name:          "waiting input session",
			parentStatus:  store.SessionStatusWaitingInput,
			expectedError: "cannot continue session with status waiting_input (must be completed)",
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
				t.Error("Expected error for non-completed parent session")
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
	manager, _ := NewManager(nil, mockStore)

	// Parent without claude_session_id
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "", // Empty
		Status:          store.SessionStatusCompleted,
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
		t.Error("Expected error for parent without claude_session_id")
	}
	if err.Error() != "parent session missing claude_session_id (cannot resume)" {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestContinueSession_CreatesNewSessionWithParentReference(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore)

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
	manager, _ := NewManager(nil, mockStore)

	// Mock parent session
	parentSession := &store.Session{
		ID:              "parent-1",
		RunID:           "run-1",
		ClaudeSessionID: "claude-1",
		Status:          store.SessionStatusCompleted,
		Query:           "original query",
		CreatedAt:       time.Now(),
	}
	mockStore.EXPECT().GetSession(gomock.Any(), "parent-1").Return(parentSession, nil)

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
	manager, _ := NewManager(nil, mockStore)

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
