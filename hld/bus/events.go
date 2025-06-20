package bus

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"sync"
	"time"
)

// eventBus is the concrete implementation of EventBus
type eventBus struct {
	subscribers map[string]*Subscriber
	mu          sync.RWMutex
	bufferSize  int
}

// NewEventBus creates a new event bus
func NewEventBus() EventBus {
	return &eventBus{
		subscribers: make(map[string]*Subscriber),
		bufferSize:  100, // Buffer up to 100 events per subscriber
	}
}

// Subscribe creates a new subscription with the given filter
func (eb *eventBus) Subscribe(ctx context.Context, filter EventFilter) *Subscriber {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	// Create a new context that we control
	subCtx, cancel := context.WithCancel(ctx)

	sub := &Subscriber{
		ID:       generateSubscriberID(),
		Channel:  make(chan Event, eb.bufferSize),
		Filter:   filter,
		ctx:      subCtx,
		cancelFn: cancel,
	}

	eb.subscribers[sub.ID] = sub

	// Start a goroutine to clean up when context is done
	go func() {
		<-subCtx.Done()
		slog.Debug("subscriber context done, cleaning up", "subscriber_id", sub.ID)
		eb.Unsubscribe(sub.ID)
	}()

	slog.Debug("new event bus subscription",
		"subscriber_id", sub.ID,
		"filter_types", filter.Types,
		"filter_session", filter.SessionID,
		"filter_run_id", filter.RunID,
	)

	return sub
}

// Unsubscribe removes a subscription
func (eb *eventBus) Unsubscribe(subscriberID string) {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	if sub, ok := eb.subscribers[subscriberID]; ok {
		// Remove from map first to prevent double cleanup
		delete(eb.subscribers, subscriberID)

		// Cancel context (this might trigger the cleanup goroutine)
		sub.cancelFn()

		// Close channel
		close(sub.Channel)

		slog.Debug("event bus unsubscribe", "subscriber_id", subscriberID)
	}
}

// Publish sends an event to all matching subscribers
func (eb *eventBus) Publish(event Event) {
	// Validate event
	if event.Type == "" {
		slog.Error("attempted to publish event with empty type", "data", event.Data)
		return
	}

	eb.mu.RLock()
	defer eb.mu.RUnlock()

	event.Timestamp = time.Now()

	slog.Debug("publishing event",
		"type", event.Type,
		"data", event.Data,
		"subscriber_count", len(eb.subscribers),
	)

	matchedCount := 0
	for _, sub := range eb.subscribers {
		if eb.matchesFilter(event, sub.Filter) {
			matchedCount++
			select {
			case sub.Channel <- event:
				slog.Debug("event sent to subscriber",
					"subscriber_id", sub.ID,
					"event_type", event.Type,
				)
			default:
				// Channel is full, drop the event
				slog.Warn("dropping event for slow subscriber",
					"subscriber_id", sub.ID,
					"event_type", event.Type,
				)
			}
		}
	}

	slog.Debug("event publish complete",
		"event_type", event.Type,
		"total_subscribers", len(eb.subscribers),
		"matched_subscribers", matchedCount,
	)
}

// matchesFilter checks if an event matches a subscriber's filter
func (eb *eventBus) matchesFilter(event Event, filter EventFilter) bool {
	// Check event type filter
	if len(filter.Types) > 0 {
		matched := false
		for _, t := range filter.Types {
			if t == event.Type {
				matched = true
				break
			}
		}
		if !matched {
			slog.Debug("event type mismatch",
				"event_type", event.Type,
				"filter_types", filter.Types,
			)
			return false
		}
	}

	// Check session ID filter
	if filter.SessionID != "" {
		sessionID, sessionIDExists := event.Data["session_id"].(string)
		slog.Debug("checking session ID filter",
			"filter_session_id", filter.SessionID,
			"event_session_id", sessionID,
			"session_id_exists", sessionIDExists,
			"event_data", event.Data,
		)
		if !sessionIDExists || sessionID != filter.SessionID {
			return false
		}
	}

	// Check run ID filter
	if filter.RunID != "" {
		runID, runIDExists := event.Data["run_id"].(string)
		slog.Debug("checking run ID filter",
			"filter_run_id", filter.RunID,
			"event_run_id", runID,
			"run_id_exists", runIDExists,
		)
		if !runIDExists || runID != filter.RunID {
			return false
		}
	}

	slog.Debug("event matches filter",
		"event_type", event.Type,
		"filter", filter,
	)
	return true
}

// GetSubscriberCount returns the current number of subscribers
func (eb *eventBus) GetSubscriberCount() int {
	eb.mu.RLock()
	defer eb.mu.RUnlock()
	return len(eb.subscribers)
}

// generateSubscriberID creates a unique subscriber ID
func generateSubscriberID() string {
	// Use crypto/rand for proper randomness
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp if crypto/rand fails
		return time.Now().Format("20060102150405.999999999")
	}
	return time.Now().Format("20060102150405") + "-" + hex.EncodeToString(b)
}
