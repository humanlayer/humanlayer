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

func TestPermissionMonitor_DisableExpiredDangerouslySkipPermissions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	eventBus := bus.NewEventBus()

	monitor := NewPermissionMonitor(mockStore, eventBus, 30*time.Second)

	// Set up test data
	expiredTime := time.Now().Add(-1 * time.Hour)
	sessions := []*store.Session{
		{
			ID:                                  "session-1",
			RunID:                               "run-1",
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &expiredTime,
			Status:                              store.SessionStatusRunning,
		},
	}

	// Expect the query
	mockStore.EXPECT().
		GetExpiredDangerousPermissionsSessions(gomock.Any()).
		Return(sessions, nil)

	// Expect the update
	mockStore.EXPECT().
		UpdateSession(gomock.Any(), "session-1", gomock.Any()).
		DoAndReturn(func(ctx context.Context, id string, update store.SessionUpdate) error {
			if update.DangerouslySkipPermissions == nil || *update.DangerouslySkipPermissions != false {
				t.Errorf("expected dangerous permissions to be disabled")
			}
			if update.DangerouslySkipPermissionsExpiresAt == nil {
				t.Errorf("expected expires_at to be cleared")
			}
			return nil
		})

	// Subscribe to events to verify broadcast
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	subscriber := eventBus.Subscribe(ctx, bus.EventFilter{
		Types: []bus.EventType{bus.EventSessionSettingsChanged},
	})

	// Run the check
	monitor.checkAndDisableExpiredDangerouslySkipPermissions(context.Background())

	// Verify event was published
	select {
	case event := <-subscriber.Channel:
		if event.Type != bus.EventSessionSettingsChanged {
			t.Errorf("expected settings changed event, got %v", event.Type)
		}
		data := event.Data
		if data["session_id"] != "session-1" {
			t.Errorf("expected session_id session-1, got %v", data["session_id"])
		}
		if data["dangerously_skip_permissions"] != false {
			t.Errorf("expected dangerously_skip_permissions false, got %v", data["dangerously_skip_permissions"])
		}
		if data["reason"] != string(bus.SessionSettingsChangeReasonExpired) {
			t.Errorf("expected reason %s, got %v", bus.SessionSettingsChangeReasonExpired, data["reason"])
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for event")
	}
}

func TestPermissionMonitor_ContinuesOnError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	monitor := NewPermissionMonitor(mockStore, nil, 30*time.Second)

	sessions := []*store.Session{
		{ID: "session-1", DangerouslySkipPermissions: true},
		{ID: "session-2", DangerouslySkipPermissions: true},
	}

	mockStore.EXPECT().
		GetExpiredDangerousPermissionsSessions(gomock.Any()).
		Return(sessions, nil)

	// First update fails
	mockStore.EXPECT().
		UpdateSession(gomock.Any(), "session-1", gomock.Any()).
		Return(fmt.Errorf("database error"))

	// Second update succeeds
	mockStore.EXPECT().
		UpdateSession(gomock.Any(), "session-2", gomock.Any()).
		Return(nil)

	// Should continue despite first error
	monitor.checkAndDisableExpiredDangerouslySkipPermissions(context.Background())
}

func TestPermissionMonitor_HandlesEmptyResults(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	monitor := NewPermissionMonitor(mockStore, nil, 30*time.Second)

	// Return empty results
	mockStore.EXPECT().
		GetExpiredDangerousPermissionsSessions(gomock.Any()).
		Return([]*store.Session{}, nil)

	// Should not call UpdateSession
	// Test passes if no panic and no UpdateSession calls
	monitor.checkAndDisableExpiredDangerouslySkipPermissions(context.Background())
}

func TestPermissionMonitor_HandlesQueryError(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockStore := store.NewMockConversationStore(ctrl)
	monitor := NewPermissionMonitor(mockStore, nil, 30*time.Second)

	// Query returns error
	mockStore.EXPECT().
		GetExpiredDangerousPermissionsSessions(gomock.Any()).
		Return(nil, fmt.Errorf("database connection error"))

	// Should handle error gracefully without panicking
	monitor.checkAndDisableExpiredDangerouslySkipPermissions(context.Background())
}

func TestPermissionMonitor_DefaultInterval(t *testing.T) {
	monitor := NewPermissionMonitor(nil, nil, 0)
	if monitor.interval != 30*time.Second {
		t.Errorf("expected default interval of 30s, got %v", monitor.interval)
	}

	monitor = NewPermissionMonitor(nil, nil, -1*time.Second)
	if monitor.interval != 30*time.Second {
		t.Errorf("expected default interval of 30s for negative input, got %v", monitor.interval)
	}
}
