// Package conversation implements the conversation UI component.
package conversation

import (
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// Dependencies represents external dependencies for the conversation component
type Dependencies struct {
	APIClient         api.Client
	ConversationCache *domain.ConversationCache
	Width             int
	Height            int
	Keys              KeyMap
}

// KeyMap contains key bindings for the conversation view
type KeyMap struct {
	Back    key.Binding
	Up      key.Binding
	Down    key.Binding
	Approve key.Binding
	Deny    key.Binding
	Enter   key.Binding
	Refresh key.Binding
	Quit    key.Binding
}

// Update handles messages for the conversation view
func (m *Model) Update(msg tea.Msg, deps Dependencies) tea.Cmd {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		// Handle window resize - update viewport dimensions
		m.UpdateSize(deps.Width, deps.Height)
		return nil

	case tea.KeyMsg:
		// Handle different input modes
		if m.showApprovalPrompt && m.approvalInput.Focused() {
			return m.updateApprovalInput(msg, deps)
		}
		if m.showResumePrompt && m.resumeInput.Focused() {
			return m.updateResumeInput(msg, deps)
		}

		// Regular conversation view navigation
		return m.updateConversationView(msg, deps)

	case domain.FetchConversationMsg:
		m.loading = false
		if msg.Err != nil {
			m.error = msg.Err
			return nil
		}
		m.session = msg.Session
		m.events = msg.Events
		m.lastRefresh = time.Now()

		// If this is a child session with missing data, use parent data stored during resume
		if m.session != nil && m.session.ParentSessionID != "" {
			if m.session.Model == "" && m.parentModel != "" {
				m.session.Model = m.parentModel
			}
			if m.session.WorkingDir == "" && m.parentWorkingDir != "" {
				m.session.WorkingDir = m.parentWorkingDir
			}
		}

		// Cache the conversation for future use (if session and events are not nil)
		if m.session != nil && m.events != nil {
			deps.ConversationCache.Put(m.sessionID, m.session, m.events)
		}

		// Find any pending approvals
		m.findPendingApproval()

		// Only store scroll position if this is not a background refresh
		// (PollRefreshMsg already captured the scroll position)
		if !m.isPolling || m.lastRefresh.IsZero() {
			// Store current scroll position before updating content
			m.wasAtBottom = m.viewport.AtBottom()
		}

		// Update viewport content
		content := m.renderConversationContent()
		m.viewport.SetContent(content)

		// Only auto-scroll if user was already at bottom or this is initial load
		if m.wasAtBottom || m.lastRefresh.IsZero() {
			m.viewport.GotoBottom()
		}

		// Start polling if this is an active session
		if m.isActiveSession() && !m.isPolling {
			return m.startPolling()
		}

		return nil

	case domain.PollRefreshMsg:
		// Only refresh if we're still viewing the same session and it's active
		if msg.SessionID == m.sessionID && m.isActiveSession() {
			// Remember scroll position before refresh
			m.wasAtBottom = m.viewport.AtBottom()
			// Silently refresh in background - don't show loading state
			cmds = append(cmds, deps.APIClient.FetchConversationSilent(m.sessionID))
			// Continue polling
			if m.isPolling {
				cmds = append(cmds, m.startPolling())
			}
		}
		return tea.Batch(cmds...)

	case domain.ApprovalSentMsg:
		if msg.Err != nil {
			m.error = msg.Err
			return nil
		}
		// Clear approval state and refresh conversation
		m.clearApprovalState()
		// Invalidate cache since approval status changed
		deps.ConversationCache.Invalidate(m.sessionID)
		return deps.APIClient.FetchConversation(m.sessionID)

	case domain.ContinueSessionMsg:
		if msg.Err != nil {
			m.error = msg.Err
			return nil
		}
		// Navigate to the new session
		m.clearResumeState()
		m.SetSession(msg.SessionID)
		return deps.APIClient.FetchConversation(msg.SessionID)
	}

	return tea.Batch(cmds...)
}

// updateConversationView handles key events in the main conversation view
func (m *Model) updateConversationView(msg tea.KeyMsg, deps Dependencies) tea.Cmd {
	switch {
	case key.Matches(msg, deps.Keys.Back):
		// Go back to previous view
		return nil

	case key.Matches(msg, deps.Keys.Up), key.Matches(msg, deps.Keys.Down),
		msg.String() == "pgup", msg.String() == "pgdown",
		msg.String() == "home", msg.String() == "end":
		// Scroll conversation
		var cmd tea.Cmd
		m.viewport, cmd = m.viewport.Update(msg)
		// Update scroll position tracking after manual scrolling
		m.wasAtBottom = m.viewport.AtBottom()
		return cmd

	case key.Matches(msg, deps.Keys.Approve):
		// Quick approve pending approval
		if approval := m.PendingApproval(); approval != nil && approval.ApprovalID != "" {
			return deps.APIClient.SendApproval(approval.ApprovalID, true, "")
		}

	case key.Matches(msg, deps.Keys.Deny):
		// Show approval input for deny with comment
		if m.PendingApproval() != nil {
			m.showApprovalPrompt = true
			m.approvalInput.Focus()
			m.approvalInput.Placeholder = "Reason for denial..."
			// Adjust viewport to make room for input prompt
			m.adjustViewportSize()
		}

	case msg.String() == "r":
		// Show resume prompt for completed sessions
		if m.session != nil && m.session.Status == "completed" {
			m.showResumePrompt = true
			m.resumeInput.Focus()
			// Adjust viewport to make room for input prompt
			m.adjustViewportSize()
		}

	case msg.String() == "p":
		// Jump to parent session if this is a continued session
		if m.session != nil && m.session.ParentSessionID != "" {
			m.SetSession(m.session.ParentSessionID)
			return deps.APIClient.FetchConversation(m.session.ParentSessionID)
		}

	case key.Matches(msg, deps.Keys.Refresh):
		// Refresh conversation - invalidate cache to force fresh data
		deps.ConversationCache.Invalidate(m.sessionID)
		return deps.APIClient.FetchConversation(m.sessionID)
	}

	return nil
}

// updateApprovalInput handles key events when approval input is focused
func (m *Model) updateApprovalInput(msg tea.KeyMsg, deps Dependencies) tea.Cmd {
	switch {
	case key.Matches(msg, deps.Keys.Back):
		m.clearApprovalState()
		return nil

	case key.Matches(msg, deps.Keys.Enter):
		// Send denial with comment
		if approval := m.PendingApproval(); approval != nil && approval.ApprovalID != "" {
			comment := m.approvalInput.Value()
			approvalID := approval.ApprovalID
			m.clearApprovalState()
			return deps.APIClient.SendApproval(approvalID, false, comment)
		}
		m.clearApprovalState()
		return nil

	default:
		// Handle text input
		var cmd tea.Cmd
		m.approvalInput, cmd = m.approvalInput.Update(msg)
		return cmd
	}
}

// updateResumeInput handles key events when resume input is focused
func (m *Model) updateResumeInput(msg tea.KeyMsg, deps Dependencies) tea.Cmd {
	switch {
	case key.Matches(msg, deps.Keys.Back):
		// Escape key should exit the resume input
		m.clearResumeState()
		return nil

	case key.Matches(msg, deps.Keys.Quit), msg.String() == "ctrl+c":
		// Additional ways to escape the input
		m.clearResumeState()
		return nil

	case key.Matches(msg, deps.Keys.Enter):
		// Continue session with new message
		if m.session != nil && m.sessionID != "" {
			query := m.resumeInput.Value()
			if query != "" {
				// Store parent session data for inheritance
				m.parentModel = m.session.Model
				m.parentWorkingDir = m.session.WorkingDir
				return deps.APIClient.ContinueSession(m.sessionID, query)
			}
		}
		m.clearResumeState()
		return nil

	default:
		// Handle text input
		var cmd tea.Cmd
		m.resumeInput, cmd = m.resumeInput.Update(msg)
		return cmd
	}
}

// startPolling begins 3-second polling for active sessions
func (m *Model) startPolling() tea.Cmd {
	if m.isPolling {
		return nil // Already polling
	}

	m.isPolling = true
	m.pollTicker = time.NewTicker(3 * time.Second)

	return func() tea.Msg {
		<-m.pollTicker.C
		return domain.PollRefreshMsg{SessionID: m.sessionID}
	}
}
