// Package conversation implements the conversation UI component.
package conversation

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/util"
)

// View renders the conversation view
func (m *Model) View(width, height int) string {
	// Always update size based on current terminal dimensions
	m.UpdateSize(width, height)

	if m.loading {
		loadingStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true).
			Padding(2, 0)
		return loadingStyle.Render("Loading conversation...")
	}

	if m.error != nil {
		errorStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(2, 0)
		// Use the full width for conversation errors since they replace content
		errorMsg := util.PreprocessError(m.error.Error())
		return errorStyle.Render(fmt.Sprintf("Error: %s", errorMsg))
	}

	if m.session == nil {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		return emptyStyle.Render("No conversation selected")
	}

	var s strings.Builder

	// Header with session info
	s.WriteString(m.renderHeader(width) + "\n")

	// Conversation content
	s.WriteString(m.viewport.View())

	// Input prompts (already includes leading newline if needed)
	s.WriteString(m.renderInputPrompts(width))

	return s.String()
}

// renderHeader renders the conversation header with session metadata
func (m *Model) renderHeader(width int) string {
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true).
		Width(width-2).
		Padding(0, 1)

	// Status icon
	statusIcon := "⏸"
	switch m.session.Status {
	case "starting":
		statusIcon = "🔄"
	case "running":
		statusIcon = "🟢"
	case "completed":
		statusIcon = "✅"
	case "failed":
		statusIcon = "❌"
	case "waiting_input":
		statusIcon = "⏳"
	}

	// Build header content
	title := fmt.Sprintf("%s Conversation", statusIcon)
	if m.session.Model != "" && m.session.Model != "default" {
		title += fmt.Sprintf(" (%s)", m.session.Model)
	}

	// Add parent indicator if this is a continued session
	if m.session.ParentSessionID != "" {
		title += " [continued]"
	}

	// Add pending approval count if any
	if m.PendingApprovalCount() > 0 {
		approvalStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("226")).
			Bold(true)
		approvalText := fmt.Sprintf(" | %d pending approval", m.PendingApprovalCount())
		if m.PendingApprovalCount() > 1 {
			approvalText = fmt.Sprintf(" | %d pending approvals", m.PendingApprovalCount())
		}
		title += approvalStyle.Render(approvalText)
	}

	return headerStyle.Render(title)
}

// renderConversationContent generates the full conversation content
func (m *Model) renderConversationContent() string {
	if len(m.events) == 0 {
		return lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Render("No conversation events yet...")
	}

	var content strings.Builder

	// Show initial query
	if m.session.Query != "" {
		content.WriteString(m.renderUserMessage(m.session.Query))
		content.WriteString("\n\n")
	}

	// Render all events
	for i, event := range m.events {
		content.WriteString(m.renderEvent(&event, i))

		// Add spacing between events (except last)
		if i < len(m.events)-1 {
			content.WriteString("\n\n")
		}
	}

	return content.String()
}

// renderEvent renders a single conversation event with its index
func (m *Model) renderEvent(event *rpc.ConversationEvent, eventIndex int) string {
	switch event.EventType {
	case "message":
		switch event.Role {
		case "user":
			return m.renderUserMessage(event.Content)
		case "assistant":
			return m.renderAssistantMessage(event.Content)
		}

	case "tool_call":
		return m.renderToolCall(event, eventIndex)

	case "tool_result":
		return m.renderToolResult(event)
	}

	// Fallback for unknown event types
	return lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Render(fmt.Sprintf("[%s event]", event.EventType))
}

// renderUserMessage renders a user message
func (m *Model) renderUserMessage(content string) string {
	userStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("39")). // Blue
		Bold(true)

	return userStyle.Render("👤 User:") + "\n" + content
}

// renderAssistantMessage renders an assistant message
func (m *Model) renderAssistantMessage(content string) string {
	assistantStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252")). // Light gray
		Bold(true)

	return assistantStyle.Render("🤖 Assistant:") + "\n" + content
}

// renderToolCall renders a tool call event
func (m *Model) renderToolCall(event *rpc.ConversationEvent, eventIndex int) string {
	var s strings.Builder

	// Tool call header with status icon
	toolIcon := "🔧"
	statusText := ""
	switch event.ApprovalStatus {
	case "pending":
		toolIcon = "⏳"
		statusText = " (pending approval"

		// Find which approval number this is
		approvalNumber := 0
		for i, idx := range m.pendingApprovalIndices {
			if idx == eventIndex {
				approvalNumber = i + 1
				break
			}
		}

		if approvalNumber > 0 && m.PendingApprovalCount() > 1 {
			statusText += fmt.Sprintf(" %d of %d", approvalNumber, m.PendingApprovalCount())
		}
		statusText += ")"

		// Check if this is the current pending approval
		if eventIndex == m.currentApprovalIndex {
			statusText += " - Press [y] to approve, [n] to deny"
		}
	case "approved":
		toolIcon = "✅"
		statusText = " (approved)"
	case "denied":
		toolIcon = "❌"
		statusText = " (denied)"
	}

	toolStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("215")). // Orange
		Bold(true)

	s.WriteString(toolStyle.Render(fmt.Sprintf("%s Tool: %s%s", toolIcon, event.ToolName, statusText)))

	// Show simplified tool input (just the function signature, not full JSON)
	if event.ToolInputJSON != "" {
		// Just show a simple summary instead of full JSON
		s.WriteString("\n" + event.ToolInputJSON)
	}

	return s.String()
}

// renderToolResult renders a tool result event with context-aware formatting
func (m *Model) renderToolResult(event *rpc.ConversationEvent) string {
	if event.ToolResultContent == "" {
		return "" // No content to show
	}

	// TODO: Approval Correlation Decision
	// Currently, we correlate tool results with tool calls on the frontend by matching ToolID.
	// This works but has limitations:
	// 1. It requires iterating through all events to find matches
	// 2. The correlation logic is duplicated in multiple UI components
	//
	// Moving this to the backend would provide:
	// - Single source of truth for approval status
	// - Better performance (no client-side iteration)
	// - Consistent behavior across all clients
	// - Simplified UI code
	//
	// However, keeping it on the frontend allows:
	// - Flexibility in how different UIs display the correlation
	// - No backend changes required
	// - Local state management
	//
	// Recommendation: Move to backend in a future iteration for better architecture

	// Find the corresponding tool_call by looking for the tool_call with matching tool_id
	var correspondingToolCall *rpc.ConversationEvent
	for i := range m.events {
		if m.events[i].EventType == "tool_call" && m.events[i].ToolID == event.ToolResultForID {
			correspondingToolCall = &m.events[i]
			break
		}
	}

	// If the corresponding tool call was denied, render as denial feedback
	if correspondingToolCall != nil && correspondingToolCall.ApprovalStatus == "denied" {
		return m.renderDenialReason(event.ToolResultContent)
	}

	// Otherwise render as tool output with truncation
	return m.renderToolOutput(event.ToolResultContent)
}

// renderDenialReason renders user denial feedback with distinctive styling
func (m *Model) renderDenialReason(content string) string {
	denialStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("196")). // Red
		Bold(true)

	return denialStyle.Render("💬 Denial Reason:") + "\n" + content
}

// renderToolOutput renders tool output with smart truncation
func (m *Model) renderToolOutput(content string) string {
	const maxLines = 5
	const maxChars = 200

	toolOutputStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("245")). // Gray
		Italic(true)

	// Split into lines for line-based truncation
	lines := strings.Split(content, "\n")

	// Truncate by lines if too many
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		lines = append(lines, "...")
		content = strings.Join(lines, "\n")
	}

	// Truncate by characters if still too long
	if len(content) > maxChars {
		content = content[:maxChars-3] + "..."
	}

	return toolOutputStyle.Render("📄 Tool Output:") + "\n" + content
}

// renderInputPrompts renders any active input prompts
func (m *Model) renderInputPrompts(width int) string {
	var s strings.Builder

	// Add leading newline to separate from viewport
	s.WriteString("\n")

	// Approval prompt
	if m.showApprovalPrompt {
		promptStyle := lipgloss.NewStyle().
			Background(lipgloss.Color("235")).
			Foreground(lipgloss.Color("215")).
			Padding(1, 2).
			Width(width - 4).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("205"))

		promptContent := "❌ Deny with reason:\n" + m.approvalInput.View() + "\n\nPress [enter] to submit, [esc] to cancel"
		s.WriteString(promptStyle.Render(promptContent) + "\n")
	}

	// Resume prompt
	if m.showResumePrompt {
		promptStyle := lipgloss.NewStyle().
			Background(lipgloss.Color("235")).
			Foreground(lipgloss.Color("215")).
			Padding(1, 2).
			Width(width - 4).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("205"))

		promptContent := "🔄 Continue session:\n" + m.resumeInput.View() + "\n\nPress [enter] to submit, [esc] to cancel"
		s.WriteString(promptStyle.Render(promptContent) + "\n")
	}

	// Status line
	if !m.showApprovalPrompt && !m.showResumePrompt {
		statusItems := []string{}

		// Navigation hints
		statusItems = append(statusItems, "[esc] back", "[↑/↓] scroll")

		// Approval actions
		if m.PendingApproval() != nil {
			statusItems = append(statusItems, "[y] approve", "[n] deny")
		}

		// Resume action
		if m.session != nil && m.session.Status == "completed" {
			statusItems = append(statusItems, "[r] resume")
		}

		// Parent navigation
		if m.session != nil && m.session.ParentSessionID != "" {
			statusItems = append(statusItems, "[p] parent")
		}

		statusItems = append(statusItems, "[F5] refresh")

		statusStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true)

		s.WriteString(statusStyle.Render(strings.Join(statusItems, " • ")))
	}

	return s.String()
}
