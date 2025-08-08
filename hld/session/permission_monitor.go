package session

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// PermissionMonitor handles periodic cleanup of expired dangerous skip permissions
type PermissionMonitor struct {
	store    store.ConversationStore
	eventBus bus.EventBus
	interval time.Duration
}

// NewPermissionMonitor creates a new dangerous skip permissions monitor
func NewPermissionMonitor(store store.ConversationStore, eventBus bus.EventBus, interval time.Duration) *PermissionMonitor {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &PermissionMonitor{
		store:    store,
		eventBus: eventBus,
		interval: interval,
	}
}

// Start begins monitoring for expired dangerous skip permissions
func (pm *PermissionMonitor) Start(ctx context.Context) {
	slog.Info("starting dangerous skip permissions expiry monitor", "interval", pm.interval)

	ticker := time.NewTicker(pm.interval)
	defer ticker.Stop()

	// Do an initial check immediately
	pm.checkAndDisableExpiredDangerouslySkipPermissions(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("dangerous skip permissions monitor shutting down")
			return
		case <-ticker.C:
			pm.checkAndDisableExpiredDangerouslySkipPermissions(ctx)
		}
	}
}

func (pm *PermissionMonitor) checkAndDisableExpiredDangerouslySkipPermissions(ctx context.Context) {
	// Guard against nil store (can happen during shutdown)
	if pm.store == nil {
		return
	}

	sessions, err := pm.store.GetExpiredDangerousPermissionsSessions(ctx)
	if err != nil {
		slog.Error("failed to query expired dangerous skip permissions sessions", "error", err)
		return
	}

	if len(sessions) == 0 {
		return
	}

	slog.Info("found sessions with expired dangerous skip permissions", "count", len(sessions))

	for _, session := range sessions {
		if err := pm.disableDangerouslySkipPermissions(ctx, session); err != nil {
			slog.Error("failed to disable expired dangerous skip permissions",
				"session_id", session.ID,
				"expires_at", session.DangerouslySkipPermissionsExpiresAt,
				"error", err)
			// Continue with other sessions
		}
	}
}

func (pm *PermissionMonitor) disableDangerouslySkipPermissions(ctx context.Context, session *store.Session) error {
	// Update the session in the database
	dangerouslySkipPermissions := false
	var nilTime *time.Time

	update := store.SessionUpdate{
		DangerouslySkipPermissions:          &dangerouslySkipPermissions,
		DangerouslySkipPermissionsExpiresAt: &nilTime,
	}

	if err := pm.store.UpdateSession(ctx, session.ID, update); err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	// Publish event to notify clients
	if pm.eventBus != nil {
		event := bus.Event{
			Type:      bus.EventSessionSettingsChanged,
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"session_id":                   session.ID,
				"run_id":                       session.RunID,
				"dangerously_skip_permissions": false,
				"reason":                       string(bus.SessionSettingsChangeReasonExpired),
				"expired_at":                   session.DangerouslySkipPermissionsExpiresAt,
			},
		}
		pm.eventBus.Publish(event)
	}

	slog.Info("disabled expired dangerous skip permissions",
		"session_id", session.ID,
		"expired_at", session.DangerouslySkipPermissionsExpiresAt)

	return nil
}
