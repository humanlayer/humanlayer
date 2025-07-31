package bus

import (
	"context"
	"time"
)

// EventType represents the type of event
type EventType string

const (
	// EventNewApproval indicates new approval(s) have been received
	EventNewApproval EventType = "new_approval"
	// EventApprovalResolved indicates an approval has been resolved (approved/denied/responded)
	EventApprovalResolved EventType = "approval_resolved"
	// EventSessionStatusChanged indicates a session status has changed
	EventSessionStatusChanged EventType = "session_status_changed"
	// EventConversationUpdated indicates new conversation content has been added to a session
	EventConversationUpdated EventType = "conversation_updated"
	// EventSessionSettingsChanged indicates session settings have been updated
	EventSessionSettingsChanged EventType = "session_settings_changed"
)

// Event represents an event in the system
type Event struct {
	Type      EventType              `json:"type"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

// EventFilter allows filtering events by criteria
type EventFilter struct {
	Types     []EventType // Empty means all types
	SessionID string      // Empty means all sessions
	RunID     string      // Empty means all run IDs
}

// Subscriber represents a client subscribed to events
type Subscriber struct {
	ID       string
	Channel  chan Event
	Filter   EventFilter
	ctx      context.Context
	cancelFn context.CancelFunc
}

// EventBus defines the interface for the event bus
type EventBus interface {
	// Subscribe creates a new subscription with the given filter
	Subscribe(ctx context.Context, filter EventFilter) *Subscriber
	// Unsubscribe removes a subscription
	Unsubscribe(subscriberID string)
	// Publish sends an event to all matching subscribers
	Publish(event Event)
	// GetSubscriberCount returns the current number of subscribers
	GetSubscriberCount() int
}
