package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// approvalModel contains all state related to the approvals tab
type approvalModel struct {
	requests        []Request
	cursor          int
	viewState       viewState
	selectedRequest *Request

	// For list scrolling
	viewport viewport.Model

	// For feedback view
	feedbackInput textinput.Model
	feedbackFor   *Request
	isApproving   bool // true for approve with comment, false for deny/human response
}

// newApprovalModel creates a new approval model with default state
func newApprovalModel() approvalModel {
	ti := textinput.New()
	ti.Placeholder = "Enter your response..."
	ti.CharLimit = 500
	ti.Width = 60

	vp := viewport.New(80, 20) // Will be resized later
	vp.SetContent("")

	return approvalModel{
		requests:      []Request{},
		cursor:        0,
		viewState:     listView,
		viewport:      vp,
		feedbackInput: ti,
	}
}

// updateSize updates the viewport dimensions
func (am *approvalModel) updateSize(width, height int) {
	// Ensure minimum dimensions
	if width < 20 {
		width = 20
	}
	if height < 5 {
		height = 5
	}
	
	am.viewport.Width = width
	am.viewport.Height = height
	
	// Update input field width with bounds checking
	inputWidth := width - 20
	if inputWidth < 10 {
		inputWidth = 10
	}
	am.feedbackInput.Width = inputWidth
}

// Update handles messages for the approvals tab
func (am *approvalModel) Update(msg tea.Msg, m *model) tea.Cmd {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch am.viewState {
		case listView:
			return am.updateListView(msg, m)
		case detailView:
			return am.updateDetailView(msg, m)
		case feedbackView:
			return am.updateFeedbackView(msg, m)
		}

	case fetchRequestsMsg:
		if msg.err != nil {
			m.err = msg.err
			m.fullError = msg.err
			return nil
		}
		am.requests = msg.requests
		m.pendingApprovalCount = len(am.requests)

		// Preserve cursor position if possible
		if am.cursor >= len(am.requests) && len(am.requests) > 0 {
			am.cursor = len(am.requests) - 1
		}
		return nil

	case approvalSentMsg:
		if msg.err != nil {
			m.err = msg.err
			m.fullError = msg.err
			return nil
		}
		// Remove the approved/denied request from the list
		for i, req := range am.requests {
			if req.ID == msg.requestID {
				am.requests = append(am.requests[:i], am.requests[i+1:]...)
				break
			}
		}
		// Adjust cursor if necessary
		if am.cursor >= len(am.requests) && len(am.requests) > 0 {
			am.cursor = len(am.requests) - 1
		}
		// Go back to list view
		am.viewState = listView
		am.selectedRequest = nil
		// Trigger layout update when returning to list view
		m.updateAllViewSizes()
		return fetchRequests(m.daemonClient)

	case humanResponseSentMsg:
		if msg.err != nil {
			m.err = msg.err
			m.fullError = msg.err
			return nil
		}
		// Remove the responded request from the list
		for i, req := range am.requests {
			if req.ID == msg.requestID {
				am.requests = append(am.requests[:i], am.requests[i+1:]...)
				break
			}
		}
		// Adjust cursor if necessary
		if am.cursor >= len(am.requests) && len(am.requests) > 0 {
			am.cursor = len(am.requests) - 1
		}
		// Go back to list view
		am.viewState = listView
		am.selectedRequest = nil
		// Trigger layout update when returning to list view
		m.updateAllViewSizes()
		return fetchRequests(m.daemonClient)
	}

	return nil
}

// updateListView handles key events in the list view
func (am *approvalModel) updateListView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Up):
		if am.cursor > 0 {
			am.cursor--
		}

	case key.Matches(msg, keys.Down):
		if am.cursor < len(am.requests)-1 {
			am.cursor++
		}

	case key.Matches(msg, keys.Enter):
		if am.cursor < len(am.requests) {
			req := am.requests[am.cursor]
			// If the approval is tied to a session, open conversation view
			if req.SessionID != "" {
				return m.openConversationView(req.SessionID)
			} else {
				// Fallback to detail view for approvals without session context
				am.selectedRequest = &req
				am.viewState = detailView
			}
		}

	case key.Matches(msg, keys.Approve):
		// Quick approve without comment
		if am.cursor < len(am.requests) {
			req := am.requests[am.cursor]
			if req.Type == ApprovalRequest {
				return sendApproval(m.daemonClient, req.CallID, true, "")
			}
		}

	case key.Matches(msg, keys.Deny):
		// Open feedback view for deny/response
		if am.cursor < len(am.requests) {
			am.feedbackFor = &am.requests[am.cursor]
			am.isApproving = false
			am.feedbackInput.Reset()
			am.feedbackInput.Focus()
			am.viewState = feedbackView
			// Trigger layout update for the new view state
			m.updateAllViewSizes()
		}

	case key.Matches(msg, keys.Refresh):
		return fetchRequests(m.daemonClient)
	}

	return nil
}

// updateDetailView handles key events in the detail view
func (am *approvalModel) updateDetailView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		am.viewState = listView
		am.selectedRequest = nil
		// Trigger layout update when returning to list view
		m.updateAllViewSizes()

	case key.Matches(msg, keys.Approve):
		if am.selectedRequest != nil && am.selectedRequest.Type == ApprovalRequest {
			return sendApproval(m.daemonClient, am.selectedRequest.CallID, true, "")
		}

	case key.Matches(msg, keys.Deny):
		if am.selectedRequest != nil {
			am.feedbackFor = am.selectedRequest
			am.isApproving = false
			am.feedbackInput.Reset()
			am.feedbackInput.Focus()
			am.viewState = feedbackView
			// Trigger layout update for the new view state
			m.updateAllViewSizes()
		}
	}

	return nil
}

// updateFeedbackView handles key events in the feedback view
func (am *approvalModel) updateFeedbackView(msg tea.KeyMsg, m *model) tea.Cmd {
	switch {
	case key.Matches(msg, keys.Back):
		am.viewState = detailView
		if am.selectedRequest == nil {
			am.viewState = listView
		}
		// Trigger layout update when changing view states
		m.updateAllViewSizes()

	case key.Matches(msg, keys.Enter):
		// Submit feedback
		if am.feedbackFor != nil {
			feedback := am.feedbackInput.Value()
			if am.feedbackFor.Type == ApprovalRequest {
				// For approvals, send with comment
				return sendApproval(m.daemonClient, am.feedbackFor.CallID, am.isApproving, feedback)
			} else {
				// For human contact, send response
				return sendHumanResponse(m.daemonClient, am.feedbackFor.ID, feedback)
			}
		}

	default:
		// Handle text input
		var cmd tea.Cmd
		am.feedbackInput, cmd = am.feedbackInput.Update(msg)
		return cmd
	}

	return nil
}

// View renders the approvals tab
func (am *approvalModel) View(m *model) string {
	switch am.viewState {
	case detailView:
		return am.renderDetailView(m)
	case feedbackView:
		return am.renderFeedbackView(m)
	default:
		return am.renderListView(m)
	}
}

// renderListView renders the approval list
func (am *approvalModel) renderListView(m *model) string {
	if len(am.requests) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		content := emptyStyle.Render("No pending approvals")
		am.viewport.SetContent(content)
		return am.viewport.View()
	}

	var s strings.Builder

	// Group approvals by session
	sessionGroups := make(map[string][]Request)
	var noSession []Request

	for _, req := range am.requests {
		if req.SessionID != "" {
			sessionGroups[req.SessionID] = append(sessionGroups[req.SessionID], req)
		} else {
			noSession = append(noSession, req)
		}
	}

	// Sort sessions by most recent approval
	type sessionGroup struct {
		sessionID    string
		requests     []Request
		mostRecent   time.Time
		sessionModel string
	}

	var groups []sessionGroup
	for sessionID, reqs := range sessionGroups {
		mostRecent := reqs[0].CreatedAt
		sessionModel := reqs[0].SessionModel
		for _, req := range reqs {
			if req.CreatedAt.After(mostRecent) {
				mostRecent = req.CreatedAt
			}
		}
		groups = append(groups, sessionGroup{
			sessionID:    sessionID,
			requests:     reqs,
			mostRecent:   mostRecent,
			sessionModel: sessionModel,
		})
	}

	// Sort groups by most recent
	sort.Slice(groups, func(i, j int) bool {
		return groups[i].mostRecent.After(groups[j].mostRecent)
	})

	// Add no-session group at the end if any
	if len(noSession) > 0 {
		groups = append(groups, sessionGroup{
			sessionID: "",
			requests:  noSession,
		})
	}

	// Render each group
	currentIndex := 0
	for _, group := range groups {
		// Session header
		if group.sessionID != "" {
			sessionStyle := lipgloss.NewStyle().
				Foreground(lipgloss.Color("243")).
				Bold(true).
				Padding(0, 1)

			header := fmt.Sprintf("Session: %s", group.requests[0].SessionQuery)
			if group.sessionModel != "" && group.sessionModel != "default" {
				header += fmt.Sprintf(" (%s)", group.sessionModel)
			}
			s.WriteString(sessionStyle.Render(header) + "\n")
		}

		// Render requests in this group
		for _, req := range group.requests {
			// Determine if this item is selected
			selected := currentIndex == am.cursor

			// Icon based on type
			icon := "📋" // Approval
			if req.Type == HumanContactRequest {
				icon = "💬" // Human contact
			}

			// Time formatting
			timeStr := req.CreatedAt.Format("15:04")

			// Message preview
			messagePreview := req.Message
			if len(messagePreview) > 60 {
				messagePreview = messagePreview[:57] + "..."
			}

			// Build the item
			item := fmt.Sprintf("%s %s %s", icon, timeStr, messagePreview)

			// Apply styling
			itemStyle := lipgloss.NewStyle().Padding(0, 2)
			if selected {
				itemStyle = itemStyle.
					Background(lipgloss.Color("235")).
					Foreground(lipgloss.Color("215"))
			}

			s.WriteString(itemStyle.Render(item) + "\n")
			currentIndex++
		}

		// Add spacing between groups
		if group.sessionID != "" {
			s.WriteString("\n")
		}
	}

	// Set content in viewport and return the viewport view
	am.viewport.SetContent(s.String())
	return am.viewport.View()
}

// renderDetailView renders the detailed view of a single approval
func (am *approvalModel) renderDetailView(m *model) string {
	if am.selectedRequest == nil {
		return "No request selected"
	}

	req := am.selectedRequest
	var s strings.Builder

	// Metadata
	labelStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Width(12)
	valueStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("252"))

	s.WriteString(labelStyle.Render("Time:") + valueStyle.Render(req.CreatedAt.Format("15:04:05")) + "\n")

	if req.SessionID != "" {
		sessionInfo := req.SessionQuery
		if req.SessionModel != "" && req.SessionModel != "default" {
			sessionInfo += fmt.Sprintf(" (%s)", req.SessionModel)
		}
		s.WriteString(labelStyle.Render("Session:") + valueStyle.Render(sessionInfo) + "\n")
	}

	s.WriteString("\n")

	// Main content
	if req.Type == ApprovalRequest {
		// Tool/Function
		s.WriteString(labelStyle.Render("Function:") + valueStyle.Render(req.Tool) + "\n\n")

		// Parameters
		if len(req.Parameters) > 0 {
			s.WriteString(labelStyle.Render("Parameters:") + "\n")
			paramStyle := lipgloss.NewStyle().
				Foreground(lipgloss.Color("245")).
				PaddingLeft(2)

			for key, value := range req.Parameters {
				paramLine := fmt.Sprintf("%s: %v", key, value)
				s.WriteString(paramStyle.Render(paramLine) + "\n")
			}
		}
	} else {
		// Human contact message
		messageStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("252")).
			PaddingLeft(2).
			PaddingRight(2).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("237"))

		s.WriteString(labelStyle.Render("Message:") + "\n")
		s.WriteString(messageStyle.Render(req.Message) + "\n")
	}

	// Actions
	s.WriteString("\n")
	actionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)

	if req.Type == ApprovalRequest {
		s.WriteString(actionStyle.Render("Press [y] to approve, [n] to deny, [esc] to go back"))
	} else {
		s.WriteString(actionStyle.Render("Press [n] to respond, [esc] to go back"))
	}

	return s.String()
}

// renderFeedbackView renders the feedback input view
func (am *approvalModel) renderFeedbackView(m *model) string {
	if am.feedbackFor == nil {
		return "No request selected for feedback"
	}

	var s strings.Builder

	// Show what we're responding to
	contextStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Italic(true).
		MarginBottom(1)

	if am.feedbackFor.Type == ApprovalRequest {
		context := fmt.Sprintf("Function: %s", am.feedbackFor.Tool)
		s.WriteString(contextStyle.Render(context) + "\n\n")
	} else {
		// Show truncated message for context
		msgPreview := am.feedbackFor.Message
		if len(msgPreview) > 80 {
			msgPreview = msgPreview[:77] + "..."
		}
		s.WriteString(contextStyle.Render("Message: "+msgPreview) + "\n\n")
	}

	// Input field
	s.WriteString(am.feedbackInput.View() + "\n\n")

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)

	s.WriteString(instructionStyle.Render("Press [enter] to submit, [esc] to cancel"))

	return s.String()
}
