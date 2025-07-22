package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/humanlayer/humanlayer/hld/bus"
)

type SSEHandler struct {
	eventBus bus.EventBus
}

func NewSSEHandler(eventBus bus.EventBus) *SSEHandler {
	return &SSEHandler{eventBus: eventBus}
}

// parseEventTypes converts string slice to EventType slice
func parseEventTypes(types []string) []bus.EventType {
	eventTypes := make([]bus.EventType, 0, len(types))
	for _, t := range types {
		switch t {
		case "new_approval":
			eventTypes = append(eventTypes, bus.EventNewApproval)
		case "approval_resolved":
			eventTypes = append(eventTypes, bus.EventApprovalResolved)
		case "session_status_changed":
			eventTypes = append(eventTypes, bus.EventSessionStatusChanged)
		case "conversation_updated":
			eventTypes = append(eventTypes, bus.EventConversationUpdated)
		}
		// Ignore unknown event types
	}
	return eventTypes
}

func (h *SSEHandler) StreamEvents(c *gin.Context) {
	w := c.Writer
	r := c.Request
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Parse filters from query params
	filter := bus.EventFilter{}
	if types := r.URL.Query()["eventTypes"]; len(types) > 0 {
		filter.Types = parseEventTypes(types)
	}
	if sessionID := r.URL.Query().Get("sessionId"); sessionID != "" {
		filter.SessionID = sessionID
	}
	if runID := r.URL.Query().Get("runId"); runID != "" {
		filter.RunID = runID
	}

	// Subscribe to events
	subscriber := h.eventBus.Subscribe(r.Context(), filter)
	defer h.eventBus.Unsubscribe(subscriber.ID)

	// Create ticker for keepalive
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	for {
		select {
		case <-r.Context().Done():
			return

		case event := <-subscriber.Channel:
			data, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
				// Client disconnected
				return
			}
			flusher.Flush()

		case <-ticker.C:
			if _, err := fmt.Fprintf(w, ": keepalive\n\n"); err != nil {
				// Client disconnected
				return
			}
			flusher.Flush()
		}
	}
}
