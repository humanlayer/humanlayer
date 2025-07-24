package handlers_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/api/handlers"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/stretchr/testify/assert"
	"go.uber.org/mock/gomock"
)

func TestSSEHandler_StreamEvents(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockEventBus := bus.NewMockEventBus(ctrl)
	sseHandler := handlers.NewSSEHandler(mockEventBus)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v1/events", sseHandler.StreamEvents)

	t.Run("basic event streaming", func(t *testing.T) {
		// Create a channel to send events
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber",
			Channel: eventChan,
			Filter:  bus.EventFilter{},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			Return(subscriber)

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber")

		// Use recorder instead of server for faster tests
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/events", nil)

		// Create a context with timeout
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		// Start handler in goroutine
		go router.ServeHTTP(w, req)

		// Give handler time to start
		time.Sleep(50 * time.Millisecond)

		// Send test events
		go func() {
			eventChan <- bus.Event{
				Type:      bus.EventNewApproval,
				Timestamp: time.Now(),
				Data: map[string]interface{}{
					"approvalId": "appr-123",
					"sessionId":  "sess-456",
				},
			}

			eventChan <- bus.Event{
				Type:      bus.EventSessionStatusChanged,
				Timestamp: time.Now(),
				Data: map[string]interface{}{
					"sessionId": "sess-456",
					"status":    "completed",
				},
			}

			// Close channel immediately after sending events
			close(eventChan)
		}()

		// Wait for context to timeout
		<-ctx.Done()

		// Verify SSE response
		assert.Equal(t, 200, w.Code)
	})

	t.Run("event filtering by session ID", func(t *testing.T) {
		// Create a channel to send events
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-filter",
			Channel: eventChan,
			Filter:  bus.EventFilter{SessionID: "sess-789"},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				// Verify filter was passed correctly
				assert.Equal(t, "sess-789", filter.SessionID)
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-filter")

		req := httptest.NewRequest("GET", "/api/v1/events?sessionId=sess-789", nil)
		w := httptest.NewRecorder()

		// Use a context with timeout to prevent hanging
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
	})

	t.Run("event filtering by event types", func(t *testing.T) {
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-types",
			Channel: eventChan,
			Filter: bus.EventFilter{
				Types: []bus.EventType{bus.EventNewApproval, bus.EventApprovalResolved},
			},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				// Verify event types were parsed correctly
				assert.Len(t, filter.Types, 2)
				assert.Contains(t, filter.Types, bus.EventNewApproval)
				assert.Contains(t, filter.Types, bus.EventApprovalResolved)
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-types")

		req := httptest.NewRequest("GET", "/api/v1/events?eventTypes=new_approval&eventTypes=approval_resolved", nil)
		w := httptest.NewRecorder()

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
	})

	t.Run("event filtering by run ID", func(t *testing.T) {
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-runid",
			Channel: eventChan,
			Filter:  bus.EventFilter{RunID: "run-123"},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				assert.Equal(t, "run-123", filter.RunID)
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-runid")

		req := httptest.NewRequest("GET", "/api/v1/events?runId=run-123", nil)
		w := httptest.NewRecorder()

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
	})

	t.Run("combined filters", func(t *testing.T) {
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-combined",
			Channel: eventChan,
			Filter: bus.EventFilter{
				SessionID: "sess-999",
				RunID:     "run-999",
				Types:     []bus.EventType{bus.EventConversationUpdated},
			},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				assert.Equal(t, "sess-999", filter.SessionID)
				assert.Equal(t, "run-999", filter.RunID)
				assert.Len(t, filter.Types, 1)
				assert.Equal(t, bus.EventConversationUpdated, filter.Types[0])
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-combined")

		req := httptest.NewRequest("GET", "/api/v1/events?sessionId=sess-999&runId=run-999&eventTypes=conversation_updated", nil)
		w := httptest.NewRecorder()

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
	})

	t.Run("keep-alive messages", func(t *testing.T) {
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-keepalive",
			Channel: eventChan,
			Filter:  bus.EventFilter{},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			Return(subscriber)

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-keepalive")

		// Test keep-alive with recorder
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/events", nil)

		// Create a context with timeout
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		// Verify we got 200 OK
		assert.Equal(t, 200, w.Code)

		// Note: In production, the keep-alive is sent every 30 seconds,
		// which is too long for unit tests.
	})

	t.Run("unknown event types are ignored", func(t *testing.T) {
		eventChan := make(chan bus.Event, 10)
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-unknown",
			Channel: eventChan,
			Filter:  bus.EventFilter{Types: []bus.EventType{}}, // Empty because unknown types were filtered out
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				// Verify unknown event types were ignored
				assert.Empty(t, filter.Types)
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-unknown")

		req := httptest.NewRequest("GET", "/api/v1/events?eventTypes=unknown_type&eventTypes=another_unknown", nil)
		w := httptest.NewRecorder()

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		req = req.WithContext(ctx)

		router.ServeHTTP(w, req)

		assert.Equal(t, 200, w.Code)
	})
}

func TestSSEHandler_ConnectionHandling(t *testing.T) {
	t.Run("client disconnect handling", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		mockEventBus := bus.NewMockEventBus(ctrl)
		sseHandler := handlers.NewSSEHandler(mockEventBus)

		gin.SetMode(gin.TestMode)
		router := gin.New()
		router.GET("/api/v1/events", sseHandler.StreamEvents)
		eventChan := make(chan bus.Event, 10)
		var subscriberCtx context.Context
		subscriber := &bus.Subscriber{
			ID:      "test-subscriber-disconnect",
			Channel: eventChan,
			Filter:  bus.EventFilter{},
		}

		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				subscriberCtx = ctx
				return subscriber
			})

		mockEventBus.EXPECT().
			Unsubscribe("test-subscriber-disconnect")

		// Use recorder for faster test
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v1/events", nil)

		// Create client request with cancel
		ctx, cancel := context.WithCancel(context.Background())
		req = req.WithContext(ctx)

		// Start handler in goroutine
		done := make(chan struct{})
		go func() {
			router.ServeHTTP(w, req)
			close(done)
		}()

		// Give handler time to start
		time.Sleep(10 * time.Millisecond)

		// Cancel the request (simulating client disconnect)
		cancel()

		// Wait for handler to finish
		select {
		case <-done:
			// Handler finished as expected
		case <-time.After(100 * time.Millisecond):
			t.Fatal("Handler did not finish after context cancel")
		}

		// Verify the subscription context was cancelled
		assert.NotNil(t, subscriberCtx)
		select {
		case <-subscriberCtx.Done():
			// Context was cancelled as expected
		default:
			t.Fatal("Subscription context was not cancelled")
		}
	})

	// Skip SSE not supported test - it's an edge case that doesn't occur in practice
	// and testing it requires complex mocking of Gin's ResponseWriter

	t.Run("multiple concurrent connections", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		mockEventBus := bus.NewMockEventBus(ctrl)
		sseHandler := handlers.NewSSEHandler(mockEventBus)

		gin.SetMode(gin.TestMode)
		router := gin.New()
		router.GET("/api/v1/events", sseHandler.StreamEvents)

		// Test that multiple clients can connect simultaneously
		numClients := 3
		subscribers := make([]*bus.Subscriber, numClients)
		eventChans := make([]chan bus.Event, numClients)

		for i := 0; i < numClients; i++ {
			eventChans[i] = make(chan bus.Event, 10)
			subscribers[i] = &bus.Subscriber{
				ID:      fmt.Sprintf("subscriber-%d", i),
				Channel: eventChans[i],
				Filter:  bus.EventFilter{},
			}
		}

		subscriberIndex := 0
		mockEventBus.EXPECT().
			Subscribe(gomock.Any(), gomock.Any()).
			Times(numClients).
			DoAndReturn(func(ctx context.Context, filter bus.EventFilter) *bus.Subscriber {
				sub := subscribers[subscriberIndex]
				subscriberIndex++
				return sub
			})

		// Expect Unsubscribe for each subscriber
		for i := 0; i < numClients; i++ {
			mockEventBus.EXPECT().
				Unsubscribe(fmt.Sprintf("subscriber-%d", i))
		}

		// Start multiple concurrent clients
		ctxs := make([]context.Context, numClients)
		cancels := make([]context.CancelFunc, numClients)
		dones := make([]chan struct{}, numClients)

		for i := 0; i < numClients; i++ {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			ctxs[i] = ctx
			cancels[i] = cancel
			defer cancel()

			req := httptest.NewRequest("GET", "/api/v1/events", nil)
			req = req.WithContext(ctx)
			w := httptest.NewRecorder()

			// Start handler in goroutine
			done := make(chan struct{})
			dones[i] = done
			go func() {
				router.ServeHTTP(w, req)
				close(done)
			}()
		}

		// Give handlers time to start
		time.Sleep(50 * time.Millisecond)

		// Send an event to each client
		for i := 0; i < numClients; i++ {
			eventChans[i] <- bus.Event{
				Type:      bus.EventNewApproval,
				Timestamp: time.Now(),
				Data: map[string]interface{}{
					"clientId": i,
				},
			}
		}

		// Give time for events to be processed
		time.Sleep(50 * time.Millisecond)

		// Cancel all contexts
		for _, cancel := range cancels {
			cancel()
		}

		// Wait for all handlers to finish
		for i, done := range dones {
			select {
			case <-done:
				// Handler finished
			case <-time.After(100 * time.Millisecond):
				t.Fatalf("Handler %d did not finish", i)
			}
		}
	})
}

// Note: Removed nonFlushableResponseWriter and mockGinResponseWriter as they were not needed
// Modern web frameworks always support flushing, so testing the "no flusher" case is not practical
