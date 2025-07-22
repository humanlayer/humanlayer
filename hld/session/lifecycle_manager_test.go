package session

import (
	"context"
	"sync"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestLifecycleManager_TransitionToRunning(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, mockEventBus, activeProcesses, mu, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"
	runID := "test-run"

	t.Run("successfully transitions to running", func(t *testing.T) {
		expectedStatus := string(StatusRunning)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.LastActivityAt)
		}).Return(nil)

		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventSessionStatusChanged, e.Type)
			assert.Equal(t, sessionID, e.Data["session_id"])
			assert.Equal(t, runID, e.Data["run_id"])
			assert.Equal(t, string(StatusStarting), e.Data["old_status"])
			assert.Equal(t, string(StatusRunning), e.Data["new_status"])
		})

		err := manager.TransitionToRunning(ctx, sessionID, runID)
		assert.NoError(t, err)
	})

	t.Run("returns error on database update failure", func(t *testing.T) {
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Return(assert.AnError)
		// No event bus expectation - should fail before publishing

		err := manager.TransitionToRunning(ctx, sessionID, runID)
		assert.Error(t, err)
	})
}

func TestLifecycleManager_UpdateSessionStatus(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, nil, activeProcesses, mu, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"

	t.Run("updates status with error message", func(t *testing.T) {
		errorMsg := "test error"
		expectedStatus := string(StatusFailed)

		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.ErrorMessage)
			assert.Equal(t, errorMsg, *update.ErrorMessage)
		}).Return(nil)

		err := manager.UpdateSessionStatus(ctx, sessionID, StatusFailed, errorMsg)
		assert.NoError(t, err)
	})

	t.Run("cleans up resources on completion", func(t *testing.T) {
		// Add active process and pending query
		activeProcesses[sessionID] = &claudecode.Session{}
		pendingQueries.Store(sessionID, "test query")

		expectedStatus := string(StatusCompleted)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.CompletedAt)
		}).Return(nil)

		err := manager.UpdateSessionStatus(ctx, sessionID, StatusCompleted, "")
		assert.NoError(t, err)

		// Verify cleanup
		_, exists := activeProcesses[sessionID]
		assert.False(t, exists)
		_, hasQuery := pendingQueries.Load(sessionID)
		assert.False(t, hasQuery)
	})
}

func TestLifecycleManager_CompleteSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, mockEventBus, activeProcesses, mu, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"
	runID := "test-run"
	startTime := time.Now().Add(-10 * time.Second)

	t.Run("completes session with result", func(t *testing.T) {
		result := &claudecode.Result{
			CostUSD:  0.05,
			NumTurns: 5,
			Result:   "Task completed successfully",
		}

		// Mock GetSession to return current status
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: string(StatusRunning),
		}, nil)

		expectedStatus := string(StatusCompleted)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.CompletedAt)
			assert.NotNil(t, update.CostUSD)
			assert.Equal(t, 0.05, *update.CostUSD)
			assert.NotNil(t, update.NumTurns)
			assert.Equal(t, 5, *update.NumTurns)
			assert.NotNil(t, update.ResultContent)
			assert.Equal(t, "Task completed successfully", *update.ResultContent)
			assert.NotNil(t, update.DurationMS)
		}).Return(nil)

		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventSessionStatusChanged, e.Type)
			assert.Equal(t, sessionID, e.Data["session_id"])
			assert.Equal(t, runID, e.Data["run_id"])
			assert.Equal(t, string(StatusRunning), e.Data["old_status"])
			assert.Equal(t, string(StatusCompleted), e.Data["new_status"])
		})

		// Add active process and pending query for cleanup
		activeProcesses[sessionID] = &claudecode.Session{}
		pendingQueries.Store(sessionID, "test query")

		err := manager.CompleteSession(ctx, sessionID, runID, result, startTime)
		assert.NoError(t, err)

		// Verify cleanup
		_, exists := activeProcesses[sessionID]
		assert.False(t, exists)
		_, hasQuery := pendingQueries.Load(sessionID)
		assert.False(t, hasQuery)
	})

	t.Run("completes session without result", func(t *testing.T) {
		// Mock GetSession
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: string(StatusRunning),
		}, nil)

		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, string(StatusCompleted), *update.Status)
			assert.NotNil(t, update.CompletedAt)
			assert.NotNil(t, update.DurationMS)
		}).Return(nil)

		mockEventBus.EXPECT().Publish(gomock.Any())

		err := manager.CompleteSession(ctx, sessionID, runID, nil, startTime)
		assert.NoError(t, err)
	})
}

func TestLifecycleManager_HandleSessionError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, nil, activeProcesses, mu, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"

	t.Run("marks session as failed on error", func(t *testing.T) {
		testErr := assert.AnError

		// Mock GetSession to return running session
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: string(StatusRunning),
		}, nil)

		expectedStatus := string(StatusFailed)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.ErrorMessage)
			assert.Equal(t, testErr.Error(), *update.ErrorMessage)
		}).Return(nil)

		err := manager.HandleSessionError(ctx, sessionID, testErr)
		assert.NoError(t, err)
	})

	t.Run("skips failure for interrupted session", func(t *testing.T) {
		// Mock GetSession to return completing session
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: string(StatusCompleting),
		}, nil)

		// No UpdateSession expectation - should skip

		err := manager.HandleSessionError(ctx, sessionID, assert.AnError)
		assert.NoError(t, err)
	})
}

func TestLifecycleManager_TransitionToCompleting(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	mockEventBus := bus.NewMockEventBus(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, mockEventBus, activeProcesses, mu, pendingQueries)
	ctx := context.Background()
	sessionID := "test-session"

	t.Run("transitions to completing status", func(t *testing.T) {
		// Mock GetSession to return current status
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(&store.Session{
			ID:     sessionID,
			Status: string(StatusRunning),
		}, nil)

		expectedStatus := string(StatusCompleting)
		mockStore.EXPECT().UpdateSession(ctx, sessionID, gomock.Any()).Do(func(_ context.Context, _ string, update store.SessionUpdate) {
			assert.NotNil(t, update.Status)
			assert.Equal(t, expectedStatus, *update.Status)
			assert.NotNil(t, update.ErrorMessage)
			assert.Equal(t, "Session interrupt requested, shutting down gracefully", *update.ErrorMessage)
			assert.NotNil(t, update.CompletedAt)
			assert.NotNil(t, update.LastActivityAt)
		}).Return(nil)

		mockEventBus.EXPECT().Publish(gomock.Any()).Do(func(e bus.Event) {
			assert.Equal(t, bus.EventSessionStatusChanged, e.Type)
			assert.Equal(t, sessionID, e.Data["session_id"])
			assert.Equal(t, string(StatusRunning), e.Data["old_status"])
			assert.Equal(t, string(StatusCompleting), e.Data["new_status"])
		})

		err := manager.TransitionToCompleting(ctx, sessionID)
		assert.NoError(t, err)
	})

	t.Run("returns error on database failure", func(t *testing.T) {
		mockStore.EXPECT().GetSession(ctx, sessionID).Return(nil, assert.AnError)

		err := manager.TransitionToCompleting(ctx, sessionID)
		assert.Error(t, err)
	})
}

func TestLifecycleManager_CleanupSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	activeProcesses := make(map[string]*claudecode.Session)
	mu := &sync.RWMutex{}
	pendingQueries := &sync.Map{}

	manager := NewLifecycleManager(mockStore, nil, activeProcesses, mu, pendingQueries)
	sessionID := "test-session"

	t.Run("cleans up all resources", func(t *testing.T) {
		// Add resources
		activeProcesses[sessionID] = &claudecode.Session{}
		pendingQueries.Store(sessionID, "test query")

		// Verify resources exist
		_, exists := activeProcesses[sessionID]
		assert.True(t, exists)
		_, hasQuery := pendingQueries.Load(sessionID)
		assert.True(t, hasQuery)

		// Cleanup
		manager.CleanupSession(sessionID)

		// Verify cleanup
		_, exists = activeProcesses[sessionID]
		assert.False(t, exists)
		_, hasQuery = pendingQueries.Load(sessionID)
		assert.False(t, hasQuery)
	})

	t.Run("handles cleanup when no resources exist", func(t *testing.T) {
		// Should not panic when resources don't exist
		manager.CleanupSession(sessionID)
	})
}
