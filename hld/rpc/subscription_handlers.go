package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
)

// SubscriptionHandlers provides RPC handlers for event subscriptions
type SubscriptionHandlers struct {
	eventBus bus.EventBus
}

// NewSubscriptionHandlers creates new subscription RPC handlers
func NewSubscriptionHandlers(eventBus bus.EventBus) *SubscriptionHandlers {
	return &SubscriptionHandlers{
		eventBus: eventBus,
	}
}

// Register adds the subscription handlers to the RPC server
func (h *SubscriptionHandlers) Register(server *Server) {
	server.Register("Subscribe", h.HandleSubscribe)
}

// SubscribeRequest is the request for subscribing to events
type SubscribeRequest struct {
	EventTypes []string `json:"event_types,omitempty"` // Optional filter by event types
	SessionID  string   `json:"session_id,omitempty"`  // Optional filter by session
	RunID      string   `json:"run_id,omitempty"`      // Optional filter by run ID
}

// SubscribeResponse is sent when subscription is established
type SubscribeResponse struct {
	SubscriptionID string `json:"subscription_id"`
	Message        string `json:"message"`
}

// EventNotification is sent to subscribers when events occur
type EventNotification struct {
	Event bus.Event `json:"event"`
}

// HandleSubscribe handles the Subscribe RPC method with long-polling
func (h *SubscriptionHandlers) HandleSubscribe(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req SubscribeRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, fmt.Errorf("invalid request: %w", err)
		}
	}

	// This is a special handler that needs access to the connection
	// We'll need to modify how this works to support long-polling
	return nil, fmt.Errorf("Subscribe method requires special handling - use SubscribeConn instead")
}

// SubscribeConn handles a subscription connection with long-polling
// This method is called directly by the server for special handling
func (h *SubscriptionHandlers) SubscribeConn(ctx context.Context, conn net.Conn, params json.RawMessage) error {
	var req SubscribeRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			// Send error response
			resp := &Response{
				JSONRPC: "2.0",
				Error: &Error{
					Code:    InvalidParams,
					Message: fmt.Sprintf("invalid request: %v", err),
				},
			}
			return sendJSONResponse(conn, resp)
		}
	}

	// Convert string event types to bus.EventType
	var eventTypes []bus.EventType
	for _, t := range req.EventTypes {
		eventTypes = append(eventTypes, bus.EventType(t))
	}

	// Create event filter
	filter := bus.EventFilter{
		Types:     eventTypes,
		SessionID: req.SessionID,
		RunID:     req.RunID,
	}

	// Subscribe to events
	sub := h.eventBus.Subscribe(ctx, filter)
	defer func() {
		slog.Debug("subscription handler cleaning up", "subscription_id", sub.ID)
		h.eventBus.Unsubscribe(sub.ID)
	}()

	slog.Info("client subscribed to events",
		"subscription_id", sub.ID,
		"event_types", req.EventTypes,
		"session_id", req.SessionID,
		"run_id", req.RunID,
	)

	// Send initial success response
	resp := &Response{
		JSONRPC: "2.0",
		Result: &SubscribeResponse{
			SubscriptionID: sub.ID,
			Message:        "Subscription established. Waiting for events...",
		},
	}
	if err := sendJSONResponse(conn, resp); err != nil {
		return fmt.Errorf("failed to send subscription response: %w", err)
	}

	// Create a context that cancels when connection closes
	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()

	// Monitor connection in a separate goroutine
	go func() {
		// Try to read from connection - will fail when closed
		buf := make([]byte, 1)
		for {
			conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			_, err := conn.Read(buf)
			if err != nil {
				// Check if it's a timeout error (which is expected)
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					// Timeout is expected, continue monitoring
					continue
				}
				// Real error or connection closed
				slog.Debug("subscription connection closed",
					"subscription_id", sub.ID,
					"error", err,
				)
				connCancel()
				return
			}
		}
	}()

	// Long-poll for events
	for {
		select {
		case <-connCtx.Done():
			return connCtx.Err()

		case event, ok := <-sub.Channel:
			if !ok {
				// Channel closed, subscription ended
				return nil
			}

			// Validate event before sending
			if event.Type == "" {
				slog.Error("received event with empty type, skipping",
					"subscription_id", sub.ID,
					"event_data", event.Data,
				)
				continue
			}

			// Send event notification
			notification := &Response{
				JSONRPC: "2.0",
				Result: &EventNotification{
					Event: event,
				},
			}
			if err := sendJSONResponse(conn, notification); err != nil {
				return fmt.Errorf("failed to send event notification: %w", err)
			}

			slog.Debug("sent event notification",
				"subscription_id", sub.ID,
				"event_type", event.Type,
			)

		case <-time.After(30 * time.Second):
			// Send heartbeat to keep connection alive
			heartbeat := &Response{
				JSONRPC: "2.0",
				Result: map[string]interface{}{
					"type":    "heartbeat",
					"message": "Connection alive",
				},
			}
			if err := sendJSONResponse(conn, heartbeat); err != nil {
				return fmt.Errorf("failed to send heartbeat: %w", err)
			}
		}
	}
}

// sendJSONResponse writes a JSON response followed by newline
func sendJSONResponse(conn net.Conn, resp interface{}) error {
	data, err := json.Marshal(resp)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	if _, err := conn.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("failed to write response: %w", err)
	}

	return nil
}
