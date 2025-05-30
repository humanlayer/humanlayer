package session

import (
	"fmt"
	"os/exec"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
)

// MockClaudeClient is a mock implementation of the Claude client for testing
type MockClaudeClient struct {
	LaunchFunc func(config claudecode.SessionConfig) (*claudecode.Session, error)
	shouldFail bool
}

func (m *MockClaudeClient) Launch(config claudecode.SessionConfig) (*claudecode.Session, error) {
	if m.LaunchFunc != nil {
		return m.LaunchFunc(config)
	}
	
	if m.shouldFail {
		return nil, exec.ErrNotFound
	}
	
	// Create a mock session
	session := &claudecode.Session{
		ID:        "mock-claude-session-id",
		Config:    config,
		StartTime: time.Now(),
		Events:    make(chan claudecode.StreamEvent, 1),
	}
	
	// Send a session ID event
	session.Events <- claudecode.StreamEvent{
		Type:      "session",
		SessionID: "mock-claude-session-id",
	}
	close(session.Events)
	
	return session, nil
}

func TestNewManager(t *testing.T) {
	// This test requires the claude binary to be in PATH
	// In a real test environment, we'd mock this
	manager, err := NewManager()
	if err != nil {
		// If claude binary is not available, skip the test
		if exec.ErrNotFound == err {
			t.Skip("Claude binary not found in PATH")
		}
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
	// Create a manager with mock client for testing
	manager := &Manager{
		sessions: make(map[string]*Session),
		client:   nil, // Would need to refactor to support dependency injection
	}
	
	// Test listing empty sessions
	sessions := manager.ListSessions()
	if len(sessions) != 0 {
		t.Errorf("Expected 0 sessions, got %d", len(sessions))
	}
	
	infos := manager.ListSessionInfo()
	if len(infos) != 0 {
		t.Errorf("Expected 0 session infos, got %d", len(infos))
	}
}

func TestSessionStatus(t *testing.T) {
	manager := &Manager{
		sessions: make(map[string]*Session),
	}
	
	// Create a test session
	session := &Session{
		ID:        "test-session-1",
		RunID:     "test-run-1",
		Status:    StatusStarting,
		StartTime: time.Now(),
		Config: claudecode.SessionConfig{
			Prompt: "Test prompt",
		},
	}
	
	// Add session to manager
	manager.sessions[session.ID] = session
	
	// Test GetSession
	retrieved, err := manager.GetSession(session.ID)
	if err != nil {
		t.Fatalf("Failed to get session: %v", err)
	}
	
	if retrieved.ID != session.ID {
		t.Errorf("Expected session ID %s, got %s", session.ID, retrieved.ID)
	}
	
	// Test GetSessionInfo
	info, err := manager.GetSessionInfo(session.ID)
	if err != nil {
		t.Fatalf("Failed to get session info: %v", err)
	}
	
	if info.ID != session.ID {
		t.Errorf("Expected session ID %s, got %s", session.ID, info.ID)
	}
	
	if info.RunID != session.RunID {
		t.Errorf("Expected run ID %s, got %s", session.RunID, info.RunID)
	}
	
	if info.Prompt != "Test prompt" {
		t.Errorf("Expected prompt 'Test prompt', got %s", info.Prompt)
	}
	
	// Test updateSessionStatus
	manager.updateSessionStatus(session.ID, StatusCompleted, "")
	
	if session.Status != StatusCompleted {
		t.Errorf("Expected status %s, got %s", StatusCompleted, session.Status)
	}
	
	if session.EndTime == nil {
		t.Error("EndTime should be set when status is completed")
	}
	
	// Test error status
	manager.updateSessionStatus(session.ID, StatusFailed, "test error")
	
	if session.Status != StatusFailed {
		t.Errorf("Expected status %s, got %s", StatusFailed, session.Status)
	}
	
	if session.Error != "test error" {
		t.Errorf("Expected error 'test error', got %s", session.Error)
	}
}

func TestGetNonExistentSession(t *testing.T) {
	manager := &Manager{
		sessions: make(map[string]*Session),
	}
	
	_, err := manager.GetSession("non-existent")
	if err == nil {
		t.Error("Expected error for non-existent session")
	}
	
	_, err = manager.GetSessionInfo("non-existent")
	if err == nil {
		t.Error("Expected error for non-existent session info")
	}
}

func TestConcurrentSessionAccess(t *testing.T) {
	// This test verifies that the manager handles concurrent access properly
	// We can't test LaunchSession without mocking the Claude client,
	// so we'll test the other concurrent-safe methods
	
	manager := &Manager{
		sessions: make(map[string]*Session),
	}
	
	// Pre-populate some sessions using the internal API (this is OK for test setup)
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
		manager.mu.Lock()
		manager.sessions[session.ID] = session
		manager.mu.Unlock()
	}
	
	// Run concurrent operations using only public APIs
	done := make(chan bool)
	
	// Writer goroutine - updates session statuses
	go func() {
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
		done <- true
	}()
	
	// Reader goroutine - reads sessions
	go func() {
		for i := 0; i < 100; i++ {
			sessions := manager.ListSessions()
			_ = sessions
			
			infos := manager.ListSessionInfo()
			_ = infos
			
			// Try to get specific sessions
			for j := 0; j < 10; j++ {
				sessionID := fmt.Sprintf("session-%d", j)
				_, _ = manager.GetSession(sessionID)
				_, _ = manager.GetSessionInfo(sessionID)
			}
		}
		done <- true
	}()
	
	// Wait for both to complete
	<-done
	<-done
	
	// Verify final state
	sessions := manager.ListSessions()
	if len(sessions) != 10 {
		t.Errorf("Expected 10 sessions, got %d", len(sessions))
	}
}