// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// FetchConversation fetches conversation state and events for a session
func (c *clientImpl) FetchConversation(sessionID string) tea.Cmd {
	return func() tea.Msg {
		var session *rpc.SessionState
		var events []rpc.ConversationEvent

		// Fetch session state first
		if sessionID == "" {
			return domain.FetchConversationMsg{Err: fmt.Errorf("no session ID provided")}
		}

		sessionResp, err := c.daemonClient.GetSessionState(sessionID)
		if err != nil {
			return domain.FetchConversationMsg{Err: err}
		}
		session = &sessionResp.Session

		// Fetch conversation events using session ID
		convResp, err := c.daemonClient.GetConversation(sessionID)
		if err != nil {
			return domain.FetchConversationMsg{Err: err}
		}

		events = convResp.Events

		return domain.FetchConversationMsg{
			Session: session,
			Events:  events,
		}
	}
}

// FetchConversationSilent fetches conversation without showing loading state (for polling)
func (c *clientImpl) FetchConversationSilent(sessionID string) tea.Cmd {
	return func() tea.Msg {
		var session *rpc.SessionState
		var events []rpc.ConversationEvent

		// Fetch session state first
		if sessionID == "" {
			return domain.FetchConversationMsg{Err: fmt.Errorf("no session ID provided")}
		}

		sessionResp, err := c.daemonClient.GetSessionState(sessionID)
		if err != nil {
			return domain.FetchConversationMsg{Err: err}
		}
		session = &sessionResp.Session

		// Fetch conversation events using session ID
		convResp, err := c.daemonClient.GetConversation(sessionID)
		if err != nil {
			return domain.FetchConversationMsg{Err: err}
		}

		events = convResp.Events

		return domain.FetchConversationMsg{
			Session: session,
			Events:  events,
		}
	}
}
