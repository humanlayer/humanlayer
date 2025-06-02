package session

import (
	"context"
	"fmt"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"go.uber.org/mock/gomock"
)

func TestNewManager(t *testing.T) {
	var eventBus bus.EventBus = nil // no bus for this test
	manager, err := NewManager(eventBus)

	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	if manager == nil {
		t.Fatal("Manager should not be nil")
	}

	if manager.sessions == nil {
		t.Fatal("Sessions map should be initialized")
	}
}

func TestSessionLifecycle(t *testing.T) {
	// Create a manager with empty sessions map
	manager := &Manager{
		sessions: make(map[string]*Session),
	}

	testCases := []struct {
		name  string
		setup func()
		test  func(t *testing.T)
	}{
		{
			name: "list empty sessions",
			setup: func() {
				// No setup needed
			},
			test: func(t *testing.T) {
				sessions := manager.ListSessions()
				if len(sessions) != 0 {
					t.Errorf("Expected 0 sessions, got %d", len(sessions))
				}

				infos := manager.ListSessionInfo()
				if len(infos) != 0 {
					t.Errorf("Expected 0 session infos, got %d", len(infos))
				}
			},
		},
		{
			name: "add and retrieve session",
			setup: func() {
				session := &Session{
					ID:        "test-session-1",
					RunID:     "test-run-1",
					Status:    StatusStarting,
					StartTime: time.Now(),
					Config: claudecode.SessionConfig{
						Prompt: "Test prompt",
					},
				}
				manager.sessions[session.ID] = session
			},
			test: func(t *testing.T) {
				retrieved, err := manager.GetSession("test-session-1")
				if err != nil {
					t.Fatalf("Failed to get session: %v", err)
				}

				if retrieved.ID != "test-session-1" {
					t.Errorf("Expected session ID 'test-session-1', got %s", retrieved.ID)
				}

				if retrieved.RunID != "test-run-1" {
					t.Errorf("Expected run ID 'test-run-1', got %s", retrieved.RunID)
				}
			},
		},
		{
			name: "get session info",
			setup: func() {
				// Session already added from previous test
			},
			test: func(t *testing.T) {
				info, err := manager.GetSessionInfo("test-session-1")
				if err != nil {
					t.Fatalf("Failed to get session info: %v", err)
				}

				if info.ID != "test-session-1" {
					t.Errorf("Expected session ID 'test-session-1', got %s", info.ID)
				}

				if info.RunID != "test-run-1" {
					t.Errorf("Expected run ID 'test-run-1', got %s", info.RunID)
				}

				if info.Prompt != "Test prompt" {
					t.Errorf("Expected prompt 'Test prompt', got %s", info.Prompt)
				}
			},
		},
		{
			name: "list multiple sessions",
			setup: func() {
				// Add more sessions
				for i := 2; i <= 3; i++ {
					session := &Session{
						ID:        fmt.Sprintf("test-session-%d", i),
						RunID:     fmt.Sprintf("test-run-%d", i),
						Status:    StatusRunning,
						StartTime: time.Now(),
						Config: claudecode.SessionConfig{
							Prompt: fmt.Sprintf("Test prompt %d", i),
						},
					}
					manager.sessions[session.ID] = session
				}
			},
			test: func(t *testing.T) {
				sessions := manager.ListSessions()
				if len(sessions) != 3 {
					t.Errorf("Expected 3 sessions, got %d", len(sessions))
				}

				infos := manager.ListSessionInfo()
				if len(infos) != 3 {
					t.Errorf("Expected 3 session infos, got %d", len(infos))
				}
			},
		},
		{
			name: "update session status to completed",
			setup: func() {
				// No additional setup needed
			},
			test: func(t *testing.T) {
				manager.updateSessionStatus("test-session-1", StatusCompleted, "")

				session, _ := manager.GetSession("test-session-1")
				if session.Status != StatusCompleted {
					t.Errorf("Expected status %s, got %s", StatusCompleted, session.Status)
				}

				if session.EndTime == nil {
					t.Error("EndTime should be set when status is completed")
				}
			},
		},
		{
			name: "update session status to failed with error",
			setup: func() {
				// No additional setup needed
			},
			test: func(t *testing.T) {
				manager.updateSessionStatus("test-session-2", StatusFailed, "test error")

				session, _ := manager.GetSession("test-session-2")
				if session.Status != StatusFailed {
					t.Errorf("Expected status %s, got %s", StatusFailed, session.Status)
				}

				if session.Error != "test error" {
					t.Errorf("Expected error 'test error', got %s", session.Error)
				}

				if session.EndTime == nil {
					t.Error("EndTime should be set when status is failed")
				}
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tc.setup()
			tc.test(t)
		})
	}
}

func TestGetNonExistentSession(t *testing.T) {
	testCases := []struct {
		name          string
		sessionID     string
		expectedError string
	}{
		{
			name:          "non-existent session",
			sessionID:     "non-existent",
			expectedError: "session not found: non-existent",
		},
		{
			name:          "empty session ID",
			sessionID:     "",
			expectedError: "session not found: ",
		},
		{
			name:          "special characters in ID",
			sessionID:     "session-with-@#$%",
			expectedError: "session not found: session-with-@#$%",
		},
	}

	manager := &Manager{
		sessions: make(map[string]*Session),
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := manager.GetSession(tc.sessionID)
			if err == nil {
				t.Error("Expected error for non-existent session")
			}

			if err.Error() != tc.expectedError {
				t.Errorf("Expected error '%s', got '%s'", tc.expectedError, err.Error())
			}

			_, err = manager.GetSessionInfo(tc.sessionID)
			if err == nil {
				t.Error("Expected error for non-existent session info")
			}

			if err.Error() != tc.expectedError {
				t.Errorf("Expected error '%s', got '%s'", tc.expectedError, err.Error())
			}
		})
	}
}

func TestConcurrentSessionAccess(t *testing.T) {
	manager := &Manager{
		sessions: make(map[string]*Session),
	}

	// Pre-populate sessions
	for i := 0; i < 10; i++ {
		session := &Session{
			ID:        fmt.Sprintf("session-%d", i),
			RunID:     fmt.Sprintf("run-%d", i),
			Status:    StatusRunning,
			StartTime: time.Now(),
			Config: claudecode.SessionConfig{
				Prompt: fmt.Sprintf("Test prompt %d", i),
			},
		}
		manager.sessions[session.ID] = session
	}

	concurrentOps := []struct {
		name string
		op   func()
	}{
		{
			name: "status updates",
			op: func() {
				for i := 0; i < 10; i++ {
					for j := 0; j < 10; j++ {
						sessionID := fmt.Sprintf("session-%d", j)
						if i%2 == 0 {
							manager.updateSessionStatus(sessionID, StatusCompleted, "")
						} else {
							manager.updateSessionStatus(sessionID, StatusFailed, "test error")
						}
					}
				}
			},
		},
		{
			name: "read operations",
			op: func() {
				for i := 0; i < 100; i++ {
					_ = manager.ListSessions()
					_ = manager.ListSessionInfo()

					for j := 0; j < 10; j++ {
						sessionID := fmt.Sprintf("session-%d", j)
						_, _ = manager.GetSession(sessionID)
						_, _ = manager.GetSessionInfo(sessionID)
					}
				}
			},
		},
		{
			name: "mixed operations",
			op: func() {
				for i := 0; i < 50; i++ {
					if i%2 == 0 {
						_ = manager.ListSessions()
					} else {
						sessionID := fmt.Sprintf("session-%d", i%10)
						manager.updateSessionStatus(sessionID, StatusRunning, "")
					}
				}
			},
		},
	}

	// Run operations concurrently
	done := make(chan bool, len(concurrentOps))

	for _, op := range concurrentOps {
		go func(operation func()) {
			operation()
			done <- true
		}(op.op)
	}

	// Wait for all operations to complete
	for i := 0; i < len(concurrentOps); i++ {
		<-done
	}

	// Verify final state
	sessions := manager.ListSessions()
	if len(sessions) != 10 {
		t.Errorf("Expected 10 sessions, got %d", len(sessions))
	}
}

func TestSessionManagerInterface_WithMock(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	testCases := []struct {
		name  string
		setup func(mock *MockSessionManager)
		test  func(t *testing.T, mock SessionManager)
	}{
		{
			name: "launch session successfully",
			setup: func(mock *MockSessionManager) {
				expectedSession := &Session{
					ID:        "test-session-123",
					RunID:     "test-run-456",
					Status:    StatusRunning,
					StartTime: time.Now(),
					Config: claudecode.SessionConfig{
						Prompt: "Test prompt",
					},
				}
				mock.EXPECT().LaunchSession(gomock.Any(), gomock.Any()).Return(expectedSession, nil)
			},
			test: func(t *testing.T, mock SessionManager) {
				session, err := mock.LaunchSession(context.Background(), claudecode.SessionConfig{
					Prompt: "Test prompt",
				})

				if err != nil {
					t.Fatalf("Expected no error, got %v", err)
				}

				if session.ID != "test-session-123" {
					t.Errorf("Expected session ID 'test-session-123', got %s", session.ID)
				}
			},
		},
		{
			name: "launch session with error",
			setup: func(mock *MockSessionManager) {
				mock.EXPECT().LaunchSession(gomock.Any(), gomock.Any()).Return(nil, fmt.Errorf("launch failed"))
			},
			test: func(t *testing.T, mock SessionManager) {
				session, err := mock.LaunchSession(context.Background(), claudecode.SessionConfig{
					Prompt: "Test prompt",
				})

				if err == nil {
					t.Fatal("Expected error, got nil")
				}

				if session != nil {
					t.Fatal("Expected nil session on error")
				}
			},
		},
		{
			name: "get existing session",
			setup: func(mock *MockSessionManager) {
				expectedSession := &Session{
					ID:     "test-session-789",
					Status: StatusCompleted,
				}
				mock.EXPECT().GetSession("test-session-789").Return(expectedSession, nil)
			},
			test: func(t *testing.T, mock SessionManager) {
				session, err := mock.GetSession("test-session-789")

				if err != nil {
					t.Fatalf("Expected no error, got %v", err)
				}

				if session.ID != "test-session-789" {
					t.Errorf("Expected session ID 'test-session-789', got %s", session.ID)
				}

				if session.Status != StatusCompleted {
					t.Errorf("Expected status %s, got %s", StatusCompleted, session.Status)
				}
			},
		},
		{
			name: "list sessions with multiple results",
			setup: func(mock *MockSessionManager) {
				sessions := []*Session{
					{ID: "session-1", Status: StatusRunning},
					{ID: "session-2", Status: StatusCompleted},
					{ID: "session-3", Status: StatusFailed},
				}
				mock.EXPECT().ListSessions().Return(sessions)
			},
			test: func(t *testing.T, mock SessionManager) {
				sessions := mock.ListSessions()

				if len(sessions) != 3 {
					t.Fatalf("Expected 3 sessions, got %d", len(sessions))
				}

				expectedIDs := map[string]bool{
					"session-1": true,
					"session-2": true,
					"session-3": true,
				}

				for _, session := range sessions {
					if !expectedIDs[session.ID] {
						t.Errorf("Unexpected session ID: %s", session.ID)
					}
				}
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mock := NewMockSessionManager(ctrl)
			tc.setup(mock)
			tc.test(t, mock)
		})
	}
}
