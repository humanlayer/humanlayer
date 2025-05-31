package bus

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestEventBus_Subscribe(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	// Test basic subscription
	sub := eb.Subscribe(ctx, EventFilter{})
	if sub == nil {
		t.Fatal("expected subscriber, got nil")
	}
	if sub.ID == "" {
		t.Error("expected subscriber ID, got empty string")
	}
	if sub.Channel == nil {
		t.Error("expected channel, got nil")
	}

	// Verify subscriber count
	if count := eb.GetSubscriberCount(); count != 1 {
		t.Errorf("expected 1 subscriber, got %d", count)
	}
}

func TestEventBus_Unsubscribe(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	sub := eb.Subscribe(ctx, EventFilter{})
	initialCount := eb.GetSubscriberCount()

	eb.Unsubscribe(sub.ID)

	// Verify subscriber was removed
	if count := eb.GetSubscriberCount(); count != initialCount-1 {
		t.Errorf("expected %d subscribers after unsubscribe, got %d", initialCount-1, count)
	}

	// Verify channel is closed
	select {
	case _, ok := <-sub.Channel:
		if ok {
			t.Error("expected channel to be closed")
		}
	default:
		t.Error("expected channel to be closed")
	}
}

func TestEventBus_Publish(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	// Create subscriber
	sub := eb.Subscribe(ctx, EventFilter{})

	// Publish event
	event := Event{
		Type: EventNewApproval,
		Data: map[string]interface{}{
			"approval_count": 1,
		},
	}
	eb.Publish(event)

	// Verify event received
	select {
	case received := <-sub.Channel:
		if received.Type != event.Type {
			t.Errorf("expected event type %s, got %s", event.Type, received.Type)
		}
		if count, ok := received.Data["approval_count"].(int); !ok || count != 1 {
			t.Error("expected approval_count=1 in event data")
		}
		if received.Timestamp.IsZero() {
			t.Error("expected timestamp to be set")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("timeout waiting for event")
	}
}

func TestEventBus_EventTypeFilter(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	// Subscribe only to approval events
	sub := eb.Subscribe(ctx, EventFilter{
		Types: []EventType{EventNewApproval, EventApprovalResolved},
	})

	// Publish different event types
	eb.Publish(Event{Type: EventNewApproval})
	eb.Publish(Event{Type: EventSessionStatusChanged})
	eb.Publish(Event{Type: EventApprovalResolved})

	// Should receive only approval events
	received := 0
	timeout := time.After(100 * time.Millisecond)

	for {
		select {
		case event := <-sub.Channel:
			received++
			if event.Type != EventNewApproval && event.Type != EventApprovalResolved {
				t.Errorf("received unexpected event type: %s", event.Type)
			}
		case <-timeout:
			goto done
		}
	}

done:
	if received != 2 {
		t.Errorf("expected 2 events, received %d", received)
	}
}

func TestEventBus_SessionFilter(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	// Subscribe to specific session
	sub := eb.Subscribe(ctx, EventFilter{
		SessionID: "session-123",
	})

	// Publish events for different sessions
	eb.Publish(Event{
		Type: EventSessionStatusChanged,
		Data: map[string]interface{}{"session_id": "session-123"},
	})
	eb.Publish(Event{
		Type: EventSessionStatusChanged,
		Data: map[string]interface{}{"session_id": "session-456"},
	})
	eb.Publish(Event{
		Type: EventSessionStatusChanged,
		Data: map[string]interface{}{"session_id": "session-123"},
	})

	// Should receive only events for session-123
	received := 0
	timeout := time.After(100 * time.Millisecond)

	for {
		select {
		case event := <-sub.Channel:
			received++
			if sessionID, ok := event.Data["session_id"].(string); !ok || sessionID != "session-123" {
				t.Errorf("received event for wrong session: %v", event.Data["session_id"])
			}
		case <-timeout:
			goto done
		}
	}

done:
	if received != 2 {
		t.Errorf("expected 2 events, received %d", received)
	}
}

func TestEventBus_ConcurrentPublishSubscribe(t *testing.T) {
	eb := NewEventBus()
	ctx := context.Background()

	// Create multiple subscribers
	numSubscribers := 10
	subscribers := make([]*Subscriber, numSubscribers)
	for i := 0; i < numSubscribers; i++ {
		subscribers[i] = eb.Subscribe(ctx, EventFilter{})
	}

	// Publish events concurrently
	numEvents := 100
	var wg sync.WaitGroup
	wg.Add(numEvents)

	for i := 0; i < numEvents; i++ {
		go func(n int) {
			defer wg.Done()
			eb.Publish(Event{
				Type: EventNewApproval,
				Data: map[string]interface{}{"event_num": n},
			})
		}(i)
	}

	wg.Wait()

	// Give a small delay for events to propagate
	time.Sleep(100 * time.Millisecond)

	// Verify each subscriber received all events
	for i, sub := range subscribers {
		received := 0

		// Drain the channel
		for {
			select {
			case <-sub.Channel:
				received++
			default:
				// No more events
				goto checkCount
			}
		}

	checkCount:
		if received != numEvents {
			t.Errorf("subscriber %d: expected %d events, received %d", i, numEvents, received)
		}
	}
}

func TestEventBus_SlowSubscriber(t *testing.T) {
	eb := NewEventBus().(*eventBus) // Need concrete type to check buffer size
	eb.bufferSize = 5               // Small buffer for testing
	ctx := context.Background()

	// Create a slow subscriber that doesn't read events
	sub := eb.Subscribe(ctx, EventFilter{})

	// Publish more events than buffer size
	for i := 0; i < 10; i++ {
		eb.Publish(Event{
			Type: EventNewApproval,
			Data: map[string]interface{}{"num": i},
		})
	}

	// Now read events - should only get buffer size worth
	received := 0
	timeout := time.After(100 * time.Millisecond)

	for {
		select {
		case <-sub.Channel:
			received++
		case <-timeout:
			goto done
		}
	}

done:
	// Should have received only up to buffer size
	if received > eb.bufferSize {
		t.Errorf("expected at most %d events, received %d", eb.bufferSize, received)
	}
}

func TestEventBus_ContextCancellation(t *testing.T) {
	eb := NewEventBus()
	ctx, cancel := context.WithCancel(context.Background())

	sub := eb.Subscribe(ctx, EventFilter{})
	initialCount := eb.GetSubscriberCount()

	// Cancel context
	cancel()

	// Give cleanup goroutine time to run
	time.Sleep(50 * time.Millisecond)

	// Verify subscriber was removed
	if count := eb.GetSubscriberCount(); count != initialCount-1 {
		t.Errorf("expected %d subscribers after context cancel, got %d", initialCount-1, count)
	}

	// Verify channel is closed
	select {
	case _, ok := <-sub.Channel:
		if ok {
			t.Error("expected channel to be closed after context cancel")
		}
	default:
		// Channel might be empty but should be closed
	}
}
