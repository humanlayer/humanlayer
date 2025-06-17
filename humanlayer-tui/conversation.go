package main

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/tui/components/conversation"
)

// conversationModel wraps the conversation component for backward compatibility
type conversationModel struct {
	conversation.Model
}

// newConversationModel creates a new conversation model
func newConversationModel() conversationModel {
	return conversationModel{
		Model: conversation.New(),
	}
}

// setSession wraps the SetSession method
func (cm *conversationModel) setSession(sessionID string) {
	cm.SetSession(sessionID)
}

// updateSize wraps the UpdateSize method
func (cm *conversationModel) updateSize(width, height int) {
	cm.UpdateSize(width, height)
}

// Update wraps the component's Update method, adapting to the old interface
func (cm *conversationModel) Update(msg tea.Msg, m *model) tea.Cmd {
	// Create dependencies from the main model
	deps := conversation.Dependencies{
		APIClient:         m.apiClient,
		ConversationCache: m.conversationCache,
		Width:             m.width,
		Height:            m.height,
		Keys: conversation.KeyMap{
			Back:    keys.Back,
			Up:      keys.Up,
			Down:    keys.Down,
			Approve: keys.Approve,
			Deny:    keys.Deny,
			Enter:   keys.Enter,
			Refresh: keys.Refresh,
			Quit:    keys.Quit,
		},
	}

	return cm.Model.Update(msg, deps)
}

// View wraps the component's View method
func (cm *conversationModel) View(m *model) string {
	return cm.Model.View(m.width, m.height)
}

// Additional methods for backward compatibility
func (cm *conversationModel) sessionID() string {
	return cm.SessionID()
}

func (cm *conversationModel) clearSession() {
	cm.ClearSession()
}
