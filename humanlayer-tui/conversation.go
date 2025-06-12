package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/hld/client"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// conversationModel contains all state related to the conversation view
type conversationModel struct {
	sessionID       string
	claudeSessionID string
	session         *rpc.SessionState
	events          []rpc.ConversationEvent
	viewport        viewport.Model

	// For inline approval handling
	pendingApprovals   []*rpc.ConversationEvent
	pendingApproval    *rpc.ConversationEvent // Current approval being processed
	approvalInput      textinput.Model
	showApprovalPrompt bool

	// For resume functionality
	resumeInput      textinput.Model
	showResumePrompt bool

	// Parent session data for inheritance (stored during resume)
	parentModel      string
	parentWorkingDir string

	// Loading states
	loading     bool
	error       error
	lastRefresh time.Time

	// Polling state for active sessions
	isPolling  bool
	pollTicker *time.Ticker

	// Scroll position tracking
	wasAtBottom bool // Track if user was at bottom before update
}

// newConversationModel creates a new conversation model
func newConversationModel() conversationModel {
	vp := viewport.New(80, 20)
	vp.SetContent("")

	approvalInput := textinput.New()
	approvalInput.Placeholder = "Optional comment..."
	approvalInput.CharLimit = 500
	approvalInput.Width = 60

	resumeInput := textinput.New()
	resumeInput.Placeholder = "Enter your message to continue..."
	resumeInput.CharLimit = 1000
	resumeInput.Width = 80

	return conversationModel{
		viewport:      vp,
		approvalInput: approvalInput,
		resumeInput:   resumeInput,
		loading:       false,
	}
}

// setSession initializes the conversation view for a specific session
func (cm *conversationModel) setSession(sessionID string) {
	cm.sessionID = sessionID
	cm.claudeSessionID = "" // Will be populated from session state
	cm.loading = true
	cm.error = nil
	cm.clearApprovalState()
	cm.clearResumeState()
	cm.stopPolling() // Stop any existing polling
	// Clear parent data when switching sessions
	cm.parentModel = ""
	cm.parentWorkingDir = ""
	// Reset scroll tracking
	cm.wasAtBottom = true
}

// clearApprovalState resets approval-related state
func (cm *conversationModel) clearApprovalState() {
	cm.pendingApproval = nil
	cm.showApprovalPrompt = false
	cm.approvalInput.Reset()
}

// clearResumeState resets resume-related state
func (cm *conversationModel) clearResumeState() {
	cm.showResumePrompt = false
	cm.resumeInput.Reset()
}

// startPolling begins 3-second polling for active sessions
func (cm *conversationModel) startPolling() tea.Cmd {
	if cm.isPolling {
		return nil // Already polling
	}

	cm.isPolling = true
	cm.pollTicker = time.NewTicker(3 * time.Second)

	return func() tea.Msg {
		<-cm.pollTicker.C
		return pollRefreshMsg{sessionID: cm.sessionID}
	}
}

// stopPolling stops the polling timer
func (cm *conversationModel) stopPolling() {
	if cm.pollTicker != nil {
		cm.pollTicker.Stop()
		cm.pollTicker = nil
	}
	cm.isPolling = false
}

// isActiveSession returns true if session is running or starting
func (cm *conversationModel) isActiveSession() bool {
	return cm.session != nil && (cm.session.Status == "running" || cm.session.Status == "starting")
}

// updateSize updates the viewport dimensions based on terminal size
func (cm *conversationModel) updateSize(width, height int) {
	// Calculate dynamic height based on actual content
	// Start with full height minus tab bar (2 lines) and status bar (1 line)
	availableHeight := height - 3

	// Account for conversation header (2 lines)
	availableHeight -= 2

	// Account for bottom content dynamically
	bottomContentHeight := cm.calculateBottomContentHeight()
	availableHeight -= bottomContentHeight

	// Ensure minimum height
	viewportHeight := availableHeight
	if viewportHeight < 5 {
		viewportHeight = 5 // Minimum height
	}

	viewportWidth := width - 4 // Some padding
	if viewportWidth < 20 {
		viewportWidth = 20 // Minimum width
	}

	cm.viewport.Width = viewportWidth
	cm.viewport.Height = viewportHeight

	// Also update input field widths
	cm.approvalInput.Width = viewportWidth - 10
	cm.resumeInput.Width = viewportWidth - 10
}

// calculateBottomContentHeight calculates the height of dynamic bottom content
func (cm *conversationModel) calculateBottomContentHeight() int {
	height := 0

	// Leading newline that separates input prompts from viewport
	height += 1

	// Account for input prompts
	if cm.showApprovalPrompt || cm.showResumePrompt {
		// Input prompt with border, padding, and multi-line content:
		// - Top border: 1 line
		// - Top padding: 1 line
		// - Prompt text: 1 line
		// - Input field: 1 line
		// - Helper text: 1 line
		// - Bottom padding: 1 line
		// - Bottom border: 1 line
		// - Trailing newline: 1 line
		height += 8
	} else {
		// Status line when no prompts are shown
		height += 1
	}

	return height
}

// Update handles messages for the conversation view
func (cm *conversationModel) Update(msg tea.Msg, m *model) tea.Cmd {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		// Handle window resize - update viewport dimensions
		cm.updateSize(m.width, m.height)
		return nil

	case tea.KeyMsg:
		// Handle different input modes
		if cm.showApprovalPrompt && cm.approvalInput.Focused() {
			return cm.updateApprovalInput(msg, m)
		}
		if cm.showResumePrompt && cm.resumeInput.Focused() {
			return cm.updateResumeInput(msg, m)
		}

		// Regular conversation view navigation
		return cm.updateConversationView(msg, m)

	case fetchConversationMsg:
		cm.loading = false
		if msg.err != nil {
			cm.error = msg.err
			return nil
		}
		cm.session = msg.session
		cm.events = msg.events
		cm.lastRefresh = time.Now()

		// If this is a child session with missing data, use parent data stored during resume
		if cm.session != nil && cm.session.ParentSessionID != "" {
			if cm.session.Model == "" && cm.parentModel != "" {
				cm.session.Model = cm.parentModel
			}
			if cm.session.WorkingDir == "" && cm.parentWorkingDir != "" {
				cm.session.WorkingDir = cm.parentWorkingDir
			}
		}

		// Cache the conversation for future use (if session and events are not nil)
		if cm.session != nil && cm.events != nil {
			m.conversationCache.put(cm.sessionID, cm.session, cm.events)
		}

		// Find any pending approvals
		cm.findPendingApproval()

		// Store current scroll position before updating content
		cm.wasAtBottom = cm.viewport.AtBottom()

		// Update viewport content
		content := cm.renderConversationContent()
		cm.viewport.SetContent(content)

		// Only auto-scroll if user was already at bottom or this is initial load
		if cm.wasAtBottom || cm.lastRefresh.IsZero() {
			cm.viewport.GotoBottom()
		}

		// Start polling if this is an active session
		if cm.isActiveSession() && !cm.isPolling {
			return cm.startPolling()
		}

		return nil

	case pollRefreshMsg:
		// Only refresh if we're still viewing the same session and it's active
		if msg.sessionID == cm.sessionID && cm.isActiveSession() {
			// Remember scroll position before refresh
			cm.wasAtBottom = cm.viewport.AtBottom()
			// Silently refresh in background - don't show loading state
			cmds = append(cmds, fetchConversationSilent(m.daemonClient, cm.sessionID))
			// Continue polling
			if cm.isPolling {
				cmds = append(cmds, cm.startPolling())
			}
		}
		return tea.Batch(cmds...)

	case approvalSentMsg:
		if msg.err != nil {
			cm.error = msg.err
			return nil
		}
		// Clear approval state and refresh conversation
		cm.clearApprovalState()
		// Invalidate cache since approval status changed
		m.conversationCache.invalidate(cm.sessionID)
		return fetchConversation(m.daemonClient, cm.sessionID)

	case continueSessionMsg:
		if msg.err != nil {
			cm.error = msg.err
			return nil
		}
		// Navigate to the new session
		cm.clearResumeState()
		cm.setSession(msg.sessionID)
		return fetchConversation(m.daemonClient, msg.sessionID)
	}

	return tea.Batch(cmds...)
}

// updateConversationView handles key events in the main conversation view
func (cm *conversationModel) updateConversationView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		// Go back to previous view
		return nil

	case key.Matches(msg, keys.Up), key.Matches(msg, keys.Down),
		msg.String() == "pgup", msg.String() == "pgdown",
		msg.String() == "home", msg.String() == "end":
		// Scroll conversation
		var cmd tea.Cmd
		cm.viewport, cmd = cm.viewport.Update(msg)
		// Update scroll position tracking after manual scrolling
		cm.wasAtBottom = cm.viewport.AtBottom()
		return cmd

	case key.Matches(msg, keys.Approve):
		// Quick approve pending approval
		if cm.pendingApproval != nil && cm.pendingApproval.ApprovalID != "" {
			return sendApproval(m.daemonClient, cm.pendingApproval.ApprovalID, true, "")
		}

	case key.Matches(msg, keys.Deny):
		// Show approval input for deny with comment
		if cm.pendingApproval != nil {
			cm.showApprovalPrompt = true
			cm.approvalInput.Focus()
			cm.approvalInput.Placeholder = "Reason for denial..."
		}

	case msg.String() == "r":
		// Show resume prompt for completed sessions
		if cm.session != nil && cm.session.Status == "completed" {
			cm.showResumePrompt = true
			cm.resumeInput.Focus()
		}

	case msg.String() == "p":
		// Jump to parent session if this is a continued session
		if cm.session != nil && cm.session.ParentSessionID != "" {
			cm.setSession(cm.session.ParentSessionID)
			return fetchConversation(m.daemonClient, cm.session.ParentSessionID)
		}

	case key.Matches(msg, keys.Refresh):
		// Refresh conversation - invalidate cache to force fresh data
		m.conversationCache.invalidate(cm.sessionID)
		return fetchConversation(m.daemonClient, cm.sessionID)
	}

	return nil
}

// updateApprovalInput handles key events when approval input is focused
func (cm *conversationModel) updateApprovalInput(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		cm.clearApprovalState()
		return nil

	case key.Matches(msg, keys.Enter):
		// Send denial with comment
		if cm.pendingApproval != nil && cm.pendingApproval.ApprovalID != "" {
			comment := cm.approvalInput.Value()
			approvalID := cm.pendingApproval.ApprovalID
			cm.clearApprovalState()
			return sendApproval(m.daemonClient, approvalID, false, comment)
		}
		cm.clearApprovalState()
		return nil

	default:
		// Handle text input
		var cmd tea.Cmd
		cm.approvalInput, cmd = cm.approvalInput.Update(msg)
		return cmd
	}
}

// updateResumeInput handles key events when resume input is focused
func (cm *conversationModel) updateResumeInput(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back), key.Matches(msg, keys.Quit), msg.String() == "ctrl+c":
		// Multiple ways to escape the input
		cm.clearResumeState()
		return nil

	case key.Matches(msg, keys.Enter):
		// Continue session with new message
		if cm.session != nil && cm.sessionID != "" {
			query := cm.resumeInput.Value()
			if query != "" {
				// Store parent session data for inheritance
				cm.parentModel = cm.session.Model
				cm.parentWorkingDir = cm.session.WorkingDir
				return continueSession(m.daemonClient, cm.sessionID, query)
			}
		}
		cm.clearResumeState()
		return nil

	default:
		// Handle text input
		var cmd tea.Cmd
		cm.resumeInput, cmd = cm.resumeInput.Update(msg)
		return cmd
	}
}

// findPendingApproval looks for pending approvals in the conversation
func (cm *conversationModel) findPendingApproval() {
	cm.pendingApprovals = nil
	cm.pendingApproval = nil

	// Find all pending approvals
	for i := range cm.events {
		event := &cm.events[i]
		if event.EventType == "tool_call" &&
			event.ApprovalStatus == "pending" &&
			!event.IsCompleted {
			cm.pendingApprovals = append(cm.pendingApprovals, event)
		}
	}

	// Set the first one as the current pending approval if not already handling one
	if len(cm.pendingApprovals) > 0 && cm.pendingApproval == nil {
		cm.pendingApproval = cm.pendingApprovals[0]
	}
}

// View renders the conversation view
func (cm *conversationModel) View(m *model) string {
	// Always update size based on current terminal dimensions
	cm.updateSize(m.width, m.height)

	if cm.loading {
		loadingStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("243")).
			Italic(true).
			Padding(2, 0)
		return loadingStyle.Render("Loading conversation...")
	}

	if cm.error != nil {
		errorStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("196")).
			Padding(2, 0)
		// Use the full width for conversation errors since they replace content
		errorMsg := preprocessError(cm.error.Error())
		return errorStyle.Render(fmt.Sprintf("Error: %s", errorMsg))
	}

	if cm.session == nil {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		return emptyStyle.Render("No conversation selected")
	}

	var s strings.Builder

	// Header with session info
	s.WriteString(cm.renderHeader(m) + "\n")

	// Conversation content
	s.WriteString(cm.viewport.View())

	// Input prompts (already includes leading newline if needed)
	s.WriteString(cm.renderInputPrompts(m))

	return s.String()
}

// renderHeader renders the conversation header with session metadata
func (cm *conversationModel) renderHeader(m *model) string {
	headerStyle := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true).
		Width(m.width-2).
		Padding(0, 1)

	// Status icon
	statusIcon := "⏸"
	switch cm.session.Status {
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
	if cm.session.Model != "" && cm.session.Model != "default" {
		title += fmt.Sprintf(" (%s)", cm.session.Model)
	}

	// Add parent indicator if this is a continued session
	if cm.session.ParentSessionID != "" {
		title += " [continued]"
	}

	// Add pending approval count if any
	if len(cm.pendingApprovals) > 0 {
		approvalStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("226")).
			Bold(true)
		approvalText := fmt.Sprintf(" | %d pending approval", len(cm.pendingApprovals))
		if len(cm.pendingApprovals) > 1 {
			approvalText = fmt.Sprintf(" | %d pending approvals", len(cm.pendingApprovals))
		}
		title += approvalStyle.Render(approvalText)
	}

	return headerStyle.Render(title)
}

// renderConversationContent generates the full conversation content
func (cm *conversationModel) renderConversationContent() string {
	if len(cm.events) == 0 {
		return lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Render("No conversation events yet...")
	}

	var content strings.Builder

	// Show initial query
	if cm.session.Query != "" {
		content.WriteString(cm.renderUserMessage(cm.session.Query))
		content.WriteString("\n\n")
	}

	// Render all events
	for i, event := range cm.events {
		content.WriteString(cm.renderEvent(&event))

		// Add spacing between events (except last)
		if i < len(cm.events)-1 {
			content.WriteString("\n\n")
		}
	}

	return content.String()
}

// renderEvent renders a single conversation event
func (cm *conversationModel) renderEvent(event *rpc.ConversationEvent) string {
	switch event.EventType {
	case "message":
		switch event.Role {
		case "user":
			return cm.renderUserMessage(event.Content)
		case "assistant":
			return cm.renderAssistantMessage(event.Content)
		}

	case "tool_call":
		return cm.renderToolCall(event)

	case "tool_result":
		return cm.renderToolResult(event)
	}

	// Fallback for unknown event types
	return lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true).
		Render(fmt.Sprintf("[%s event]", event.EventType))
}

// renderUserMessage renders a user message
func (cm *conversationModel) renderUserMessage(content string) string {
	userStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("39")). // Blue
		Bold(true)

	return userStyle.Render("👤 User:") + "\n" + content
}

// renderAssistantMessage renders an assistant message
func (cm *conversationModel) renderAssistantMessage(content string) string {
	assistantStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252")). // Light gray
		Bold(true)

	return assistantStyle.Render("🤖 Assistant:") + "\n" + content
}

// renderToolCall renders a tool call event
func (cm *conversationModel) renderToolCall(event *rpc.ConversationEvent) string {
	var s strings.Builder

	// Tool call header with status icon
	toolIcon := "🔧"
	statusText := ""
	switch event.ApprovalStatus {
	case "pending":
		toolIcon = "⏳"
		statusText = " (pending approval"

		// Find which approval number this is
		for i, pa := range cm.pendingApprovals {
			if pa == event {
				if len(cm.pendingApprovals) > 1 {
					statusText += fmt.Sprintf(" %d of %d", i+1, len(cm.pendingApprovals))
				}
				break
			}
		}
		statusText += ")"

		if event == cm.pendingApproval {
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
func (cm *conversationModel) renderToolResult(event *rpc.ConversationEvent) string {
	if event.ToolResultContent == "" {
		return "" // No content to show
	}

	// TODO: This sequential lookup should be replaced with proper approval correlation
	// See TODO.md for detailed explanation of the proper fix

	// Find the corresponding tool_call by looking for the tool_call with matching tool_id
	var correspondingToolCall *rpc.ConversationEvent
	for i := range cm.events {
		if cm.events[i].EventType == "tool_call" && cm.events[i].ToolID == event.ToolResultForID {
			correspondingToolCall = &cm.events[i]
			break
		}
	}

	// If the corresponding tool call was denied, render as denial feedback
	if correspondingToolCall != nil && correspondingToolCall.ApprovalStatus == "denied" {
		return cm.renderDenialReason(event.ToolResultContent)
	}

	// Otherwise render as tool output with truncation
	return cm.renderToolOutput(event.ToolResultContent)
}

// renderDenialReason renders user denial feedback with distinctive styling
func (cm *conversationModel) renderDenialReason(content string) string {
	denialStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("196")). // Red
		Bold(true)

	return denialStyle.Render("💬 Denial Reason:") + "\n" + content
}

// renderToolOutput renders tool output with smart truncation
func (cm *conversationModel) renderToolOutput(content string) string {
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
func (cm *conversationModel) renderInputPrompts(m *model) string {
	var s strings.Builder

	// Add leading newline to separate from viewport
	s.WriteString("\n")

	// Approval prompt
	if cm.showApprovalPrompt {
		promptStyle := lipgloss.NewStyle().
			Background(lipgloss.Color("235")).
			Foreground(lipgloss.Color("215")).
			Padding(1, 2).
			Width(m.width - 4).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("205"))

		promptContent := "❌ Deny with reason:\n" + cm.approvalInput.View() + "\n\nPress [enter] to submit, [esc] to cancel"
		s.WriteString(promptStyle.Render(promptContent) + "\n")
	}

	// Resume prompt
	if cm.showResumePrompt {
		promptStyle := lipgloss.NewStyle().
			Background(lipgloss.Color("235")).
			Foreground(lipgloss.Color("215")).
			Padding(1, 2).
			Width(m.width - 4).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("205"))

		promptContent := "🔄 Continue session:\n" + cm.resumeInput.View() + "\n\nPress [enter] to submit, [esc] to cancel"
		s.WriteString(promptStyle.Render(promptContent) + "\n")
	}

	// Status line
	if !cm.showApprovalPrompt && !cm.showResumePrompt {
		statusItems := []string{}

		// Navigation hints
		statusItems = append(statusItems, "[esc] back", "[↑/↓] scroll")

		// Approval actions
		if cm.pendingApproval != nil {
			statusItems = append(statusItems, "[y] approve", "[n] deny")
		}

		// Resume action
		if cm.session != nil && cm.session.Status == "completed" {
			statusItems = append(statusItems, "[r] resume")
		}

		// Parent navigation
		if cm.session != nil && cm.session.ParentSessionID != "" {
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

// Message types for conversation functionality

type fetchConversationMsg struct {
	session *rpc.SessionState
	events  []rpc.ConversationEvent
	err     error
}

type continueSessionMsg struct {
	sessionID       string
	claudeSessionID string
	err             error
}

type pollRefreshMsg struct {
	sessionID string
}

// API functions for conversation functionality

func fetchConversation(daemonClient client.Client, sessionID string) tea.Cmd {
	return func() tea.Msg {
		var session *rpc.SessionState
		var events []rpc.ConversationEvent

		// Fetch session state first
		if sessionID == "" {
			return fetchConversationMsg{err: fmt.Errorf("no session ID provided")}
		}

		sessionResp, err := daemonClient.GetSessionState(sessionID)
		if err != nil {
			return fetchConversationMsg{err: err}
		}
		session = &sessionResp.Session

		// Fetch conversation events using session ID
		convResp, err := daemonClient.GetConversation(sessionID)
		if err != nil {
			return fetchConversationMsg{err: err}
		}

		events = convResp.Events

		return fetchConversationMsg{
			session: session,
			events:  events,
		}
	}
}

func continueSession(daemonClient client.Client, sessionID, query string) tea.Cmd {
	return func() tea.Msg {
		resp, err := daemonClient.ContinueSession(rpc.ContinueSessionRequest{
			SessionID: sessionID,
			Query:     query,
		})
		if err != nil {
			return continueSessionMsg{err: err}
		}

		return continueSessionMsg{
			sessionID:       resp.SessionID,
			claudeSessionID: resp.ClaudeSessionID,
		}
	}
}

// fetchConversationSilent fetches conversation without showing loading state (for polling)
func fetchConversationSilent(daemonClient client.Client, sessionID string) tea.Cmd {
	return func() tea.Msg {
		var session *rpc.SessionState
		var events []rpc.ConversationEvent

		// Fetch session state first
		if sessionID == "" {
			return fetchConversationMsg{err: fmt.Errorf("no session ID provided")}
		}

		sessionResp, err := daemonClient.GetSessionState(sessionID)
		if err != nil {
			return fetchConversationMsg{err: err}
		}
		session = &sessionResp.Session

		// Fetch conversation events using session ID
		convResp, err := daemonClient.GetConversation(sessionID)
		if err != nil {
			return fetchConversationMsg{err: err}
		}

		events = convResp.Events

		return fetchConversationMsg{
			session: session,
			events:  events,
		}
	}
}
