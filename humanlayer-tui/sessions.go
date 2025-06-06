package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/session"
)

// sessionModel contains all state related to the sessions tab
type sessionModel struct {
	sessions  []session.Info
	cursor    int
	viewState viewState

	// For session detail view
	selectedSession     *session.Info
	sessionApprovals    []Request
	sessionDetailScroll int

	// For launch session view
	launchPromptInput textinput.Model
	launchModelSelect int // 0=default, 1=opus, 2=sonnet
	launchWorkingDir  textinput.Model
	launchActiveField int // 0=prompt, 1=model, 2=workingDir
}

// newSessionModel creates a new session model with default state
func newSessionModel() sessionModel {
	// Create launch session inputs
	promptInput := textinput.New()
	promptInput.Placeholder = "Enter prompt for Claude..."
	promptInput.CharLimit = 1000
	promptInput.Width = 60
	promptInput.Focus()

	workingDirInput := textinput.New()
	workingDirInput.Placeholder = "Working directory (optional)"
	workingDirInput.CharLimit = 200
	workingDirInput.Width = 60

	return sessionModel{
		sessions:          []session.Info{},
		cursor:            0,
		viewState:         listView,
		launchPromptInput: promptInput,
		launchWorkingDir:  workingDirInput,
		launchModelSelect: 0, // default
		launchActiveField: 0, // prompt field
	}
}

// Update handles messages for the sessions tab
func (sm *sessionModel) Update(msg tea.Msg, m *model) tea.Cmd {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch sm.viewState {
		case listView:
			return sm.updateListView(msg, m)
		case sessionDetailView:
			return sm.updateSessionDetailView(msg, m)
		case launchSessionView:
			return sm.updateLaunchSessionView(msg, m)
		}

	case fetchSessionsMsg:
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		sm.sessions = msg.sessions
		m.activeSessionCount = 0
		for _, sess := range sm.sessions {
			if sess.Status == "running" || sess.Status == "starting" {
				m.activeSessionCount++
			}
		}
		// Preserve cursor position if possible
		if sm.cursor >= len(sm.sessions) && len(sm.sessions) > 0 {
			sm.cursor = len(sm.sessions) - 1
		}
		return nil

	case launchSessionMsg:
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		// Clear form and go back to list
		sm.launchPromptInput.Reset()
		sm.launchWorkingDir.Reset()
		sm.launchModelSelect = 0
		sm.launchActiveField = 0
		sm.viewState = listView
		// Refresh sessions list
		return fetchSessions(m.daemonClient)

	case fetchSessionApprovalsMsg:
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		sm.sessionApprovals = msg.approvals
		return nil
	}

	return nil
}

// updateListView handles key events in the sessions list view
func (sm *sessionModel) updateListView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Up):
		if sm.cursor > 0 {
			sm.cursor--
		}

	case key.Matches(msg, keys.Down):
		if sm.cursor < len(sm.sessions)-1 {
			sm.cursor++
		}

	case key.Matches(msg, keys.Enter):
		if sm.cursor < len(sm.sessions) {
			sm.selectedSession = &sm.sessions[sm.cursor]
			sm.sessionDetailScroll = 0
			sm.viewState = sessionDetailView
			// Fetch approvals for this session
			return fetchSessionApprovals(m.daemonClient, sm.selectedSession.ID)
		}

	case key.Matches(msg, keys.Launch):
		// Open launch session view
		sm.viewState = launchSessionView
		sm.launchPromptInput.Focus()

	case key.Matches(msg, keys.Refresh):
		return fetchSessions(m.daemonClient)
	}

	return nil
}

// updateSessionDetailView handles key events in the session detail view
func (sm *sessionModel) updateSessionDetailView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		sm.viewState = listView
		sm.selectedSession = nil
		sm.sessionApprovals = []Request{}

	case key.Matches(msg, keys.Up):
		if sm.sessionDetailScroll > 0 {
			sm.sessionDetailScroll--
		}

	case key.Matches(msg, keys.Down):
		// Allow scrolling if content is longer than view
		sm.sessionDetailScroll++

	case key.Matches(msg, keys.Refresh):
		if sm.selectedSession != nil {
			return tea.Batch(
				fetchSessions(m.daemonClient),
				fetchSessionApprovals(m.daemonClient, sm.selectedSession.ID),
			)
		}
	}

	return nil
}

// updateLaunchSessionView handles key events in the launch session view
func (sm *sessionModel) updateLaunchSessionView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		sm.viewState = listView

	case key.Matches(msg, keys.Tab), key.Matches(msg, keys.ShiftTab):
		// Cycle through fields
		if key.Matches(msg, keys.Tab) {
			sm.launchActiveField = (sm.launchActiveField + 1) % 3
		} else {
			sm.launchActiveField = (sm.launchActiveField + 2) % 3 // Go backwards
		}

		// Update focus
		sm.launchPromptInput.Blur()
		sm.launchWorkingDir.Blur()

		switch sm.launchActiveField {
		case 0:
			sm.launchPromptInput.Focus()
		case 2:
			sm.launchWorkingDir.Focus()
		}

	case key.Matches(msg, keys.Enter):
		// Submit the form
		if sm.launchActiveField == 1 {
			// If on model select, just move to next field
			sm.launchActiveField = 2
			sm.launchWorkingDir.Focus()
		} else if sm.launchPromptInput.Value() != "" {
			// Launch the session
			prompt := sm.launchPromptInput.Value()
			model := []string{"", "claude-3-opus-20240229", "claude-3-5-sonnet-20241022"}[sm.launchModelSelect]
			workingDir := sm.launchWorkingDir.Value()
			return launchSession(m.daemonClient, prompt, model, workingDir)
		}

	case key.Matches(msg, keys.Left), key.Matches(msg, keys.Right):
		// Handle model selection
		if sm.launchActiveField == 1 {
			if key.Matches(msg, keys.Left) && sm.launchModelSelect > 0 {
				sm.launchModelSelect--
			} else if key.Matches(msg, keys.Right) && sm.launchModelSelect < 2 {
				sm.launchModelSelect++
			}
		}

	default:
		// Handle text input for the active field
		var cmd tea.Cmd
		switch sm.launchActiveField {
		case 0:
			sm.launchPromptInput, cmd = sm.launchPromptInput.Update(msg)
		case 2:
			sm.launchWorkingDir, cmd = sm.launchWorkingDir.Update(msg)
		}
		return cmd
	}

	return nil
}

// View renders the sessions tab
func (sm *sessionModel) View(m *model) string {
	switch sm.viewState {
	case sessionDetailView:
		return sm.renderSessionDetailView(m)
	case launchSessionView:
		return sm.renderLaunchSessionView(m)
	default:
		return sm.renderListView(m)
	}
}

// renderListView renders the sessions list
func (sm *sessionModel) renderListView(m *model) string {
	if len(sm.sessions) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		return emptyStyle.Render("No sessions. Press [l] to launch a new session.")
	}

	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	s.WriteString(headerStyle.Render("Claude Sessions") + "\n\n")

	// Sessions list
	for i, sess := range sm.sessions {
		selected := i == sm.cursor

		// Status icon
		statusIcon := "⏸" // paused/unknown
		switch sess.Status {
		case "starting":
			statusIcon = "🔄"
		case "running":
			statusIcon = "🟢"
		case "completed":
			statusIcon = "✅"
		case "failed":
			statusIcon = "❌"
		}

		// Session ID (truncated)
		sessionID := sess.ID
		if len(sessionID) > 8 {
			sessionID = sessionID[:8]
		}

		// Model name
		modelName := sess.Model
		if modelName == "" {
			modelName = "default"
		} else if strings.Contains(modelName, "opus") {
			modelName = "opus"
		} else if strings.Contains(modelName, "sonnet") {
			modelName = "sonnet"
		}

		// Duration
		duration := ""
		if !sess.StartTime.IsZero() {
			if sess.EndTime != nil {
				d := sess.EndTime.Sub(sess.StartTime)
				duration = formatDuration(d)
			} else {
				d := time.Since(sess.StartTime)
				duration = formatDuration(d)
			}
		}

		// Prompt preview
		promptPreview := truncate(sess.Prompt, 40)

		// Build the item
		item := fmt.Sprintf("%s %s [%s] %s %s", statusIcon, sessionID, modelName, duration, promptPreview)

		// Apply styling
		itemStyle := lipgloss.NewStyle().Padding(0, 2)
		if selected {
			itemStyle = itemStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}

		s.WriteString(itemStyle.Render(item) + "\n")
	}

	// Instructions
	s.WriteString("\n")
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)
	s.WriteString(instructionStyle.Render("Press [c] to create new session, [enter] to view details"))

	return s.String()
}

// renderSessionDetailView renders the detailed view of a session
func (sm *sessionModel) renderSessionDetailView(m *model) string {
	if sm.selectedSession == nil {
		return "No session selected"
	}

	sess := sm.selectedSession
	var content strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	content.WriteString(headerStyle.Render("Session Details") + "\n\n")

	// Session info
	labelStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Width(15)
	valueStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252"))

	// Status with icon
	statusIcon := "⏸"
	switch sess.Status {
	case "starting":
		statusIcon = "🔄"
	case "running":
		statusIcon = "🟢"
	case "completed":
		statusIcon = "✅"
	case "failed":
		statusIcon = "❌"
	}
	content.WriteString(labelStyle.Render("Status:") + valueStyle.Render(fmt.Sprintf("%s %s", statusIcon, sess.Status)) + "\n")

	content.WriteString(labelStyle.Render("Session ID:") + valueStyle.Render(sess.ID) + "\n")
	content.WriteString(labelStyle.Render("Run ID:") + valueStyle.Render(sess.RunID) + "\n")

	// Model
	modelName := sess.Model
	if modelName == "" {
		modelName = "default"
	}
	content.WriteString(labelStyle.Render("Model:") + valueStyle.Render(modelName) + "\n")

	// Times
	if !sess.StartTime.IsZero() {
		content.WriteString(labelStyle.Render("Started:") + valueStyle.Render(sess.StartTime.Format("15:04:05")) + "\n")
	}
	if sess.EndTime != nil {
		content.WriteString(labelStyle.Render("Completed:") + valueStyle.Render(sess.EndTime.Format("15:04:05")) + "\n")
	}

	// Duration
	if !sess.StartTime.IsZero() {
		var duration time.Duration
		if sess.EndTime != nil {
			duration = sess.EndTime.Sub(sess.StartTime)
		} else {
			duration = time.Since(sess.StartTime)
		}
		content.WriteString(labelStyle.Render("Duration:") + valueStyle.Render(formatDuration(duration)) + "\n")
	}

	// Error if any
	if sess.Error != "" {
		errorStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Bold(true)
		content.WriteString(labelStyle.Render("Error:") + errorStyle.Render(sess.Error) + "\n")
	}

	content.WriteString("\n")

	// Prompt
	promptStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252")).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("237")).
		Padding(1, 2)

	content.WriteString(labelStyle.Render("Prompt:") + "\n")
	content.WriteString(promptStyle.Render(sess.Prompt) + "\n\n")

	// Approvals for this session
	if len(sm.sessionApprovals) > 0 {
		content.WriteString(labelStyle.Render("Approvals:") + "\n")
		approvalStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("245")).
			PaddingLeft(2)

		for _, approval := range sm.sessionApprovals {
			icon := "📋"
			if approval.Type == HumanContactRequest {
				icon = "💬"
			}
			approvalLine := fmt.Sprintf("%s %s - %s", icon, approval.CreatedAt.Format("15:04:05"), approval.Message)
			content.WriteString(approvalStyle.Render(approvalLine) + "\n")
		}
		content.WriteString("\n")
	}

	// Result/Output (if completed)
	if sess.Status == "completed" && sess.Result != nil && sess.Result.Result != "" {
		resultStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252")).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("237")).
			Padding(1, 2)

		content.WriteString(labelStyle.Render("Result:") + "\n")
		content.WriteString(resultStyle.Render(sess.Result.Result) + "\n\n")
	}

	// Metrics (if available)
	if sess.Result != nil {
		if sess.Result.NumTurns > 0 {
			content.WriteString(labelStyle.Render("Turns:") + valueStyle.Render(fmt.Sprintf("%d", sess.Result.NumTurns)) + "\n")
		}
		if sess.Result.TotalCost > 0 {
			content.WriteString(labelStyle.Render("Cost:") + valueStyle.Render(fmt.Sprintf("$%.4f", sess.Result.TotalCost)) + "\n")
		}
	}

	// Apply scrolling
	lines := strings.Split(content.String(), "\n")
	visibleHeight := m.height - 6 // Account for tab bar, status bar, etc.

	if sm.sessionDetailScroll > len(lines)-visibleHeight {
		sm.sessionDetailScroll = len(lines) - visibleHeight
		if sm.sessionDetailScroll < 0 {
			sm.sessionDetailScroll = 0
		}
	}

	// Build visible content
	var visible strings.Builder
	start := sm.sessionDetailScroll
	end := start + visibleHeight
	if end > len(lines) {
		end = len(lines)
	}

	for i := start; i < end; i++ {
		visible.WriteString(lines[i])
		if i < end-1 {
			visible.WriteString("\n")
		}
	}

	// Add scroll indicator if needed
	if len(lines) > visibleHeight {
		scrollInfo := fmt.Sprintf(" (Showing %d-%d of %d lines) ", start+1, end, len(lines))
		scrollStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)
		visible.WriteString("\n" + scrollStyle.Render(scrollInfo))
	}

	return visible.String()
}

// renderLaunchSessionView renders the launch session form
func (sm *sessionModel) renderLaunchSessionView(m *model) string {
	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	s.WriteString(headerStyle.Render("🚀 Launch New Claude Session") + "\n\n")

	// Form fields
	labelStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Width(15)

	activeStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("205")).
		Bold(true)

	// Prompt field
	promptLabel := "Prompt:"
	if sm.launchActiveField == 0 {
		promptLabel = activeStyle.Render(promptLabel)
	} else {
		promptLabel = labelStyle.Render(promptLabel)
	}
	s.WriteString(promptLabel + "\n")
	s.WriteString(sm.launchPromptInput.View() + "\n\n")

	// Model selection
	modelLabel := "Model:"
	if sm.launchActiveField == 1 {
		modelLabel = activeStyle.Render(modelLabel)
	} else {
		modelLabel = labelStyle.Render(modelLabel)
	}
	s.WriteString(modelLabel + "\n")

	models := []string{"Default", "Claude 3 Opus", "Claude 3.5 Sonnet"}
	modelOptions := ""
	for i, model := range models {
		optionStyle := lipgloss.NewStyle().Padding(0, 2)
		if i == sm.launchModelSelect {
			optionStyle = optionStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}
		modelOptions += optionStyle.Render(model)
	}
	s.WriteString(modelOptions + "\n\n")

	// Working directory field
	dirLabel := "Working Dir:"
	if sm.launchActiveField == 2 {
		dirLabel = activeStyle.Render(dirLabel)
	} else {
		dirLabel = labelStyle.Render(dirLabel)
	}
	s.WriteString(dirLabel + "\n")
	s.WriteString(sm.launchWorkingDir.View() + "\n\n")

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)

	instructions := []string{
		"[tab] to navigate fields",
		"[←/→] to select model",
		"[enter] to launch",
		"[esc] to cancel",
	}
	s.WriteString(instructionStyle.Render(strings.Join(instructions, " • ")))

	return s.String()
}

// formatDuration formats a duration in a human-readable way
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	} else if d < time.Hour {
		return fmt.Sprintf("%dm%ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh%dm", int(d.Hours()), int(d.Minutes())%60)
}
