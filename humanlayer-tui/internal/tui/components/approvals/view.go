package approvals

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// View renders the approvals component
func (m *Model) View() string {
	switch m.viewState {
	case domain.DetailView:
		return m.renderDetailView()
	case domain.FeedbackView:
		return m.renderFeedbackView()
	default:
		return m.renderListView()
	}
}

// renderListView renders the approval list
func (m *Model) renderListView() string {
	if len(m.requests) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			Italic(true).
			Padding(2, 0)
		content := emptyStyle.Render("No pending approvals")
		m.viewport.SetContent(content)
		return m.viewport.View()
	}

	var s strings.Builder

	// Group approvals by session
	sessionGroups := make(map[string][]domain.Request)
	var noSession []domain.Request

	for _, req := range m.requests {
		if req.SessionID != "" {
			sessionGroups[req.SessionID] = append(sessionGroups[req.SessionID], req)
		} else {
			noSession = append(noSession, req)
		}
	}

	// Sort sessions by most recent approval
	type sessionGroup struct {
		sessionID    string
		requests     []domain.Request
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
			selected := currentIndex == m.cursor

			// Icon based on type
			icon := "📋" // Approval
			if req.Type == domain.HumanContactRequest {
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
	m.viewport.SetContent(s.String())
	return m.viewport.View()
}

// renderDetailView renders the detailed view of a single approval
func (m *Model) renderDetailView() string {
	if m.selectedRequest == nil {
		return "No request selected"
	}

	req := m.selectedRequest
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
	if req.Type == domain.ApprovalRequest {
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

	if req.Type == domain.ApprovalRequest {
		s.WriteString(actionStyle.Render("Press [y] to approve, [n] to deny, [esc] to go back"))
	} else {
		s.WriteString(actionStyle.Render("Press [n] to respond, [esc] to go back"))
	}

	return s.String()
}

// renderFeedbackView renders the feedback input view
func (m *Model) renderFeedbackView() string {
	if m.feedbackFor == nil {
		return "No request selected for feedback"
	}

	var s strings.Builder

	// Show what we're responding to
	contextStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("241")).
		Italic(true).
		MarginBottom(1)

	if m.feedbackFor.Type == domain.ApprovalRequest {
		context := fmt.Sprintf("Function: %s", m.feedbackFor.Tool)
		s.WriteString(contextStyle.Render(context) + "\n\n")
	} else {
		// Show truncated message for context
		msgPreview := m.feedbackFor.Message
		if len(msgPreview) > 80 {
			msgPreview = msgPreview[:77] + "..."
		}
		s.WriteString(contextStyle.Render("Message: "+msgPreview) + "\n\n")
	}

	// Input field
	s.WriteString(m.feedbackInput.View() + "\n\n")

	// Instructions
	instructionStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("243")).
		Italic(true)

	s.WriteString(instructionStyle.Render("Press [enter] to submit, [esc] to cancel"))

	return s.String()
}
