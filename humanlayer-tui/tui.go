package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Request types
type RequestType string

const (
	ApprovalRequest     RequestType = "approval"
	HumanContactRequest RequestType = "human_contact"
)

// Request represents either an approval or human contact
type Request struct {
	ID          string
	Type        RequestType
	Message     string
	Tool        string // For approvals
	Parameters  map[string]interface{} // For approvals
	TimeAgo     time.Duration
	AgentName   string
}

// View states
type viewState int

const (
	listView viewState = iota
	detailView
	feedbackView
)

type model struct {
	requests      []Request
	cursor        int
	viewState     viewState
	width, height int
	
	// For detail view
	selectedRequest *Request
	
	// For feedback view
	feedbackInput textinput.Model
	feedbackFor   *Request
	isApproving   bool // true for approve with comment, false for deny/human response
}

type keyMap struct {
	Up       key.Binding
	Down     key.Binding
	Enter    key.Binding
	Back     key.Binding
	Approve  key.Binding
	Deny     key.Binding
	Quit     key.Binding
}

var keys = keyMap{
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
	Approve: key.NewBinding(
		key.WithKeys("y"),
		key.WithHelp("y", "approve"),
	),
	Deny: key.NewBinding(
		key.WithKeys("n"),
		key.WithHelp("n", "deny/respond"),
	),
	Quit: key.NewBinding(
		key.WithKeys("q", "ctrl+c"),
		key.WithHelp("q", "quit"),
	),
}

func newModel() model {
	ti := textinput.New()
	ti.Placeholder = "Enter your response..."
	ti.CharLimit = 500
	ti.Width = 60

	// Mock data for now
	requests := []Request{
		{
			ID:          "req_001",
			Type:        HumanContactRequest,
			Message:     "Should I use RS256 or HS256 for JWT signing?",
			TimeAgo:     2 * time.Second,
			AgentName:   "Claude Code",
		},
		{
			ID:          "req_002",
			Type:        ApprovalRequest,
			Tool:        "edit_file",
			Message:     "Edit auth.py to add JWT validation",
			Parameters:  map[string]interface{}{"file": "/src/auth.py", "changes": "Add JWT validation..."},
			TimeAgo:     15 * time.Second,
			AgentName:   "Claude Code",
		},
		{
			ID:          "req_003",
			Type:        ApprovalRequest,
			Tool:        "run_command",
			Message:     "Run npm test",
			Parameters:  map[string]interface{}{"command": "npm test", "cwd": "/workspace"},
			TimeAgo:     1 * time.Minute,
			AgentName:   "OpenCode",
		},
	}

	return model{
		requests:      requests,
		cursor:        0,
		viewState:     listView,
		feedbackInput: ti,
	}
}

func (m model) Init() tea.Cmd {
	return textinput.Blink
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		switch m.viewState {
		case listView:
			return m.updateListView(msg)
		case detailView:
			return m.updateDetailView(msg)
		case feedbackView:
			return m.updateFeedbackView(msg)
		}
	}

	return m, cmd
}

func (m model) updateListView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Quit):
		return m, tea.Quit

	case key.Matches(msg, keys.Up):
		if m.cursor > 0 {
			m.cursor--
		}

	case key.Matches(msg, keys.Down):
		if m.cursor < len(m.requests)-1 {
			m.cursor++
		}

	case key.Matches(msg, keys.Enter):
		m.selectedRequest = &m.requests[m.cursor]
		m.viewState = detailView

	case key.Matches(msg, keys.Approve):
		req := &m.requests[m.cursor]
		if req.Type == ApprovalRequest {
			// Quick approve
			// TODO: Actually send approval
			m.requests = removeRequest(m.requests, m.cursor)
			if m.cursor >= len(m.requests) && m.cursor > 0 {
				m.cursor--
			}
		}

	case key.Matches(msg, keys.Deny):
		req := &m.requests[m.cursor]
		m.feedbackFor = req
		m.isApproving = false
		m.feedbackInput.Reset()
		m.feedbackInput.Focus()
		m.viewState = feedbackView
		return m, textinput.Blink
	}

	return m, nil
}

func (m model) updateDetailView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, keys.Back):
		m.viewState = listView
		m.selectedRequest = nil

	case key.Matches(msg, keys.Approve):
		if m.selectedRequest.Type == ApprovalRequest {
			// TODO: Actually send approval
			m.requests = removeRequestByID(m.requests, m.selectedRequest.ID)
			m.viewState = listView
			m.selectedRequest = nil
		}

	case key.Matches(msg, keys.Deny):
		m.feedbackFor = m.selectedRequest
		m.isApproving = false
		m.feedbackInput.Reset()
		m.feedbackInput.Focus()
		m.viewState = feedbackView
		return m, textinput.Blink
	}

	return m, nil
}

func (m model) updateFeedbackView(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch {
	case key.Matches(msg, keys.Back):
		m.viewState = listView
		m.feedbackFor = nil
		m.feedbackInput.Reset()
		return m, nil

	case msg.Type == tea.KeyEnter:
		// Submit feedback
		feedback := m.feedbackInput.Value()
		if feedback != "" {
			// TODO: Actually send the feedback/response
			m.requests = removeRequestByID(m.requests, m.feedbackFor.ID)
		}
		m.viewState = listView
		m.feedbackFor = nil
		m.feedbackInput.Reset()
		return m, nil

	default:
		m.feedbackInput, cmd = m.feedbackInput.Update(msg)
		return m, cmd
	}
}

func (m model) View() string {
	switch m.viewState {
	case listView:
		return m.listViewRender()
	case detailView:
		return m.detailViewRender()
	case feedbackView:
		return m.feedbackViewRender()
	default:
		return ""
	}
}

func (m model) listViewRender() string {
	var s strings.Builder

	// Header
	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(fmt.Sprintf("Pending Requests (%d)", len(m.requests)))

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Request list
	for i, req := range m.requests {
		cursor := "  "
		if i == m.cursor {
			cursor = " >"
		}

		typeIcon := "📋" // approval
		if req.Type == HumanContactRequest {
			typeIcon = "💬" // human contact
		}

		line := fmt.Sprintf("%s %s %-20s %-30s %s",
			cursor,
			typeIcon,
			truncate(req.Tool, 20),
			truncate(req.Message, 30),
			formatDuration(req.TimeAgo),
		)

		if i == m.cursor {
			line = lipgloss.NewStyle().
				Foreground(lipgloss.Color("205")).
				Render(line)
		}

		s.WriteString(line + "\n")
	}

	// Footer
	s.WriteString("\n" + strings.Repeat("─", m.width) + "\n")
	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render("[j/k] nav  [enter] expand  [y/n] quick  [q] quit")
	s.WriteString(footer)

	return s.String()
}

func (m model) detailViewRender() string {
	if m.selectedRequest == nil {
		return ""
	}

	req := m.selectedRequest
	var s strings.Builder

	// Header
	title := "Approval Request"
	if req.Type == HumanContactRequest {
		title = "Human Contact Request"
	}

	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(title + " [esc: back]")

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Request details
	details := lipgloss.NewStyle().
		Padding(0, 2)

	if req.Type == ApprovalRequest {
		s.WriteString(details.Render(fmt.Sprintf("Type: %s\n", req.Type)))
		s.WriteString(details.Render(fmt.Sprintf("Tool: %s\n", req.Tool)))
		s.WriteString(details.Render(fmt.Sprintf("Agent: %s\n", req.AgentName)))
		s.WriteString(details.Render(fmt.Sprintf("Time: %s ago\n", formatDuration(req.TimeAgo))))
		s.WriteString("\n")
		s.WriteString(details.Render("Parameters:\n"))
		for k, v := range req.Parameters {
			s.WriteString(details.Render(fmt.Sprintf("  %s: %v\n", k, v)))
		}
	} else {
		s.WriteString(details.Render(fmt.Sprintf("From: %s\n", req.AgentName)))
		s.WriteString(details.Render(fmt.Sprintf("Time: %s ago\n", formatDuration(req.TimeAgo))))
		s.WriteString("\n")
		s.WriteString(details.Render("Message:\n"))
		s.WriteString(details.Render(req.Message + "\n"))
	}

	// Actions
	s.WriteString("\n" + strings.Repeat("─", m.width) + "\n")
	
	actions := "[y] approve  [n] deny  [esc] back"
	if req.Type == HumanContactRequest {
		actions = "[n] respond  [esc] back"
	}
	
	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render(actions)
	s.WriteString(footer)

	return s.String()
}

func (m model) feedbackViewRender() string {
	var s strings.Builder

	title := "Deny with Feedback"
	if m.feedbackFor.Type == HumanContactRequest {
		title = "Respond to Human Contact"
	}

	header := lipgloss.NewStyle().
		Bold(true).
		Padding(0, 1).
		Render(title)

	s.WriteString(header + "\n")
	s.WriteString(strings.Repeat("─", m.width) + "\n\n")

	// Context
	context := lipgloss.NewStyle().
		Padding(0, 2).
		Foreground(lipgloss.Color("240"))

	if m.feedbackFor.Type == ApprovalRequest {
		s.WriteString(context.Render(fmt.Sprintf("Denying: %s on %v\n\n", 
			m.feedbackFor.Tool, 
			m.feedbackFor.Parameters["file"])))
	} else {
		s.WriteString(context.Render(fmt.Sprintf("Responding to: %s\n\n", 
			truncate(m.feedbackFor.Message, 50))))
	}

	// Input
	s.WriteString(lipgloss.NewStyle().Padding(0, 2).Render("Response:\n"))
	s.WriteString(lipgloss.NewStyle().Padding(0, 2).Render(m.feedbackInput.View()))

	// Footer
	s.WriteString("\n\n" + strings.Repeat("─", m.width) + "\n")
	footer := lipgloss.NewStyle().
		Foreground(lipgloss.Color("240")).
		Render("[enter] send  [esc] cancel")
	s.WriteString(footer)

	return s.String()
}

// Helper functions
func removeRequest(requests []Request, index int) []Request {
	if index < 0 || index >= len(requests) {
		return requests
	}
	return append(requests[:index], requests[index+1:]...)
}

func removeRequestByID(requests []Request, id string) []Request {
	for i, req := range requests {
		if req.ID == id {
			return removeRequest(requests, i)
		}
	}
	return requests
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max > 3 {
		return s[:max-3] + "..."
	}
	return s[:max]
}

func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh", int(d.Hours()))
}
