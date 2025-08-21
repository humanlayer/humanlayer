package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestDaemon_PermissionExpiryMonitor(t *testing.T) {
	// Create in-memory SQLite store
	tempStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tempStore.Close() }()

	// Create event bus
	eventBus := bus.NewEventBus()

	// Create monitor with short interval for testing
	monitor := session.NewPermissionMonitor(tempStore, eventBus, 100*time.Millisecond)

	// Create a session with expired dangerous skip permissions
	expiredTime := time.Now().Add(-1 * time.Minute)
	session := &store.Session{
		ID:                                  "test-session",
		RunID:                               "test-run",
		Query:                               "test query",
		Status:                              store.SessionStatusRunning,
		DangerouslySkipPermissions:          true,
		DangerouslySkipPermissionsExpiresAt: &expiredTime,
		CreatedAt:                           time.Now(),
		LastActivityAt:                      time.Now(),
	}

	err = tempStore.CreateSession(context.Background(), session)
	if err != nil {
		t.Fatal(err)
	}

	// Subscribe to events
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	subscriber := eventBus.Subscribe(ctx, bus.EventFilter{
		Types: []bus.EventType{bus.EventSessionSettingsChanged},
	})

	// Start monitor in background
	monitorCtx, monitorCancel := context.WithCancel(context.Background())
	go monitor.Start(monitorCtx)

	// Wait for event
	select {
	case event := <-subscriber.Channel:
		// Verify event data
		if event.Data["session_id"] != "test-session" {
			t.Errorf("wrong session_id in event")
		}
		if event.Data["reason"] != string(bus.SessionSettingsChangeReasonExpired) {
			t.Errorf("expected reason=%s, got %v", bus.SessionSettingsChangeReasonExpired, event.Data["reason"])
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for expiry event")
	}

	// Verify session was updated
	updatedSession, err := tempStore.GetSession(context.Background(), "test-session")
	if err != nil {
		t.Fatal(err)
	}

	if updatedSession.DangerouslySkipPermissions {
		t.Error("dangerous permissions should be disabled")
	}

	if updatedSession.DangerouslySkipPermissionsExpiresAt != nil {
		t.Error("expiry time should be cleared")
	}

	// Clean shutdown
	monitorCancel()
}

func TestDaemon_PermissionMonitorWithMultipleSessions(t *testing.T) {
	// Create in-memory SQLite store
	tempStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tempStore.Close() }()

	// Create event bus
	eventBus := bus.NewEventBus()

	// Create monitor with short interval for testing
	monitor := session.NewPermissionMonitor(tempStore, eventBus, 100*time.Millisecond)

	// Create multiple sessions with different expiry states
	expiredTime := time.Now().Add(-1 * time.Minute)
	futureTime := time.Now().Add(1 * time.Hour)

	sessions := []*store.Session{
		{
			ID:                                  "expired-session",
			RunID:                               "run-1",
			Query:                               "test query 1",
			Status:                              store.SessionStatusRunning,
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &expiredTime,
			CreatedAt:                           time.Now(),
			LastActivityAt:                      time.Now(),
		},
		{
			ID:                                  "active-session",
			RunID:                               "run-2",
			Query:                               "test query 2",
			Status:                              store.SessionStatusRunning,
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &futureTime,
			CreatedAt:                           time.Now(),
			LastActivityAt:                      time.Now(),
		},
		{
			ID:                         "no-permissions-session",
			RunID:                      "run-3",
			Query:                      "test query 3",
			Status:                     store.SessionStatusRunning,
			DangerouslySkipPermissions: false,
			CreatedAt:                  time.Now(),
			LastActivityAt:             time.Now(),
		},
	}

	for _, s := range sessions {
		err = tempStore.CreateSession(context.Background(), s)
		if err != nil {
			t.Fatal(err)
		}
	}

	// Subscribe to events
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	subscriber := eventBus.Subscribe(ctx, bus.EventFilter{
		Types: []bus.EventType{bus.EventSessionSettingsChanged},
	})

	// Start monitor in background
	monitorCtx, monitorCancel := context.WithCancel(context.Background())
	go monitor.Start(monitorCtx)

	// Wait for event - should only get one for expired-session
	select {
	case event := <-subscriber.Channel:
		// Verify event data
		if event.Data["session_id"] != "expired-session" {
			t.Errorf("wrong session_id in event, got %v", event.Data["session_id"])
		}
	case <-ctx.Done():
		t.Fatal("timeout waiting for expiry event")
	}

	// Verify only the expired session was updated
	expiredSession, err := tempStore.GetSession(context.Background(), "expired-session")
	if err != nil {
		t.Fatal(err)
	}
	if expiredSession.DangerouslySkipPermissions {
		t.Error("expired session should have dangerous skip permissions disabled")
	}

	// Active session should still have permissions
	activeSession, err := tempStore.GetSession(context.Background(), "active-session")
	if err != nil {
		t.Fatal(err)
	}
	// Debug: Check what expiry time we have
	if activeSession.DangerouslySkipPermissionsExpiresAt != nil {
		t.Logf("Active session expiry time: %v", activeSession.DangerouslySkipPermissionsExpiresAt)
		t.Logf("Current time: %v", time.Now())
		t.Logf("Time until expiry: %v", time.Until(*activeSession.DangerouslySkipPermissionsExpiresAt))
	}
	if !activeSession.DangerouslySkipPermissions {
		t.Error("active session should still have permissions enabled")
	}

	// Clean shutdown
	monitorCancel()
}
