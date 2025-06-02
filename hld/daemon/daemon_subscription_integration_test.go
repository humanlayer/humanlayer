//go:build integration

package daemon

import (
	"context"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

func TestDaemonSubscriptionIntegration(t *testing.T) {
	// Set up test config
	socketPath := testutil.CreateTestSocket(t)
	t.Setenv("HUMANLAYER_SOCKET_PATH", socketPath)
	t.Setenv("HUMANLAYER_LOG_LEVEL", "error")

	// Create and start daemon
	daemon, err := New()
	if err != nil {
		t.Fatalf("Failed to create daemon: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	go func() {
		if err := daemon.Run(ctx); err != nil {
			t.Logf("Daemon error: %v", err)
		}
	}()

	// Wait for daemon to start
	time.Sleep(100 * time.Millisecond)

	t.Run("multiple_clients_subscribe", func(t *testing.T) {
		// Create multiple clients
		numClients := 10
		clients := make([]client.Client, numClients)
		eventChans := make([]<-chan rpc.EventNotification, numClients)

		// Connect all clients and subscribe
		for i := 0; i < numClients; i++ {
			c, err := client.New(socketPath)
			if err != nil {
				t.Fatalf("Failed to create client %d: %v", i, err)
			}
			clients[i] = c
			defer c.Close()

			// Subscribe to events
			eventChan, err := c.Subscribe(rpc.SubscribeRequest{
				EventTypes: []string{
					string(bus.EventNewApproval),
					string(bus.EventApprovalResolved),
				},
			})
			if err != nil {
				t.Fatalf("Client %d failed to subscribe: %v", i, err)
			}
			eventChans[i] = eventChan
		}

		// Verify all clients get subscriber count
		if subCount := daemon.eventBus.GetSubscriberCount(); subCount != numClients {
			t.Errorf("Expected %d subscribers, got %d", numClients, subCount)
		}

		// Publish an event
		testEvent := bus.Event{
			Type: bus.EventNewApproval,
			Data: map[string]interface{}{
				"type":  "function_call",
				"count": 1,
			},
		}
		daemon.eventBus.Publish(testEvent)

		// Verify all clients receive the event
		receivedCount := 0
		timeout := time.After(2 * time.Second)

		for i := 0; i < numClients; i++ {
			select {
			case notification := <-eventChans[i]:
				if notification.Event.Type == bus.EventNewApproval {
					receivedCount++
				}
			case <-timeout:
				t.Errorf("Client %d timeout waiting for event", i)
			}
		}

		if receivedCount != numClients {
			t.Errorf("Expected %d clients to receive event, but %d did", numClients, receivedCount)
		}
	})

	t.Run("filtered_subscriptions", func(t *testing.T) {
		// Create clients with different filters
		c1, err := client.New(socketPath)
		if err != nil {
			t.Fatalf("Failed to create client 1: %v", err)
		}
		defer c1.Close()

		c2, err := client.New(socketPath)
		if err != nil {
			t.Fatalf("Failed to create client 2: %v", err)
		}
		defer c2.Close()

		// Client 1 subscribes only to new approvals
		eventChan1, err := c1.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{string(bus.EventNewApproval)},
		})
		if err != nil {
			t.Fatalf("Client 1 failed to subscribe: %v", err)
		}

		// Client 2 subscribes only to resolved approvals
		eventChan2, err := c2.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{string(bus.EventApprovalResolved)},
		})
		if err != nil {
			t.Fatalf("Client 2 failed to subscribe: %v", err)
		}

		// Publish different events
		daemon.eventBus.Publish(bus.Event{
			Type: bus.EventNewApproval,
			Data: map[string]interface{}{"test": "new"},
		})

		daemon.eventBus.Publish(bus.Event{
			Type: bus.EventApprovalResolved,
			Data: map[string]interface{}{"test": "resolved"},
		})

		// Verify client 1 only gets new approval
		select {
		case notification := <-eventChan1:
			if notification.Event.Type != bus.EventNewApproval {
				t.Errorf("Client 1 received wrong event type: %v", notification.Event.Type)
			}
		case <-time.After(1 * time.Second):
			t.Error("Client 1 timeout waiting for new approval event")
		}

		// Verify client 2 only gets resolved approval
		select {
		case notification := <-eventChan2:
			if notification.Event.Type != bus.EventApprovalResolved {
				t.Errorf("Client 2 received wrong event type: %v", notification.Event.Type)
			}
		case <-time.After(1 * time.Second):
			t.Error("Client 2 timeout waiting for resolved approval event")
		}

		// Make sure client 1 doesn't get resolved events
		select {
		case notification, ok := <-eventChan1:
			if ok && notification.Event.Type != "" {
				t.Errorf("Client 1 unexpectedly received event - Type: %q, Data: %+v", notification.Event.Type, notification.Event.Data)
			}
			// If channel is closed (!ok) or empty event, that's fine during cleanup
		case <-time.After(100 * time.Millisecond):
			// Expected - no event
		}
	})

	t.Run("subscription_disconnect_reconnect", func(t *testing.T) {
		// Create a client and subscribe
		c, err := client.New(socketPath)
		if err != nil {
			t.Fatalf("Failed to create client: %v", err)
		}

		eventChan, err := c.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{string(bus.EventNewApproval)},
		})
		if err != nil {
			t.Fatalf("Failed to subscribe: %v", err)
		}

		// Close the client (simulating disconnect)
		c.Close()

		// Wait for cleanup
		time.Sleep(100 * time.Millisecond)

		// Event channel should be closed
		select {
		case _, ok := <-eventChan:
			if ok {
				t.Error("Expected event channel to be closed after disconnect")
			}
		case <-time.After(1 * time.Second):
			t.Error("Event channel not closed after disconnect")
		}

		// Create new client and subscribe again
		c2, err := client.New(socketPath)
		if err != nil {
			t.Fatalf("Failed to create new client: %v", err)
		}
		defer c2.Close()

		eventChan2, err := c2.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{string(bus.EventNewApproval)},
		})
		if err != nil {
			t.Fatalf("Failed to resubscribe: %v", err)
		}

		// Publish event and verify new client receives it
		daemon.eventBus.Publish(bus.Event{
			Type: bus.EventNewApproval,
			Data: map[string]interface{}{"test": "reconnect"},
		})

		select {
		case notification := <-eventChan2:
			if notification.Event.Type != bus.EventNewApproval {
				t.Errorf("Unexpected event type: %v", notification.Event.Type)
			}
		case <-time.After(1 * time.Second):
			t.Error("Timeout waiting for event after reconnect")
		}
	})
}

func TestDaemonMemoryStability(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping memory stability test in short mode")
	}

	// Set up test config
	socketPath := testutil.CreateTestSocket(t)
	t.Setenv("HUMANLAYER_SOCKET_PATH", socketPath)
	t.Setenv("HUMANLAYER_LOG_LEVEL", "error")

	// Create and start daemon
	daemon, err := New()
	if err != nil {
		t.Fatalf("Failed to create daemon: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start daemon in background
	go func() {
		if err := daemon.Run(ctx); err != nil {
			t.Logf("Daemon error: %v", err)
		}
	}()

	// Wait for daemon to start
	time.Sleep(100 * time.Millisecond)

	// Simulate clients connecting and disconnecting repeatedly
	for i := 0; i < 100; i++ {
		c, err := client.New(socketPath)
		if err != nil {
			t.Fatalf("Failed to create client %d: %v", i, err)
		}

		// Subscribe
		eventChan, err := c.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{string(bus.EventNewApproval)},
		})
		if err != nil {
			t.Fatalf("Client %d failed to subscribe: %v", i, err)
		}

		// Publish some events
		for j := 0; j < 10; j++ {
			daemon.eventBus.Publish(bus.Event{
				Type: bus.EventNewApproval,
				Data: map[string]interface{}{"iteration": i, "event": j},
			})
		}

		// Read some events
		eventsReceived := 0
		timeout := time.After(100 * time.Millisecond)
	readLoop:
		for {
			select {
			case <-eventChan:
				eventsReceived++
			case <-timeout:
				break readLoop
			}
		}

		// Close client
		c.Close()

		// Small delay between iterations
		time.Sleep(10 * time.Millisecond)
	}

	// Check final subscriber count (should be 0)
	finalCount := daemon.eventBus.GetSubscriberCount()
	if finalCount != 0 {
		t.Errorf("Expected 0 subscribers after all clients disconnected, got %d", finalCount)
	}
}
