// Package sessions implements the sessions UI component.
// This component handles displaying and managing agent sessions,
// including list view, detail view, and the multiline editor modal.
package sessions

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
)

// Model contains all state related to the sessions tab
type Model struct {
	// API client
	apiClient api.Client

	// Session data
	sessions       []session.Info
	sortedSessions []session.Info // Cached sorted sessions for navigation
	cursor         int
	viewState      domain.ViewState

	// For list scrolling
	viewport viewport.Model

	// For session detail view
	selectedSession     *session.Info
	sessionApprovals    []domain.Request
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

	// Dimensions
	width  int
	height int
}

// New creates a new session model with default state
func New(apiClient api.Client) *Model {
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

	return &Model{
		apiClient:         apiClient,
		sessions:          []session.Info{},
		sortedSessions:    []session.Info{},
		cursor:            0,
		viewState:         domain.ListView,
		viewport:          vp,
		launchQueryInput:  queryInput,
		launchWorkingDir:  workingDirInput,
		launchModelSelect: 0, // default
		launchActiveField: 0, // query field
	}
}

// UpdateSize updates the viewport dimensions
func (m *Model) UpdateSize(width, height int) {
	m.width = width
	m.height = height

	// Ensure minimum dimensions
	if width < 20 {
		width = 20
	}
	if height < 5 {
		height = 5
	}

	m.viewport.Width = width
	m.viewport.Height = height

	// Update input field widths with bounds checking
	inputWidth := width - 20
	if inputWidth < 10 {
		inputWidth = 10
	}
	m.launchQueryInput.Width = inputWidth
	m.launchWorkingDir.Width = inputWidth
}

// GetViewState returns the current view state
func (m *Model) GetViewState() domain.ViewState {
	return m.viewState
}

// GetSessions returns the current sessions
func (m *Model) GetSessions() []session.Info {
	return m.sessions
}

// GetSortedSessions returns the sorted sessions
func (m *Model) GetSortedSessions() []session.Info {
	return m.sortedSessions
}

// GetCursor returns the current cursor position
func (m *Model) GetCursor() int {
	return m.cursor
}

// GetSelectedSession returns the currently selected session (if any)
func (m *Model) GetSelectedSession() *session.Info {
	return m.selectedSession
}

// GetSavedQueryContent returns the saved multiline query content
func (m *Model) GetSavedQueryContent() string {
	return m.savedQueryContent
}

// GetLaunchQueryInput returns the launch query input model
func (m *Model) GetLaunchQueryInput() textinput.Model {
	return m.launchQueryInput
}

// GetLaunchModelSelect returns the selected model index
func (m *Model) GetLaunchModelSelect() int {
	return m.launchModelSelect
}

// GetLaunchWorkingDir returns the launch working directory input model
func (m *Model) GetLaunchWorkingDir() textinput.Model {
	return m.launchWorkingDir
}
