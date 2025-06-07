package daemon

import (
	"context"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	"go.uber.org/mock/gomock"
)

func TestDaemon_MarkOrphanedSessions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)

	// Set up sessions with various statuses
	sessions := []*store.Session{
		{
			ID:     "sess-running",
			Status: store.SessionStatusRunning,
		},
		{
			ID:     "sess-waiting",
			Status: store.SessionStatusWaitingInput,
		},
		{
			ID:     "sess-starting",
			Status: store.SessionStatusStarting,
		},
		{
			ID:     "sess-completed",
			Status: store.SessionStatusCompleted, // Should NOT be marked as failed
		},
		{
			ID:     "sess-already-failed",
			Status: store.SessionStatusFailed, // Should NOT be updated
		},
	}

	// Expect ListSessions to be called
	mockStore.EXPECT().ListSessions(gomock.Any()).Return(sessions, nil)

	// Expect UpdateSession for orphaned sessions only
	for _, sess := range sessions {
		if sess.Status == store.SessionStatusRunning ||
			sess.Status == store.SessionStatusWaitingInput ||
			sess.Status == store.SessionStatusStarting {

			mockStore.EXPECT().
				UpdateSession(gomock.Any(), sess.ID, gomock.Any()).
				DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
					// Verify the update
					if update.Status == nil || *update.Status != store.SessionStatusFailed {
						t.Errorf("expected status update to failed, got %v", update.Status)
					}
					if update.ErrorMessage == nil || *update.ErrorMessage != "daemon restarted while session was active" {
						t.Errorf("expected error message about daemon restart, got %v", update.ErrorMessage)
					}
					if update.CompletedAt == nil {
						t.Error("expected CompletedAt to be set")
					}
					return nil
				})
		}
	}

	// Create daemon with mock store
	d := &Daemon{
		store: mockStore,
	}

	// Call markOrphanedSessionsAsFailed
	err := d.markOrphanedSessionsAsFailed(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Expectations are verified by gomock
}

func TestDaemon_MarkOrphanedSessions_NoStore(t *testing.T) {
	// Test that it handles nil store gracefully
	d := &Daemon{
		store: nil,
	}

	err := d.markOrphanedSessionsAsFailed(context.Background())
	if err != nil {
		t.Fatalf("expected no error with nil store, got: %v", err)
	}
}
