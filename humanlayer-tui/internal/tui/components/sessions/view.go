// Package sessions implements the sessions UI component.
package sessions

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/util"
)

// View renders the sessions tab
func (m *Model) View() string {
	switch m.viewState {
	case domain.SessionDetailView:
		return m.renderSessionDetailView()
	case domain.LaunchSessionView:
		return m.renderLaunchSessionView()
	case domain.QueryModalView:
		return m.renderQueryModalView()
	default:
		return m.renderListView()
	}
}

// renderListView renders the sessions list in table format
func (m *Model) renderListView() string {
	if len(m.sortedSessions) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		content := emptyStyle.Render("No sessions. Press [l] to launch a new session.")
		m.viewport.SetContent(content)
		return m.viewport.View()
	}

	var s strings.Builder

	// Column headers with proper centering
	headerRow := util.CenterText("Status", 8) +
		util.CenterText("Modified", 11) +
		util.CenterText("Created", 11) +
		util.CenterText("Working Dir", 20) +
		util.CenterText("Model", 9) +
		util.CenterText("Turns", 6) +
		"Query"
	headerColStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("243")).
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true)
	s.WriteString(headerColStyle.Render(headerRow) + "\n")

	// Sessions list
	for i, sess := range m.sortedSessions {
		selected := i == m.cursor

		// Status icon
		statusIcon := "⏸"
		switch sess.Status {
		case "waiting_input":
			statusIcon = "⏳"
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
			// Try to inherit from parent session if this is a child session
			if sess.ParentSessionID != "" {
				for _, parentSess := range m.sessions {
					if parentSess.ID == sess.ParentSessionID && parentSess.WorkingDir != "" {
						workingDir = parentSess.WorkingDir
						break
					}
				}
			}
			// Fall back to "~" if no inheritance possible
			if workingDir == "" {
				workingDir = "~"
			}
		}
		// Truncate if too long
		if len(workingDir) > 18 {
			workingDir = "..." + workingDir[len(workingDir)-15:]
		}

		// Model name (shortened)
		modelName := sess.Model
		if modelName == "" {
			// Try to inherit from parent session if this is a child session
			if sess.ParentSessionID != "" {
				for _, parentSess := range m.sessions {
					if parentSess.ID == sess.ParentSessionID && parentSess.Model != "" {
						modelName = parentSess.Model
						break
					}
				}
			}
			// Fall back to "default" if no inheritance possible
			if modelName == "" {
				modelName = "default"
			}
		}
		// Shorten model names for display
		if strings.Contains(modelName, "opus") {
			modelName = "opus"
		} else if strings.Contains(modelName, "sonnet") {
			modelName = "sonnet"
		}

		// Turn count
		turnCount := "-"
		if sess.Result != nil && sess.Result.NumTurns > 0 {
			if sess.Result.NumTurns >= 1000 {
				turnCount = fmt.Sprintf("%.1fk", float64(sess.Result.NumTurns)/1000)
			} else {
				turnCount = fmt.Sprintf("%d", sess.Result.NumTurns)
			}
		}

		// Query preview (truncated to fit remaining space)
		queryPreview := util.Truncate(sess.Query, 39)

		// Build the row with properly aligned columns
		row := util.CenterText(statusIcon, 8) +
			util.CenterText(modifiedTime, 11) +
			util.CenterText(createdTime, 11) +
			util.LeftPadText(workingDir, 20) +
			util.CenterText(modelName, 9) +
			util.CenterText(turnCount, 6) +
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
	m.viewport.SetContent(s.String())
	return m.viewport.View()
}

// buildSessionDetailContent builds the content string for session details
func (m *Model) buildSessionDetailContent() string {
	if m.selectedSession == nil {
		return ""
	}

	sess := m.selectedSession
	var content strings.Builder

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
	if len(m.sessionApprovals) > 0 {
		content.WriteString(labelStyle.Render("Approvals:") + "\n")
		approvalStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("245")).
			PaddingLeft(2)

		for _, approval := range m.sessionApprovals {
			icon := "📋"
			if approval.Type == domain.HumanContactRequest {
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

	return content.String()
}

// renderSessionDetailView renders the detailed view of a session
func (m *Model) renderSessionDetailView() string {
	if m.selectedSession == nil {
		return "No session selected"
	}

	// Build the content
	content := m.buildSessionDetailContent()

	// Apply scrolling
	lines := strings.Split(content, "\n")
	// Calculate content height properly (terminal - tab bar - status bar - header)
	contentHeight := m.height - domain.TabBarHeight - domain.StatusBarHeight
	visibleHeight := contentHeight - 3 // Account for session detail header
	if visibleHeight < domain.MinContentHeight {
		visibleHeight = domain.MinContentHeight
	}

	if m.sessionDetailScroll > len(lines)-visibleHeight {
		m.sessionDetailScroll = len(lines) - visibleHeight
		if m.sessionDetailScroll < 0 {
			m.sessionDetailScroll = 0
		}
	}

	// Build visible content
	var visible strings.Builder
	start := m.sessionDetailScroll
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
func (m *Model) renderLaunchSessionView() string {
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
	if m.launchActiveField == 0 {
		queryLabel = activeStyle.Render(queryLabel)
	} else {
		queryLabel = labelStyle.Render(queryLabel)
	}
	s.WriteString(queryLabel + "\n")

	// Show query content or hint
	queryValue := m.savedQueryContent
	if queryValue == "" {
		queryValue = m.launchQueryInput.Value()
	}

	if queryValue == "" {
		// Show hint when no query is set
		hintStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)
		if m.launchActiveField == 0 {
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
		if m.launchActiveField == 0 {
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
	if m.launchActiveField == 1 {
		modelLabel = activeStyle.Render(modelLabel)
	} else {
		modelLabel = labelStyle.Render(modelLabel)
	}
	s.WriteString(modelLabel + "\n")

	models := []string{"Default", "Claude 4 Opus", "Claude 4 Sonnet"}
	modelOptions := ""
	for i, model := range models {
		optionStyle := lipgloss.NewStyle().Padding(0, 2)
		if i == m.launchModelSelect {
			optionStyle = optionStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}
		modelOptions += optionStyle.Render(model)
	}
	s.WriteString(modelOptions + "\n\n")

	// Working directory field - show hint instead of text input
	dirLabel := "Working Dir:"
	if m.launchActiveField == 2 {
		dirLabel = activeStyle.Render(dirLabel)
	} else {
		dirLabel = labelStyle.Render(dirLabel)
	}
	s.WriteString(dirLabel + "\n")

	// Show working directory content or hint
	workingDirValue := m.launchWorkingDir.Value()

	if workingDirValue == "" {
		// Show hint when no working directory is set
		hintStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)
		if m.launchActiveField == 2 {
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
		if m.launchActiveField == 2 {
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
func (m *Model) renderQueryModalView() string {
	var s strings.Builder

	// Calculate content dimensions (account for tab bar and status bar)
	contentWidth := m.width - 2
	if contentWidth < domain.MinContentWidth {
		contentWidth = domain.MinContentWidth
	}
	contentHeight := m.height - domain.TabBarHeight - domain.StatusBarHeight
	if contentHeight < domain.MinContentHeight {
		contentHeight = domain.MinContentHeight
	}

	// Header
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		MarginBottom(1).
		Width(contentWidth)

	title := "✏️  Edit Query"
	if m.modalType == "workingdir" {
		title = "📁  Edit Working Directory"
	}
	s.WriteString(headerStyle.Render(title) + "\n\n")

	// Content area
	modalContentHeight := contentHeight - 6 // Header + instructions
	if modalContentHeight < 3 {
		modalContentHeight = 3
	}
	editorStyle := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("237")).
		Padding(1, 2).
		Width(contentWidth - 4).
		Height(modalContentHeight)

	// Build editor content with line numbers and cursor
	var content strings.Builder
	for i, line := range m.modalLines {
		lineNumStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Width(3)

		lineStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))

		if i == m.modalCursor {
			// Highlight current line
			lineStyle = lineStyle.
				Background(lipgloss.Color("235")).
				Foreground(lipgloss.Color("215"))
		}

		lineNum := fmt.Sprintf("%2d", i+1)
		content.WriteString(lineNumStyle.Render(lineNum) + " " + lineStyle.Render(line))

		if i == m.modalCursor {
			// Add cursor indicator
			content.WriteString("█")
		}

		if i < len(m.modalLines)-1 {
			content.WriteString("\n")
		}
	}

	s.WriteString(editorStyle.Render(content.String()) + "\n")

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Width(contentWidth)

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
