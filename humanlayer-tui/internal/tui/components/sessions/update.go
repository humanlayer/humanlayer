// Package sessions implements the sessions UI component.
package sessions

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/atotto/clipboard"
	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// KeyMap defines the keybindings for the sessions component
type KeyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Back     key.Binding
	Tab      key.Binding
	ShiftTab key.Binding
	Launch   key.Binding
	Refresh  key.Binding
	Left     key.Binding
	Right    key.Binding
}

// DefaultKeyMap returns the default keybindings
func DefaultKeyMap() KeyMap {
	return KeyMap{
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "move up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "move down"),
		),
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "expand/select"),
		),
		Back: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "back"),
		),
		Tab: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "next field"),
		),
		ShiftTab: key.NewBinding(
			key.WithKeys("shift+tab"),
			key.WithHelp("shift+tab", "prev field"),
		),
		Launch: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "create session"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("r"),
			key.WithHelp("r", "refresh"),
		),
		Left: key.NewBinding(
			key.WithKeys("left", "h"),
			key.WithHelp("←/h", "left"),
		),
		Right: key.NewBinding(
			key.WithKeys("right", "l"),
			key.WithHelp("→/l", "right"),
		),
	}
}

// UpdateResult contains the result of an update operation
type UpdateResult struct {
	Cmd                tea.Cmd
	OpenConversation   bool
	OpenConversationID string
	TriggerSizeUpdate  bool
	ActiveSessionCount int
	Err                error
}

// Update handles messages for the sessions tab
func (m *Model) Update(msg tea.Msg, keys KeyMap) UpdateResult {
	result := UpdateResult{}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch m.viewState {
		case domain.ListView:
			return m.updateListView(msg, keys)
		case domain.SessionDetailView:
			return m.updateSessionDetailView(msg, keys)
		case domain.LaunchSessionView:
			return m.updateLaunchSessionView(msg, keys)
		case domain.QueryModalView:
			return m.updateQueryModalView(msg, keys)
		}

	case domain.FetchSessionsMsg:
		if msg.Err != nil {
			result.Err = msg.Err
			return result
		}
		m.sessions = msg.Sessions
		m.updateSortedSessions() // Update cached sorted sessions
		result.ActiveSessionCount = 0
		for _, sess := range m.sessions {
			if sess.Status == "running" || sess.Status == "starting" {
				result.ActiveSessionCount++
			}
		}
		// Preserve cursor position if possible
		if m.cursor >= len(m.sortedSessions) && len(m.sortedSessions) > 0 {
			m.cursor = len(m.sortedSessions) - 1
		}
		return result

	case domain.LaunchSessionMsg:
		if msg.Err != nil {
			result.Err = msg.Err
			return result
		}
		// Clear form and go back to list
		m.launchQueryInput.Reset()
		m.launchWorkingDir.Reset()
		m.launchModelSelect = 0
		m.launchActiveField = 0
		m.viewState = domain.ListView
		// Refresh sessions list
		result.Cmd = fetchSessions(m.apiClient)
		return result

	case domain.FetchSessionApprovalsMsg:
		if msg.Err != nil {
			result.Err = msg.Err
			return result
		}
		m.sessionApprovals = msg.Approvals
		return result
	}

	return result
}

// updateSortedSessions updates the cached sorted sessions
func (m *Model) updateSortedSessions() {
	m.sortedSessions = make([]session.Info, len(m.sessions))
	copy(m.sortedSessions, m.sessions)

	sort.Slice(m.sortedSessions, func(i, j int) bool {
		a, b := m.sortedSessions[i], m.sortedSessions[j]

		// Status priority: waiting_input > running > completed > failed
		statusPriority := func(status session.Status) int {
			switch status {
			case "waiting_input":
				return 0
			case "running", "starting":
				return 1
			case "completed":
				return 2
			case "failed":
				return 3
			default:
				return 4
			}
		}

		aPrio, bPrio := statusPriority(a.Status), statusPriority(b.Status)
		if aPrio != bPrio {
			return aPrio < bPrio
		}

		// Within same status, sort by last activity (most recent first)
		return a.LastActivityAt.After(b.LastActivityAt)
	})
}

// updateListView handles key events in the sessions list view
func (m *Model) updateListView(msg tea.KeyMsg, keys KeyMap) UpdateResult {
	result := UpdateResult{}

	switch {
	case key.Matches(msg, keys.Up):
		if m.cursor > 0 {
			m.cursor--
		}

	case key.Matches(msg, keys.Down):
		if m.cursor < len(m.sortedSessions)-1 {
			m.cursor++
		}

	case key.Matches(msg, keys.Enter):
		if m.cursor < len(m.sortedSessions) {
			session := m.sortedSessions[m.cursor]
			// Open conversation view for the selected session
			result.OpenConversation = true
			result.OpenConversationID = session.ID
		}

	case key.Matches(msg, keys.Launch):
		// Open launch session view
		m.viewState = domain.LaunchSessionView
		m.launchQueryInput.Focus()

	case key.Matches(msg, keys.Refresh):
		result.Cmd = fetchSessions(m.apiClient)
	}

	return result
}

// updateSessionDetailView handles key events in the session detail view
func (m *Model) updateSessionDetailView(msg tea.KeyMsg, keys KeyMap) UpdateResult {
	result := UpdateResult{}

	switch {
	case key.Matches(msg, keys.Back):
		m.viewState = domain.ListView
		m.selectedSession = nil
		m.sessionApprovals = []domain.Request{}

	case key.Matches(msg, keys.Up):
		if m.sessionDetailScroll > 0 {
			m.sessionDetailScroll--
		}

	case key.Matches(msg, keys.Down):
		// Calculate bounds to prevent scrolling past content
		if m.selectedSession != nil {
			// Build the actual content to get accurate line count
			content := m.buildSessionDetailContent()
			lines := strings.Split(content, "\n")
			// Calculate content height properly (terminal - tab bar - status bar - header)
			contentHeight := m.height - domain.TabBarHeight - domain.StatusBarHeight
			visibleHeight := contentHeight - 3 // Account for session detail header
			if visibleHeight < domain.MinContentHeight {
				visibleHeight = domain.MinContentHeight
			}
			maxScroll := len(lines) - visibleHeight
			if maxScroll < 0 {
				maxScroll = 0
			}

			// Only increment if we haven't reached the bottom
			if m.sessionDetailScroll < maxScroll {
				m.sessionDetailScroll++
			}
		}

	case key.Matches(msg, keys.Refresh):
		if m.selectedSession != nil {
			result.Cmd = tea.Batch(
				fetchSessions(m.apiClient),
				fetchSessionApprovals(m.apiClient, m.selectedSession.ID),
			)
		}
	}

	return result
}

// updateLaunchSessionView handles key events in the launch session view
func (m *Model) updateLaunchSessionView(msg tea.KeyMsg, keys KeyMap) UpdateResult {
	result := UpdateResult{}

	switch {
	case key.Matches(msg, keys.Back):
		m.viewState = domain.ListView

	case key.Matches(msg, keys.Tab), key.Matches(msg, keys.ShiftTab), key.Matches(msg, keys.Down), msg.String() == "j":
		// Cycle through fields (forward)
		if key.Matches(msg, keys.Tab) || key.Matches(msg, keys.Down) || msg.String() == "j" {
			m.launchActiveField = (m.launchActiveField + 1) % 3
		} else {
			m.launchActiveField = (m.launchActiveField + 2) % 3 // Go backwards
		}

		// Update focus
		m.launchQueryInput.Blur()
		m.launchWorkingDir.Blur()

		switch m.launchActiveField {
		case 0:
			m.launchQueryInput.Focus()
		case 2:
			m.launchWorkingDir.Focus()
		}

	case key.Matches(msg, keys.Up), msg.String() == "k":
		// Navigate fields backward
		m.launchActiveField = (m.launchActiveField + 2) % 3

		// Update focus
		m.launchQueryInput.Blur()
		m.launchWorkingDir.Blur()

		switch m.launchActiveField {
		case 0:
			m.launchQueryInput.Focus()
		case 2:
			m.launchWorkingDir.Focus()
		}

	case key.Matches(msg, keys.Enter):
		switch m.launchActiveField {
		case 0:
			// Open modal editor for query field
			content := m.savedQueryContent
			if content == "" {
				content = m.launchQueryInput.Value()
			}
			m.modalLines = strings.Split(content, "\n")
			if len(m.modalLines) == 0 || (len(m.modalLines) == 1 && m.modalLines[0] == "") {
				m.modalLines = []string{""}
			}
			m.modalCursor = 0
			m.modalType = "query"
			m.viewState = domain.QueryModalView
			// Trigger layout update for modal view
			result.TriggerSizeUpdate = true
		case 2:
			// Open modal editor for working directory field
			m.modalQuery = m.launchWorkingDir.Value()
			m.modalLines = strings.Split(m.modalQuery, "\n")
			if len(m.modalLines) == 0 || (len(m.modalLines) == 1 && m.modalLines[0] == "") {
				m.modalLines = []string{""}
			}
			m.modalCursor = 0
			m.modalType = "workingdir"
			m.viewState = domain.QueryModalView
			// Trigger layout update for modal view
			result.TriggerSizeUpdate = true
		}

	case msg.String() == "c", msg.String() == "ctrl+enter":
		// Launch session with 'c' or Ctrl+Enter (only if query has content)
		query := m.savedQueryContent
		if query == "" {
			query = m.launchQueryInput.Value()
		}
		if query != "" {
			model := []string{"", "opus", "sonnet"}[m.launchModelSelect]
			workingDir := m.launchWorkingDir.Value()
			// Use current working directory if none specified
			if workingDir == "" {
				if cwd, err := os.Getwd(); err == nil {
					workingDir = cwd
				}
			}
			result.Cmd = launchSession(m.apiClient, query, model, workingDir)
		}

	case key.Matches(msg, keys.Left), key.Matches(msg, keys.Right):
		// Handle model selection
		if m.launchActiveField == 1 {
			if key.Matches(msg, keys.Left) && m.launchModelSelect > 0 {
				m.launchModelSelect--
			} else if key.Matches(msg, keys.Right) && m.launchModelSelect < 2 {
				m.launchModelSelect++
			}
		}

	default:
		// Both text fields now use modal editors only
		// No direct text input in the form
	}

	return result
}

// updateQueryModalView handles key events in the query modal editor
func (m *Model) updateQueryModalView(msg tea.KeyMsg, keys KeyMap) UpdateResult {
	result := UpdateResult{}

	// Handle ONLY specific keys explicitly - everything else is text input
	keyStr := msg.String()

	switch keyStr {
	case "esc":
		// Save modal content and return
		content := strings.Join(m.modalLines, "\n")
		switch m.modalType {
		case "query":
			m.savedQueryContent = content // Store full multiline content
		case "workingdir":
			// Working directory validation
			dir := strings.TrimSpace(content)
			if dir != "" {
				// Expand tilde
				if strings.HasPrefix(dir, "~/") {
					if home, err := os.UserHomeDir(); err == nil {
						dir = home + dir[1:]
					}
				}
				// Check if directory exists
				if _, err := os.Stat(dir); os.IsNotExist(err) {
					// TODO: Show validation error in UI
					// For now, just don't save invalid directory
					return result
				}
			}
			m.launchWorkingDir.SetValue(dir)
		}
		m.viewState = domain.LaunchSessionView

	case "ctrl+enter":
		// Save and submit
		content := strings.Join(m.modalLines, "\n")
		switch m.modalType {
		case "query":
			m.savedQueryContent = content // Store full multiline content
		case "workingdir":
			// Working directory validation
			dir := strings.TrimSpace(content)
			if dir != "" {
				// Expand tilde
				if strings.HasPrefix(dir, "~/") {
					if home, err := os.UserHomeDir(); err == nil {
						dir = home + dir[1:]
					}
				}
				// Check if directory exists
				if _, err := os.Stat(dir); os.IsNotExist(err) {
					// TODO: Show validation error in UI
					// For now, just don't save invalid directory
					return result
				}
			}
			m.launchWorkingDir.SetValue(dir)
		}

		// Launch if query has content
		query := m.savedQueryContent
		if query == "" {
			query = m.launchQueryInput.Value()
		}
		if query != "" {
			model := []string{"", "opus", "sonnet"}[m.launchModelSelect]
			workingDir := m.launchWorkingDir.Value()
			// Use current working directory if none specified
			if workingDir == "" {
				if cwd, err := os.Getwd(); err == nil {
					workingDir = cwd
				}
			}
			result.Cmd = launchSession(m.apiClient, query, model, workingDir)
			return result
		}

		// If no query, just return to form
		m.viewState = domain.LaunchSessionView
		// Trigger layout update when returning to form view
		result.TriggerSizeUpdate = true

	case "up":
		// Only respond to actual arrow keys, not letter bindings
		if m.modalCursor > 0 {
			m.modalCursor--
		}

	case "down":
		// Only respond to actual arrow keys, not letter bindings
		if m.modalCursor < len(m.modalLines)-1 {
			m.modalCursor++
		}

	case "enter":
		if m.modalType == "workingdir" {
			// Working directory doesn't allow multiline - ignore enter
			return result
		}
		// Insert new line for query field
		currentLine := m.modalLines[m.modalCursor]
		m.modalLines[m.modalCursor] = currentLine // Keep current line content
		// Insert new empty line after current
		m.modalLines = append(m.modalLines[:m.modalCursor+1], m.modalLines[m.modalCursor:]...)
		m.modalLines[m.modalCursor+1] = ""
		m.modalCursor++

	case "backspace":
		if len(m.modalLines[m.modalCursor]) > 0 {
			// Remove last character from current line
			m.modalLines[m.modalCursor] = m.modalLines[m.modalCursor][:len(m.modalLines[m.modalCursor])-1]
		} else if m.modalCursor > 0 {
			// Remove empty line and move up
			m.modalLines = append(m.modalLines[:m.modalCursor], m.modalLines[m.modalCursor+1:]...)
			m.modalCursor--
		}

	case "tab":
		// Insert tab character
		m.modalLines[m.modalCursor] += "\t"

	case "ctrl+v", "cmd+v":
		// Read from clipboard and paste
		text, err := clipboard.ReadAll()
		if err != nil {
			// Silently ignore clipboard errors
			return result
		}

		// Split pasted text into lines
		lines := strings.Split(text, "\n")

		if len(lines) == 1 {
			// Single line paste - insert at current cursor position
			m.modalLines[m.modalCursor] += lines[0]
		} else {
			// Multi-line paste
			// Insert first line at current position
			m.modalLines[m.modalCursor] += lines[0]

			// Insert remaining lines after current line
			for i, line := range lines[1:] {
				insertPos := m.modalCursor + i + 1
				// Insert new line at position
				m.modalLines = append(m.modalLines[:insertPos], m.modalLines[insertPos-1:]...)
				m.modalLines[insertPos] = line
			}

			// Move cursor to end of pasted content
			m.modalCursor += len(lines) - 1
		}

	default:
		// Everything else is text input - including k, j, c, numbers, etc.
		if len(keyStr) == 1 && keyStr[0] >= 32 && keyStr[0] <= 126 {
			m.modalLines[m.modalCursor] += keyStr
		}
	}

	return result
}

// Helper functions that need access to API client

func fetchSessions(apiClient api.Client) tea.Cmd {
	return apiClient.FetchSessions()
}

func fetchSessionApprovals(apiClient api.Client, sessionID string) tea.Cmd {
	return apiClient.FetchSessionApprovals(sessionID)
}

func launchSession(apiClient api.Client, query, model, workingDir string) tea.Cmd {
	return apiClient.LaunchSession(query, model, workingDir)
}

// formatRelativeTime formats a timestamp as a relative time (e.g., "2m ago", "1h ago")
func formatRelativeTime(t time.Time) string {
	now := time.Now()
	diff := now.Sub(t)

	if diff < time.Minute {
		return "now"
	} else if diff < time.Hour {
		minutes := int(diff.Minutes())
		return fmt.Sprintf("%dm ago", minutes)
	} else if diff < 24*time.Hour {
		hours := int(diff.Hours())
		return fmt.Sprintf("%dh ago", hours)
	} else if diff < 7*24*time.Hour {
		days := int(diff.Hours() / 24)
		return fmt.Sprintf("%dd ago", days)
	}

	// For older items, show the date
	return t.Format("Jan 2")
}
