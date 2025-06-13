// Package api provides thin wrappers around daemon RPC communication.
// This package contains interfaces and implementations for interacting
// with the HumanLayer daemon API.
package api

import (
	tea "github.com/charmbracelet/bubbletea"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// Client is a thin wrapper around the daemon RPC client
// It returns tea.Cmd for Bubble Tea integration but contains no UI logic
type Client interface {
	// ApprovalClient provides approval-related operations
	ApprovalClient
	// SessionClient provides session-related operations
	SessionClient
	// ConversationClient provides conversation-related operations
	ConversationClient
	// EventClient provides event subscription operations
	EventClient
}

// ApprovalClient handles approval-related API operations
type ApprovalClient interface {
	// FetchRequests fetches all pending requests (approvals and human contacts)
	FetchRequests() tea.Cmd

	// FetchSessionApprovals fetches approvals for a specific session
	FetchSessionApprovals(sessionID string) tea.Cmd

	// SendApproval sends an approval decision for a function call
	SendApproval(callID string, approved bool, comment string) tea.Cmd

	// SendHumanResponse sends a response to a human contact request
	SendHumanResponse(requestID string, response string) tea.Cmd
}

// SessionClient handles session-related API operations
type SessionClient interface {
	// FetchSessions fetches all sessions from the daemon
	FetchSessions() tea.Cmd

	// LaunchSession launches a new session with the given parameters
	LaunchSession(query, model, workingDir string) tea.Cmd

	// ContinueSession continues an existing session with a new query
	ContinueSession(sessionID, query string) tea.Cmd
}

// ConversationClient handles conversation-related API operations
type ConversationClient interface {
	// FetchConversation fetches conversation state and events for a session
	FetchConversation(sessionID string) tea.Cmd

	// FetchConversationSilent fetches conversation without showing loading state (for polling)
	FetchConversationSilent(sessionID string) tea.Cmd
}

// EventClient handles event subscription operations
type EventClient interface {
	// SubscribeToEvents subscribes to daemon events
	SubscribeToEvents() tea.Cmd

	// ListenForEvents listens for events on the subscription channel
	ListenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd
}

// LaunchSessionConfig holds configuration for launching a new session
type LaunchSessionConfig struct {
	Query      string
	Model      string
	WorkingDir string
	MCPConfig  *claudecode.MCPConfig
}

// FetchRequestsResult holds the result of fetching requests
type FetchRequestsResult struct {
	Requests []domain.Request
	Error    error
}

// FetchSessionsResult holds the result of fetching sessions
type FetchSessionsResult struct {
	Sessions []session.Info
	Error    error
}

// LaunchSessionResult holds the result of launching a session
type LaunchSessionResult struct {
	SessionID string
	RunID     string
	Error     error
}

// ApprovalSentResult holds the result of sending an approval
type ApprovalSentResult struct {
	RequestID string
	Approved  bool
	Error     error
}

// HumanResponseSentResult holds the result of sending a human response
type HumanResponseSentResult struct {
	RequestID string
	Error     error
}

// ConversationResult holds the result of fetching a conversation
type ConversationResult struct {
	Session *rpc.SessionState
	Events  []rpc.ConversationEvent
	Error   error
}

// ContinueSessionResult holds the result of continuing a session
type ContinueSessionResult struct {
	SessionID       string
	ClaudeSessionID string
	Error           error
}

// SubscriptionResult holds the result of subscribing to events
type SubscriptionResult struct {
	EventChannel <-chan rpc.EventNotification
	Error        error
}

// EventNotificationResult holds an event notification
type EventNotificationResult struct {
	Event rpc.EventNotification
}
