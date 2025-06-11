package main

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/atotto/clipboard"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/session"
)

// sessionModel contains all state related to the sessions tab
type sessionModel struct {
	sessions       []session.Info
	sortedSessions []session.Info // Cached sorted sessions for navigation
	cursor         int
	viewState      viewState

	// For list scrolling
	viewport viewport.Model

	// For session detail view
	selectedSession     *session.Info
	sessionApprovals    []Request
	sessionDetailScroll int

	// For launch session view
	launchQueryInput  textinput.Model
	launchModelSelect int // 0=default, 1=opus, 2=sonnet
	launchWorkingDir  textinput.Model
	launchActiveField int // 0=query, 1=model, 2=workingDir

	// For modal editors
	modalQuery  string   // Text being edited in modal
	modalLines  []string // Split text for easier editing
	modalCursor int      // Line cursor position
	modalType   string   // "query" or "workingdir" - which field is being edited

	// Separate storage for each field
	savedQueryContent string // Persistent multiline query storage
}

// newSessionModel creates a new session model with default state
func newSessionModel() sessionModel {
	// Create launch session inputs
	queryInput := textinput.New()
	queryInput.Placeholder = "Enter query for Claude..."
	queryInput.CharLimit = 1000
	queryInput.Width = 60
	queryInput.Focus()

	workingDirInput := textinput.New()
	workingDirInput.Placeholder = "Working directory (defaults to current)"
	workingDirInput.CharLimit = 200
	workingDirInput.Width = 60

	vp := viewport.New(80, 20) // Will be resized later
	vp.SetContent("")

	return sessionModel{
		sessions:          []session.Info{},
		sortedSessions:    []session.Info{},
		cursor:            0,
		viewState:         listView,
		viewport:          vp,
		launchQueryInput:  queryInput,
		launchWorkingDir:  workingDirInput,
		launchModelSelect: 0, // default
		launchActiveField: 0, // query field
	}
}

// updateSize updates the viewport dimensions
func (sm *sessionModel) updateSize(width, height int) {
	sm.viewport.Width = width
	sm.viewport.Height = height
	sm.launchQueryInput.Width = width - 20
	sm.launchWorkingDir.Width = width - 20
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
		case queryModalView:
			return sm.updateQueryModalView(msg, m)
		}

	case fetchSessionsMsg:
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		sm.sessions = msg.sessions
		sm.updateSortedSessions() // Update cached sorted sessions
		m.activeSessionCount = 0
		for _, sess := range sm.sessions {
			if sess.Status == "running" || sess.Status == "starting" {
				m.activeSessionCount++
			}
		}
		// Preserve cursor position if possible
		if sm.cursor >= len(sm.sortedSessions) && len(sm.sortedSessions) > 0 {
			sm.cursor = len(sm.sortedSessions) - 1
		}
		return nil

	case launchSessionMsg:
		if msg.err != nil {
			m.err = msg.err
			return nil
		}
		// Clear form and go back to list
		sm.launchQueryInput.Reset()
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

// updateSortedSessions updates the cached sorted sessions
func (sm *sessionModel) updateSortedSessions() {
	sm.sortedSessions = make([]session.Info, len(sm.sessions))
	copy(sm.sortedSessions, sm.sessions)

	sort.Slice(sm.sortedSessions, func(i, j int) bool {
		a, b := sm.sortedSessions[i], sm.sortedSessions[j]

		// Status priority: running > completed > failed
		statusPriority := func(status session.Status) int {
			switch status {
			case "running", "starting":
				return 0
			case "completed":
				return 1
			case "failed":
				return 2
			default:
				return 3
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
func (sm *sessionModel) updateListView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Up):
		if sm.cursor > 0 {
			sm.cursor--
		}

	case key.Matches(msg, keys.Down):
		if sm.cursor < len(sm.sortedSessions)-1 {
			sm.cursor++
		}

	case key.Matches(msg, keys.Enter):
		if sm.cursor < len(sm.sortedSessions) {
			session := sm.sortedSessions[sm.cursor]
			// Open conversation view for the selected session
			return m.openConversationView(session.ID)
		}

	case key.Matches(msg, keys.Launch):
		// Open launch session view
		sm.viewState = launchSessionView
		sm.launchQueryInput.Focus()

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

	case key.Matches(msg, keys.Tab), key.Matches(msg, keys.ShiftTab), key.Matches(msg, keys.Down), msg.String() == "j":
		// Cycle through fields (forward)
		if key.Matches(msg, keys.Tab) || key.Matches(msg, keys.Down) || msg.String() == "j" {
			sm.launchActiveField = (sm.launchActiveField + 1) % 3
		} else {
			sm.launchActiveField = (sm.launchActiveField + 2) % 3 // Go backwards
		}

		// Update focus
		sm.launchQueryInput.Blur()
		sm.launchWorkingDir.Blur()

		switch sm.launchActiveField {
		case 0:
			sm.launchQueryInput.Focus()
		case 2:
			sm.launchWorkingDir.Focus()
		}

	case key.Matches(msg, keys.Up), msg.String() == "k":
		// Navigate fields backward
		sm.launchActiveField = (sm.launchActiveField + 2) % 3

		// Update focus
		sm.launchQueryInput.Blur()
		sm.launchWorkingDir.Blur()

		switch sm.launchActiveField {
		case 0:
			sm.launchQueryInput.Focus()
		case 2:
			sm.launchWorkingDir.Focus()
		}

	case key.Matches(msg, keys.Enter):
		switch sm.launchActiveField {
		case 0:
			// Open modal editor for query field
			content := sm.savedQueryContent
			if content == "" {
				content = sm.launchQueryInput.Value()
			}
			sm.modalLines = strings.Split(content, "\n")
			if len(sm.modalLines) == 0 || (len(sm.modalLines) == 1 && sm.modalLines[0] == "") {
				sm.modalLines = []string{""}
			}
			sm.modalCursor = 0
			sm.modalType = "query"
			sm.viewState = queryModalView
		case 2:
			// Open modal editor for working directory field
			sm.modalQuery = sm.launchWorkingDir.Value()
			sm.modalLines = strings.Split(sm.modalQuery, "\n")
			if len(sm.modalLines) == 0 || (len(sm.modalLines) == 1 && sm.modalLines[0] == "") {
				sm.modalLines = []string{""}
			}
			sm.modalCursor = 0
			sm.modalType = "workingdir"
			sm.viewState = queryModalView
		}

	case msg.String() == "c", msg.String() == "ctrl+enter":
		// Launch session with 'c' or Ctrl+Enter (only if query has content)
		query := sm.savedQueryContent
		if query == "" {
			query = sm.launchQueryInput.Value()
		}
		if query != "" {
			model := []string{"", "opus", "sonnet"}[sm.launchModelSelect]
			workingDir := sm.launchWorkingDir.Value()
			// Use current working directory if none specified
			if workingDir == "" {
				if cwd, err := os.Getwd(); err == nil {
					workingDir = cwd
				}
			}
			return launchSession(m.daemonClient, query, model, workingDir)
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
		// Both text fields now use modal editors only
		// No direct text input in the form
	}

	return nil
}

// updateQueryModalView handles key events in the query modal editor
func (sm *sessionModel) updateQueryModalView(msg tea.KeyMsg, m *model) tea.Cmd {
	// Handle ONLY specific keys explicitly - everything else is text input
	keyStr := msg.String()

	switch keyStr {
	case "esc":
		// Save modal content and return
		content := strings.Join(sm.modalLines, "\n")
		switch sm.modalType {
		case "query":
			sm.savedQueryContent = content // Store full multiline content
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
					return nil
				}
			}
			sm.launchWorkingDir.SetValue(dir)
		}
		sm.viewState = launchSessionView

	case "ctrl+enter":
		// Save and submit
		content := strings.Join(sm.modalLines, "\n")
		switch sm.modalType {
		case "query":
			sm.savedQueryContent = content // Store full multiline content
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
					return nil
				}
			}
			sm.launchWorkingDir.SetValue(dir)
		}

		// Launch if query has content
		query := sm.savedQueryContent
		if query == "" {
			query = sm.launchQueryInput.Value()
		}
		if query != "" {
			model := []string{"", "opus", "sonnet"}[sm.launchModelSelect]
			workingDir := sm.launchWorkingDir.Value()
			// Use current working directory if none specified
			if workingDir == "" {
				if cwd, err := os.Getwd(); err == nil {
					workingDir = cwd
				}
			}
			return launchSession(m.daemonClient, query, model, workingDir)
		}

		// If no query, just return to form
		sm.viewState = launchSessionView

	case "up":
		// Only respond to actual arrow keys, not letter bindings
		if sm.modalCursor > 0 {
			sm.modalCursor--
		}

	case "down":
		// Only respond to actual arrow keys, not letter bindings
		if sm.modalCursor < len(sm.modalLines)-1 {
			sm.modalCursor++
		}

	case "enter":
		if sm.modalType == "workingdir" {
			// Working directory doesn't allow multiline - ignore enter
			return nil
		}
		// Insert new line for query field
		currentLine := sm.modalLines[sm.modalCursor]
		sm.modalLines[sm.modalCursor] = currentLine // Keep current line content
		// Insert new empty line after current
		sm.modalLines = append(sm.modalLines[:sm.modalCursor+1], sm.modalLines[sm.modalCursor:]...)
		sm.modalLines[sm.modalCursor+1] = ""
		sm.modalCursor++

	case "backspace":
		if len(sm.modalLines[sm.modalCursor]) > 0 {
			// Remove last character from current line
			sm.modalLines[sm.modalCursor] = sm.modalLines[sm.modalCursor][:len(sm.modalLines[sm.modalCursor])-1]
		} else if sm.modalCursor > 0 {
			// Remove empty line and move up
			sm.modalLines = append(sm.modalLines[:sm.modalCursor], sm.modalLines[sm.modalCursor+1:]...)
			sm.modalCursor--
		}

	case "tab":
		// Insert tab character
		sm.modalLines[sm.modalCursor] += "\t"

	case "ctrl+v", "cmd+v":
		// Read from clipboard and paste
		text, err := clipboard.ReadAll()
		if err != nil {
			// Silently ignore clipboard errors
			return nil
		}

		// Split pasted text into lines
		lines := strings.Split(text, "\n")

		if len(lines) == 1 {
			// Single line paste - insert at current cursor position
			sm.modalLines[sm.modalCursor] += lines[0]
		} else {
			// Multi-line paste
			// Insert first line at current position
			sm.modalLines[sm.modalCursor] += lines[0]

			// Insert remaining lines after current line
			for i, line := range lines[1:] {
				insertPos := sm.modalCursor + i + 1
				// Insert new line at position
				sm.modalLines = append(sm.modalLines[:insertPos], sm.modalLines[insertPos-1:]...)
				sm.modalLines[insertPos] = line
			}

			// Move cursor to end of pasted content
			sm.modalCursor += len(lines) - 1
		}

	default:
		// Everything else is text input - including k, j, c, numbers, etc.
		if len(keyStr) == 1 && keyStr[0] >= 32 && keyStr[0] <= 126 {
			sm.modalLines[sm.modalCursor] += keyStr
		}
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
	case queryModalView:
		return sm.renderQueryModalView(m)
	default:
		return sm.renderListView(m)
	}
}

// renderListView renders the sessions list in table format
func (sm *sessionModel) renderListView(m *model) string {
	if len(sm.sortedSessions) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		content := emptyStyle.Render("No sessions. Press [l] to launch a new session.")
		sm.viewport.SetContent(content)
		return sm.viewport.View()
	}

	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1)
	s.WriteString(headerStyle.Render("Claude Sessions") + "\n\n")

	// Column headers with proper centering
	headerRow := centerText("Status", 8) +
		centerText("Modified", 11) +
		centerText("Created", 11) +
		centerText("Working Dir", 20) +
		centerText("Model", 9) +
		"Query"
	headerColStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("243")).
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true)
	s.WriteString(headerColStyle.Render(headerRow) + "\n")

	// Sessions list
	for i, sess := range sm.sortedSessions {
		selected := i == sm.cursor

		// Status icon
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

		// Relative times
		modifiedTime := formatRelativeTime(sess.LastActivityAt)
		createdTime := formatRelativeTime(sess.StartTime)

		// Working directory (truncated)
		workingDir := sess.WorkingDir
		if workingDir == "" {
			workingDir = "~"
		} else if len(workingDir) > 18 {
			workingDir = "..." + workingDir[len(workingDir)-15:]
		}

		// Model name (shortened)
		modelName := sess.Model
		if modelName == "" {
			modelName = "default"
		} else if strings.Contains(modelName, "opus") {
			modelName = "opus"
		} else if strings.Contains(modelName, "sonnet") {
			modelName = "sonnet"
		}

		// Query preview (truncated to fit remaining space)
		queryPreview := truncate(sess.Query, 45)

		// Build the row with properly aligned columns
		row := centerText(statusIcon, 8) +
			centerText(modifiedTime, 11) +
			centerText(createdTime, 11) +
			leftPadText(workingDir, 20) +
			centerText(modelName, 9) +
			queryPreview

		// Apply styling
		itemStyle := lipgloss.NewStyle().Padding(0, 1)
		if selected {
			itemStyle = itemStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}

		s.WriteString(itemStyle.Render(row) + "\n")
	}

	// Instructions
	s.WriteString("\n")
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)
	s.WriteString(instructionStyle.Render("Press [c] to create new session, [enter] to view details"))

	// Set content in viewport and return the viewport view
	sm.viewport.SetContent(s.String())
	return sm.viewport.View()
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

	// Show Claude Session ID for resume capability, fall back to internal ID
	displayID := sess.ClaudeSessionID
	if displayID == "" {
		displayID = sess.ID
	}
	content.WriteString(labelStyle.Render("Session ID:") + valueStyle.Render(displayID) + "\n")
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

	// Query
	queryStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252")).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("237")).
		Padding(1, 2)

	content.WriteString(labelStyle.Render("Query:") + "\n")
	content.WriteString(queryStyle.Render(sess.Query) + "\n\n")

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

	// Query field - show hint instead of text input
	queryLabel := "Query:"
	if sm.launchActiveField == 0 {
		queryLabel = activeStyle.Render(queryLabel)
	} else {
		queryLabel = labelStyle.Render(queryLabel)
	}
	s.WriteString(queryLabel + "\n")

	// Show query content or hint
	queryValue := sm.savedQueryContent
	if queryValue == "" {
		queryValue = sm.launchQueryInput.Value()
	}

	if queryValue == "" {
		// Show hint when no query is set
		hintStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)
		if sm.launchActiveField == 0 {
			hintStyle = hintStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}
		s.WriteString(hintStyle.Render("Press Enter to edit") + "\n\n")
	} else {
		// Show query preview
		previewStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252")).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("237")).
			Padding(0, 1).
			Width(60)
		if sm.launchActiveField == 0 {
			previewStyle = previewStyle.
				BorderForeground(lipgloss.Color("205"))
		}

		// Show up to 5 lines for preview
		lines := strings.Split(queryValue, "\n")
		var preview string
		if len(lines) > 5 {
			preview = strings.Join(lines[:5], "\n") + "\n..."
		} else {
			preview = queryValue
		}
		s.WriteString(previewStyle.Render(preview) + "\n\n")
	}

	// Model selection
	modelLabel := "Model:"
	if sm.launchActiveField == 1 {
		modelLabel = activeStyle.Render(modelLabel)
	} else {
		modelLabel = labelStyle.Render(modelLabel)
	}
	s.WriteString(modelLabel + "\n")

	models := []string{"Default", "Claude 4 Opus", "Claude 4 Sonnet"}
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

	// Working directory field - show hint instead of text input
	dirLabel := "Working Dir:"
	if sm.launchActiveField == 2 {
		dirLabel = activeStyle.Render(dirLabel)
	} else {
		dirLabel = labelStyle.Render(dirLabel)
	}
	s.WriteString(dirLabel + "\n")

	// Show working directory content or hint
	workingDirValue := sm.launchWorkingDir.Value()

	if workingDirValue == "" {
		// Show hint when no working directory is set
		hintStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)
		if sm.launchActiveField == 2 {
			hintStyle = hintStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}
		s.WriteString(hintStyle.Render("Press Enter to edit (defaults to current directory)") + "\n\n")
	} else {
		// Show working directory preview
		previewStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252")).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("237")).
			Padding(0, 1).
			Width(60)
		if sm.launchActiveField == 2 {
			previewStyle = previewStyle.
				BorderForeground(lipgloss.Color("205"))
		}

		s.WriteString(previewStyle.Render(workingDirValue) + "\n\n")
	}

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)

	instructions := []string{
		"[tab/j/k] navigate fields",
		"[enter] edit field",
		"[←/→] select model",
		"[c] launch session",
		"[esc] cancel",
	}
	s.WriteString(instructionStyle.Render(strings.Join(instructions, " • ")))

	return s.String()
}

// renderQueryModalView renders the full-screen query editor modal
func (sm *sessionModel) renderQueryModalView(m *model) string {
	var s strings.Builder

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1).
		Width(m.width)

	title := "✏️  Edit Query"
	if sm.modalType == "workingdir" {
		title = "📁  Edit Working Directory"
	}
	s.WriteString(headerStyle.Render(title) + "\n\n")

	// Content area
	contentHeight := m.height - 6 // Header + instructions
	editorStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("237")).
		Padding(1, 2).
		Width(m.width - 4).
		Height(contentHeight)

	// Build editor content with line numbers and cursor
	var content strings.Builder
	for i, line := range sm.modalLines {
		lineNumStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Width(3)

		lineStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))

		if i == sm.modalCursor {
			// Highlight current line
			lineStyle = lineStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}

		lineNum := fmt.Sprintf("%2d", i+1)
		content.WriteString(lineNumStyle.Render(lineNum) + " " + lineStyle.Render(line))

		if i == sm.modalCursor {
			// Add cursor indicator
			content.WriteString("█")
		}

		if i < len(sm.modalLines)-1 {
			content.WriteString("\n")
		}
	}

	s.WriteString(editorStyle.Render(content.String()) + "\n")

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Width(m.width)

	instructions := []string{
		"[↑/↓] move cursor",
		"[enter] new line",
		"[backspace] delete",
		"[esc] save & return",
		"[ctrl+enter] save & launch",
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

// formatRelativeTime formats a timestamp as a relative time (e.g., "2m ago", "1h ago")
func formatRelativeTime(t time.Time) string {
	now := time.Now()
	diff := now.Sub(t)

	if diff < time.Minute {
		return "now"
	} else if diff < time.Hour {
		return fmt.Sprintf("%dm ago", int(diff.Minutes()))
	} else if diff < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(diff.Hours()))
	} else if diff < 7*24*time.Hour {
		return fmt.Sprintf("%dd ago", int(diff.Hours()/24))
	}

	// For older items, show the date
	return t.Format("Jan 2")
}

// centerText centers text within a fixed width column
func centerText(text string, width int) string {
	if len(text) >= width {
		return text[:width]
	}

	totalPadding := width - len(text)
	leftPadding := totalPadding / 2
	rightPadding := totalPadding - leftPadding

	return strings.Repeat(" ", leftPadding) + text + strings.Repeat(" ", rightPadding)
}

// leftPadText left-aligns text within a fixed width column
func leftPadText(text string, width int) string {
	if len(text) >= width {
		return text[:width]
	}
	return text + strings.Repeat(" ", width-len(text))
}
