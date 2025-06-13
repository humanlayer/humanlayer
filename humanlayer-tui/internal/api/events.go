// Package api provides thin wrappers around daemon RPC communication.
package api

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// SubscribeToEvents subscribes to daemon events
func (c *clientImpl) SubscribeToEvents() tea.Cmd {
	return func() tea.Msg {
		// Subscribe to all event types
		eventChannel, err := c.daemonClient.Subscribe(rpc.SubscribeRequest{
			EventTypes: []string{"approval_requested", "approval_responded", "session_updated"},
		})
		if err != nil {
			return domain.SubscriptionMsg{Err: err}
		}

		return domain.SubscriptionMsg{EventChannel: eventChannel}
	}
}

// ListenForEvents listens for events on the subscription channel
func (c *clientImpl) ListenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd {
	return func() tea.Msg {
		// This blocks until an event is received
		event, ok := <-eventChan
		if !ok {
			// Channel closed, subscription ended
			return nil
		}
		return domain.EventNotificationMsg{Event: event}
	}
}
