// Package domain contains the pure business logic of the application.
package domain

import (
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
)

// ErrMsg represents an error message for the Bubble Tea framework
type ErrMsg struct {
	Err error
}

// FetchRequestsMsg contains the result of fetching approval requests
type FetchRequestsMsg struct {
	Requests []Request
	Err      error
}

// FetchSessionsMsg contains the result of fetching sessions
type FetchSessionsMsg struct {
	Sessions []session.Info
	Err      error
}

// LaunchSessionMsg contains the result of launching a new session
type LaunchSessionMsg struct {
	SessionID string
	RunID     string
	Err       error
}

// FetchSessionApprovalsMsg contains the result of fetching approvals for a session
type FetchSessionApprovalsMsg struct {
	Approvals []Request
	Err       error
}

// ApprovalSentMsg contains the result of sending an approval decision
type ApprovalSentMsg struct {
	RequestID string
	Approved  bool
	Err       error
}

// HumanResponseSentMsg contains the result of sending a human response
type HumanResponseSentMsg struct {
	RequestID string
	Err       error
}

// SubscriptionMsg contains the event channel from subscription
type SubscriptionMsg struct {
	EventChannel <-chan rpc.EventNotification
	Err          error
}

// EventNotificationMsg wraps an event notification
type EventNotificationMsg struct {
	Event rpc.EventNotification
}

// FetchConversationMsg contains the result of fetching conversation data
type FetchConversationMsg struct {
	Session *rpc.SessionState
	Events  []rpc.ConversationEvent
	Err     error
}

// ContinueSessionMsg contains the result of continuing a session
type ContinueSessionMsg struct {
	SessionID       string
	ClaudeSessionID string
	Err             error
}

// PollRefreshMsg triggers a refresh for a specific session during polling
type PollRefreshMsg struct {
	SessionID string
}

// TickMsg represents a timer tick
type TickMsg time.Time
