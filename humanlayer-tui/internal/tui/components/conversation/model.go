// Package conversation implements the conversation UI component.
// This component handles displaying conversation details with polling,
// approval inline prompts, and resume functionality.
package conversation

import (
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/humanlayer/humanlayer/hld/rpc"
)

// Model contains all state related to the conversation view
type Model struct {
	sessionID       string
	claudeSessionID string
	session         *rpc.SessionState
	events          []rpc.ConversationEvent
	viewport        viewport.Model

	// For inline approval handling
	pendingApprovalIndices []int // Indices of pending approvals in events slice
	currentApprovalIndex   int   // Index of current approval being processed (-1 if none)
	approvalInput          textinput.Model
	showApprovalPrompt     bool

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

	// Dimensions for dynamic layout
	contentWidth  int
	contentHeight int
}

// New creates a new conversation model
func New() Model {
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

	return Model{
		viewport:             vp,
		approvalInput:        approvalInput,
		resumeInput:          resumeInput,
		loading:              false,
		currentApprovalIndex: -1,
	}
}

// SetSession initializes the conversation view for a specific session
func (m *Model) SetSession(sessionID string) {
	m.sessionID = sessionID
	m.claudeSessionID = "" // Will be populated from session state
	m.loading = true
	m.error = nil
	m.clearApprovalState()
	m.clearResumeState()
	m.StopPolling() // Stop any existing polling
	// Clear parent data when switching sessions
	m.parentModel = ""
	m.parentWorkingDir = ""
	// Reset scroll tracking
	m.wasAtBottom = true
}

// ClearSession clears the current session
func (m *Model) ClearSession() {
	m.StopPolling()
	m.sessionID = ""
}

// clearApprovalState resets approval-related state
func (m *Model) clearApprovalState() {
	m.currentApprovalIndex = -1
	m.showApprovalPrompt = false
	m.approvalInput.Reset()
	// Restore viewport size when hiding prompt
	m.adjustViewportSize()
}

// clearResumeState resets resume-related state
func (m *Model) clearResumeState() {
	m.showResumePrompt = false
	m.resumeInput.Reset()
	// Restore viewport size when hiding prompt
	m.adjustViewportSize()
}

// StopPolling stops the polling timer
func (m *Model) StopPolling() {
	if m.pollTicker != nil {
		m.pollTicker.Stop()
		m.pollTicker = nil
	}
	m.isPolling = false
}

// isActiveSession returns true if session is running or starting
func (m *Model) isActiveSession() bool {
	return m.session != nil && (m.session.Status == "running" || m.session.Status == "starting")
}

// UpdateSize updates the viewport dimensions based on content area size
func (m *Model) UpdateSize(width, height int) {
	// height is already the content area (terminal - tab bar - status bar)
	// Store dimensions for dynamic adjustment
	m.contentWidth = width
	m.contentHeight = height

	// Calculate viewport size based on current state
	m.adjustViewportSize()

	// Also update input field widths
	inputWidth := width - 10
	if inputWidth < 10 {
		inputWidth = 10
	}
	m.approvalInput.Width = inputWidth
	m.resumeInput.Width = inputWidth
}

// adjustViewportSize dynamically adjusts viewport based on active prompts
func (m *Model) adjustViewportSize() {
	// Skip if dimensions not set yet
	if m.contentWidth == 0 || m.contentHeight == 0 {
		return
	}

	// Start with content dimensions
	viewportHeight := m.contentHeight - 3 // header (2 lines) + status line (1 line)

	// Reduce height when input prompts are shown
	if m.showApprovalPrompt || m.showResumePrompt {
		// Input prompt takes: border (2) + padding (2) + content (3 lines) + spacing (1) = 8 lines
		viewportHeight -= 8
	}
	if viewportHeight < 5 {
		viewportHeight = 5 // Minimum height
	}

	viewportWidth := m.contentWidth
	if viewportWidth < 20 {
		viewportWidth = 20 // Minimum width
	}

	m.viewport.Width = viewportWidth
	m.viewport.Height = viewportHeight
}

// findPendingApproval looks for pending approvals in the conversation
func (m *Model) findPendingApproval() {
	m.pendingApprovalIndices = nil

	// Find all pending approvals
	for i := range m.events {
		event := &m.events[i]
		if event.EventType == "tool_call" &&
			event.ApprovalStatus == "pending" &&
			!event.IsCompleted {
			m.pendingApprovalIndices = append(m.pendingApprovalIndices, i)
		}
	}

	// Set the first one as the current pending approval if not already handling one
	if len(m.pendingApprovalIndices) > 0 && m.currentApprovalIndex == -1 {
		m.currentApprovalIndex = m.pendingApprovalIndices[0]
	}
}

// Getters for read-only access
func (m *Model) SessionID() string               { return m.sessionID }
func (m *Model) Session() *rpc.SessionState      { return m.session }
func (m *Model) Events() []rpc.ConversationEvent { return m.events }
func (m *Model) Loading() bool                   { return m.loading }
func (m *Model) Error() error                    { return m.error }
func (m *Model) IsPolling() bool                 { return m.isPolling }
func (m *Model) ShowApprovalPrompt() bool        { return m.showApprovalPrompt }
func (m *Model) ShowResumePrompt() bool          { return m.showResumePrompt }
func (m *Model) WasAtBottom() bool               { return m.wasAtBottom }

// PendingApproval returns the current pending approval event, if any
func (m *Model) PendingApproval() *rpc.ConversationEvent {
	if m.currentApprovalIndex >= 0 && m.currentApprovalIndex < len(m.events) {
		return &m.events[m.currentApprovalIndex]
	}
	return nil
}

// PendingApprovalCount returns the number of pending approvals
func (m *Model) PendingApprovalCount() int {
	return len(m.pendingApprovalIndices)
}
