package session

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

// TestStopAllSessions_Success tests successful shutdown of all sessions
func TestStopAllSessions_Success(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create mock sessions
	numSessions := 5
	for i := 0; i < numSessions; i++ {
		sessionID := fmt.Sprintf("session-%d", i)
		mockSession := NewMockClaudeSession(ctrl)

		// Expect GetID to be called
		mockSession.EXPECT().GetID().Return(sessionID).AnyTimes()

		// Session should be interrupted exactly once
		mockSession.EXPECT().Interrupt().Return(nil).Times(1)

		manager.activeProcesses[sessionID] = mockSession

		// Mock store expectations for InterruptSession
		mockStore.EXPECT().GetSession(gomock.Any(), sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: store.SessionStatusRunning,
		}, nil)

		mockStore.EXPECT().UpdateSession(gomock.Any(), sessionID, gomock.Any()).DoAndReturn(
			func(ctx context.Context, id string, update store.SessionUpdate) error {
				// Verify status is being set to interrupting
				require.NotNil(t, update.Status)
				assert.Equal(t, store.SessionStatusInterrupting, *update.Status)

				// Simulate session cleanup after interrupt
				go func() {
					time.Sleep(50 * time.Millisecond)
					manager.mu.Lock()
					delete(manager.activeProcesses, id)
					manager.mu.Unlock()
				}()

				return nil
			})
	}

	// Call StopAllSessions with reasonable timeout
	err := manager.StopAllSessions(1 * time.Second)

	// Should succeed
	assert.NoError(t, err)

	// All sessions should be removed
	manager.mu.RLock()
	remaining := len(manager.activeProcesses)
	manager.mu.RUnlock()
	assert.Equal(t, 0, remaining)
}

// TestStopAllSessions_Timeout tests timeout behavior with stubborn sessions
func TestStopAllSessions_Timeout(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create stubborn session that won't stop
	stubbornID := "stubborn-session"
	mockSession := NewMockClaudeSession(ctrl)

	mockSession.EXPECT().GetID().Return(stubbornID).AnyTimes()
	mockSession.EXPECT().Interrupt().Return(nil).Times(1)
	mockSession.EXPECT().Kill().Return(nil).Times(1) // Force kill should be attempted

	manager.activeProcesses[stubbornID] = mockSession

	// Mock store expectations
	mockStore.EXPECT().GetSession(gomock.Any(), stubbornID).Return(&store.Session{
		ID:     stubbornID,
		Status: store.SessionStatusRunning,
	}, nil)

	mockStore.EXPECT().UpdateSession(gomock.Any(), stubbornID, gomock.Any()).Return(nil)

	// Call with short timeout
	err := manager.StopAllSessions(100 * time.Millisecond)

	// Should timeout
	assert.Equal(t, context.DeadlineExceeded, err)
}

// TestStopAllSessions_ConcurrentOperations tests race conditions
func TestStopAllSessions_ConcurrentOperations(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Counter for operations
	var interruptCount int32
	var addCount int32
	var removeCount int32

	// Initial sessions
	for i := 0; i < 10; i++ {
		sessionID := fmt.Sprintf("session-%d", i)
		mockSession := NewMockClaudeSession(ctrl)

		mockSession.EXPECT().GetID().Return(sessionID).AnyTimes()
		mockSession.EXPECT().Interrupt().DoAndReturn(func() error {
			atomic.AddInt32(&interruptCount, 1)
			return nil
		}).MaxTimes(1)
		mockSession.EXPECT().Kill().Return(nil).MaxTimes(1) // May be force killed on timeout

		manager.activeProcesses[sessionID] = mockSession

		// Allow any number of GetSession/UpdateSession calls
		mockStore.EXPECT().GetSession(gomock.Any(), sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: store.SessionStatusRunning,
		}, nil).AnyTimes()

		mockStore.EXPECT().UpdateSession(gomock.Any(), sessionID, gomock.Any()).Return(nil).AnyTimes()
	}

	// Prepare mock sessions for concurrent additions
	for i := 10; i < 20; i++ {
		sessionID := fmt.Sprintf("new-session-%d", i)
		mockStore.EXPECT().GetSession(gomock.Any(), sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: store.SessionStatusRunning,
		}, nil).AnyTimes()

		mockStore.EXPECT().UpdateSession(gomock.Any(), sessionID, gomock.Any()).Return(nil).AnyTimes()
	}

	var wg sync.WaitGroup
	wg.Add(3)

	// Goroutine 1: Call StopAllSessions
	go func() {
		defer wg.Done()
		_ = manager.StopAllSessions(500 * time.Millisecond)
	}()

	// Goroutine 2: Concurrently add new sessions
	go func() {
		defer wg.Done()
		for i := 10; i < 15; i++ {
			sessionID := fmt.Sprintf("new-session-%d", i)
			mockSession := NewMockClaudeSession(ctrl)

			mockSession.EXPECT().GetID().Return(sessionID).AnyTimes()
			mockSession.EXPECT().Interrupt().DoAndReturn(func() error {
				atomic.AddInt32(&interruptCount, 1)
				return nil
			}).MaxTimes(1)
			mockSession.EXPECT().Kill().Return(nil).MaxTimes(1) // May be force killed on timeout

			manager.mu.Lock()
			manager.activeProcesses[sessionID] = mockSession
			atomic.AddInt32(&addCount, 1)
			manager.mu.Unlock()

			time.Sleep(20 * time.Millisecond)
		}
	}()

	// Goroutine 3: Concurrently remove sessions
	go func() {
		defer wg.Done()
		for i := 0; i < 5; i++ {
			sessionID := fmt.Sprintf("session-%d", i)

			time.Sleep(30 * time.Millisecond)

			manager.mu.Lock()
			if _, exists := manager.activeProcesses[sessionID]; exists {
				delete(manager.activeProcesses, sessionID)
				atomic.AddInt32(&removeCount, 1)
			}
			manager.mu.Unlock()
		}
	}()

	// Wait for all goroutines
	wg.Wait()

	// Verify operations occurred
	assert.Greater(t, atomic.LoadInt32(&interruptCount), int32(0), "Some interrupts should have been sent")
	assert.Greater(t, atomic.LoadInt32(&addCount), int32(0), "Some sessions should have been added")
	assert.Greater(t, atomic.LoadInt32(&removeCount), int32(0), "Some sessions should have been removed")
}

// TestStopAllSessions_InterruptError tests handling of interrupt errors
func TestStopAllSessions_InterruptError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create sessions with different behaviors
	successID := "success-session"
	errorID := "error-session"

	// Success session
	mockSuccessSession := NewMockClaudeSession(ctrl)
	mockSuccessSession.EXPECT().GetID().Return(successID).AnyTimes()
	mockSuccessSession.EXPECT().Interrupt().Return(nil)
	manager.activeProcesses[successID] = mockSuccessSession

	// Error session
	mockErrorSession := NewMockClaudeSession(ctrl)
	mockErrorSession.EXPECT().GetID().Return(errorID).AnyTimes()
	mockErrorSession.EXPECT().Interrupt().Return(fmt.Errorf("interrupt failed"))
	mockErrorSession.EXPECT().Kill().Return(nil) // Should attempt force kill on timeout
	manager.activeProcesses[errorID] = mockErrorSession

	// Mock store expectations
	mockStore.EXPECT().GetSession(gomock.Any(), successID).Return(&store.Session{
		ID:     successID,
		Status: store.SessionStatusRunning,
	}, nil)

	mockStore.EXPECT().UpdateSession(gomock.Any(), successID, gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate successful cleanup
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})

	// Error session expectations - GetSession fails due to interrupt error
	mockStore.EXPECT().GetSession(gomock.Any(), errorID).Return(&store.Session{
		ID:     errorID,
		Status: store.SessionStatusRunning,
	}, nil)

	// Call StopAllSessions
	err := manager.StopAllSessions(200 * time.Millisecond)

	// Should timeout due to error session
	assert.Equal(t, context.DeadlineExceeded, err)
}

// TestStopAllSessions_EmptySessions tests behavior with no active sessions
func TestStopAllSessions_EmptySessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// No active sessions
	err := manager.StopAllSessions(1 * time.Second)

	// Should succeed immediately
	assert.NoError(t, err)
}

// TestForceKillRemaining tests the force kill functionality
func TestForceKillRemaining(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create sessions
	numSessions := 3
	killCalled := make(map[string]bool)
	var mu sync.Mutex

	for i := 0; i < numSessions; i++ {
		sessionID := fmt.Sprintf("session-%d", i)
		mockSession := NewMockClaudeSession(ctrl)

		mockSession.EXPECT().GetID().Return(sessionID).AnyTimes()
		mockSession.EXPECT().Kill().DoAndReturn(func() error {
			mu.Lock()
			killCalled[sessionID] = true
			mu.Unlock()
			return nil
		}).Times(1)

		manager.activeProcesses[sessionID] = mockSession
	}

	// Call forceKillRemaining
	manager.forceKillRemaining()

	// Verify all sessions were killed
	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, numSessions, len(killCalled))
	for i := 0; i < numSessions; i++ {
		sessionID := fmt.Sprintf("session-%d", i)
		assert.True(t, killCalled[sessionID], "Session %s should have been killed", sessionID)
	}
}

// TestStopAllSessions_MixedStatuses tests that only running sessions are interrupted
func TestStopAllSessions_MixedStatuses(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create sessions with different statuses
	runningID := "running-session"
	completedID := "completed-session"
	interruptedID := "interrupted-session"

	// Running session - should be interrupted
	mockRunningSession := NewMockClaudeSession(ctrl)
	mockRunningSession.EXPECT().GetID().Return(runningID).AnyTimes()
	mockRunningSession.EXPECT().Interrupt().Return(nil).Times(1)
	manager.activeProcesses[runningID] = mockRunningSession

	// Completed session - should NOT be interrupted
	mockCompletedSession := NewMockClaudeSession(ctrl)
	mockCompletedSession.EXPECT().GetID().Return(completedID).AnyTimes()
	// No Interrupt() expectation
	mockCompletedSession.EXPECT().Kill().Return(nil).MaxTimes(1) // May be force killed on timeout
	manager.activeProcesses[completedID] = mockCompletedSession

	// Interrupted session - should NOT be interrupted again
	mockInterruptedSession := NewMockClaudeSession(ctrl)
	mockInterruptedSession.EXPECT().GetID().Return(interruptedID).AnyTimes()
	// No Interrupt() expectation
	mockInterruptedSession.EXPECT().Kill().Return(nil).MaxTimes(1) // May be force killed on timeout
	manager.activeProcesses[interruptedID] = mockInterruptedSession

	// Mock store expectations
	mockStore.EXPECT().GetSession(gomock.Any(), runningID).Return(&store.Session{
		ID:     runningID,
		Status: store.SessionStatusRunning,
	}, nil)
	mockStore.EXPECT().UpdateSession(gomock.Any(), runningID, gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate cleanup
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})

	mockStore.EXPECT().GetSession(gomock.Any(), completedID).Return(&store.Session{
		ID:     completedID,
		Status: store.SessionStatusCompleted,
	}, nil)

	mockStore.EXPECT().GetSession(gomock.Any(), interruptedID).Return(&store.Session{
		ID:     interruptedID,
		Status: store.SessionStatusInterrupted,
	}, nil)

	// Call StopAllSessions
	err := manager.StopAllSessions(500 * time.Millisecond)

	// Should timeout because completed and interrupted sessions remain in activeProcesses
	assert.Equal(t, context.DeadlineExceeded, err)
}

// TestStopAllSessions_SessionWaitingInput tests handling of sessions waiting for input
func TestStopAllSessions_SessionWaitingInput(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	manager, _ := NewManager(nil, mockStore, "")

	// Create session waiting for input
	waitingID := "waiting-session"
	mockWaitingSession := NewMockClaudeSession(ctrl)

	mockWaitingSession.EXPECT().GetID().Return(waitingID).AnyTimes()
	mockWaitingSession.EXPECT().Interrupt().Return(nil).Times(1)

	manager.activeProcesses[waitingID] = mockWaitingSession

	// Mock store expectations
	mockStore.EXPECT().GetSession(gomock.Any(), waitingID).Return(&store.Session{
		ID:     waitingID,
		Status: store.SessionStatusWaitingInput,
	}, nil)

	mockStore.EXPECT().UpdateSession(gomock.Any(), waitingID, gomock.Any()).DoAndReturn(
		func(ctx context.Context, id string, update store.SessionUpdate) error {
			// Simulate cleanup
			go func() {
				time.Sleep(50 * time.Millisecond)
				manager.mu.Lock()
				delete(manager.activeProcesses, id)
				manager.mu.Unlock()
			}()
			return nil
		})

	// Call StopAllSessions
	err := manager.StopAllSessions(500 * time.Millisecond)

	// Should succeed
	assert.NoError(t, err)

	// Session should be removed
	manager.mu.RLock()
	remaining := len(manager.activeProcesses)
	manager.mu.RUnlock()
	assert.Equal(t, 0, remaining)
}
