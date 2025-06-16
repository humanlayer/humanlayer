// Package approvals implements the approvals UI component.
// This component handles displaying and managing approval requests,
// including list view, detail view, and feedback submission.
package approvals

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// Model contains all state related to the approvals tab
type Model struct {
	requests        []domain.Request
	cursor          int
	viewState       domain.ViewState
	selectedRequest *domain.Request

	// For list scrolling
	viewport viewport.Model

	// For feedback view
	feedbackInput textinput.Model
	feedbackFor   *domain.Request
	isApproving   bool // true for approve with comment, false for deny/human response
}

// New creates a new approval model with default state
func New() Model {
	ti := textinput.New()
	ti.Placeholder = "Enter your response..."
	ti.CharLimit = 500
	ti.Width = 60

	vp := viewport.New(80, 20) // Will be resized later
	vp.SetContent("")

	return Model{
		requests:      []domain.Request{},
		cursor:        0,
		viewState:     domain.ListView,
		viewport:      vp,
		feedbackInput: ti,
	}
}

// UpdateSize updates the viewport dimensions
func (m *Model) UpdateSize(width, height int) {
	// Ensure minimum dimensions
	if width < 20 {
		width = 20
	}
	if height < 5 {
		height = 5
	}

	m.viewport.Width = width
	m.viewport.Height = height

	// Update input field width with bounds checking
	inputWidth := width - 20
	if inputWidth < 10 {
		inputWidth = 10
	}
	m.feedbackInput.Width = inputWidth
}

// GetRequests returns the current list of requests
func (m *Model) GetRequests() []domain.Request {
	return m.requests
}

// SetRequests updates the list of requests
func (m *Model) SetRequests(requests []domain.Request) {
	m.requests = requests
	// Preserve cursor position if possible
	if m.cursor >= len(m.requests) && len(m.requests) > 0 {
		m.cursor = len(m.requests) - 1
	}
}

// GetCursor returns the current cursor position
func (m *Model) GetCursor() int {
	return m.cursor
}

// SetCursor updates the cursor position
func (m *Model) SetCursor(cursor int) {
	m.cursor = cursor
}

// GetViewState returns the current view state
func (m *Model) GetViewState() domain.ViewState {
	return m.viewState
}

// SetViewState updates the view state
func (m *Model) SetViewState(state domain.ViewState) {
	m.viewState = state
}

// GetSelectedRequest returns the currently selected request
func (m *Model) GetSelectedRequest() *domain.Request {
	return m.selectedRequest
}

// SetSelectedRequest sets the selected request
func (m *Model) SetSelectedRequest(req *domain.Request) {
	m.selectedRequest = req
}

// GetFeedbackInput returns the feedback input model
func (m *Model) GetFeedbackInput() textinput.Model {
	return m.feedbackInput
}

// SetFeedbackInput sets the feedback input model
func (m *Model) SetFeedbackInput(input textinput.Model) {
	m.feedbackInput = input
}

// GetFeedbackFor returns the request being responded to
func (m *Model) GetFeedbackFor() *domain.Request {
	return m.feedbackFor
}

// SetFeedbackFor sets the request being responded to
func (m *Model) SetFeedbackFor(req *domain.Request) {
	m.feedbackFor = req
}

// IsApproving returns whether we're approving with comment
func (m *Model) IsApproving() bool {
	return m.isApproving
}

// SetIsApproving sets whether we're approving with comment
func (m *Model) SetIsApproving(approving bool) {
	m.isApproving = approving
}

// GetViewport returns the viewport model
func (m *Model) GetViewport() viewport.Model {
	return m.viewport
}

// SetViewport sets the viewport model
func (m *Model) SetViewport(vp viewport.Model) {
	m.viewport = vp
}

// RemoveRequest removes a request from the list by ID
func (m *Model) RemoveRequest(requestID string) {
	for i, req := range m.requests {
		if req.ID == requestID {
			m.requests = append(m.requests[:i], m.requests[i+1:]...)
			break
		}
	}
	// Adjust cursor if necessary
	if m.cursor >= len(m.requests) && len(m.requests) > 0 {
		m.cursor = len(m.requests) - 1
	}
}

// GetRequestAtCursor returns the request at the current cursor position
func (m *Model) GetRequestAtCursor() *domain.Request {
	if m.cursor < len(m.requests) {
		return &m.requests[m.cursor]
	}
	return nil
}

// MoveCursorUp moves the cursor up if possible
func (m *Model) MoveCursorUp() {
	if m.cursor > 0 {
		m.cursor--
	}
}

// MoveCursorDown moves the cursor down if possible
func (m *Model) MoveCursorDown() {
	if m.cursor < len(m.requests)-1 {
		m.cursor++
	}
}

// ResetFeedbackInput resets the feedback input field
func (m *Model) ResetFeedbackInput() {
	m.feedbackInput.Reset()
}

// FocusFeedbackInput focuses the feedback input field
func (m *Model) FocusFeedbackInput() {
	m.feedbackInput.Focus()
}

// HasRequests returns whether there are any requests
func (m *Model) HasRequests() bool {
	return len(m.requests) > 0
}
