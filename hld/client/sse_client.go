package client

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/url"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/r3labs/sse/v2"
)

// EventFilter defines criteria for filtering events
type EventFilter struct {
	Types     []bus.EventType
	SessionID string
	RunID     string
}

// SSEClient wraps the REST client with SSE capabilities
type SSEClient struct {
	*RESTClient
	baseURL string
}

// NewSSEClient creates a new SSE-capable client
func NewSSEClient(baseURL string) *SSEClient {
	return &SSEClient{
		RESTClient: NewRESTClient(baseURL),
		baseURL:    baseURL,
	}
}

// SubscribeToEvents creates an SSE subscription using r3labs/sse
func (c *SSEClient) SubscribeToEvents(ctx context.Context, filter EventFilter) (<-chan bus.Event, error) {
	// Using r3labs/sse client for SSE handling
	client := sse.NewClient(c.baseURL + "/stream/events")

	// Add query parameters
	params := url.Values{}
	if filter.SessionID != "" {
		params.Set("sessionId", filter.SessionID)
	}
	if filter.RunID != "" {
		params.Set("runId", filter.RunID)
	}
	if len(filter.Types) > 0 {
		for _, t := range filter.Types {
			params.Add("types", string(t))
		}
	}
	if len(params) > 0 {
		client.URL += "?" + params.Encode()
	}

	events := make(chan bus.Event, 100)

	go func() {
		defer close(events)

		err := client.SubscribeWithContext(ctx, "", func(msg *sse.Event) {
			if len(msg.Event) == 0 || string(msg.Event) == "message" {
				var event bus.Event
				if err := json.Unmarshal([]byte(msg.Data), &event); err == nil {
					select {
					case events <- event:
					case <-ctx.Done():
						return
					}
				}
			}
		})

		if err != nil {
			// Log the subscription error with context
			slog.Error("SSE subscription failed",
				"error", err,
				"base_url", c.baseURL,
				"filter_session_id", filter.SessionID,
			)

			// Send error as a special event type to notify consumers
			errorEvent := bus.Event{
				Type: bus.EventType("subscription_error"),
				Data: map[string]interface{}{
					"error":  err.Error(),
					"filter": filter,
				},
				Timestamp: time.Now(),
			}

			select {
			case events <- errorEvent:
				// Error event sent successfully
			case <-ctx.Done():
				// Context already cancelled, skip sending error
			}
		}
	}()

	return events, nil
}
