package conversation

import (
	"errors"
	"testing"
	"time"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockAPIClient for testing
type MockAPIClient struct {
	mock.Mock
}

func (m *MockAPIClient) FetchRequests() tea.Cmd {
	args := m.Called()
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) FetchSessions() tea.Cmd {
	args := m.Called()
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) FetchSessionApprovals(sessionID string) tea.Cmd {
	args := m.Called(sessionID)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) SubscribeToEvents() tea.Cmd {
	args := m.Called()
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) ListenForEvents(eventChan <-chan rpc.EventNotification) tea.Cmd {
	args := m.Called(eventChan)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) LaunchSession(query, model, workingDir string) tea.Cmd {
	args := m.Called(query, model, workingDir)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) SendApproval(callID string, approved bool, comment string) tea.Cmd {
	args := m.Called(callID, approved, comment)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) SendHumanResponse(requestID string, response string) tea.Cmd {
	args := m.Called(requestID, response)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) FetchConversation(sessionID string) tea.Cmd {
	args := m.Called(sessionID)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) FetchConversationSilent(sessionID string) tea.Cmd {
	args := m.Called(sessionID)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func (m *MockAPIClient) ContinueSession(sessionID, query string) tea.Cmd {
	args := m.Called(sessionID, query)
	if fn, ok := args.Get(0).(func() tea.Msg); ok {
		return fn
	}
	return args.Get(0).(tea.Cmd)
}

func createTestDependencies() Dependencies {
	return Dependencies{
		APIClient:         &MockAPIClient{},
		ConversationCache: domain.NewConversationCache(100), // max 100 entries
		Width:             100,
		Height:            50,
		Keys: KeyMap{
			Back:    key.NewBinding(key.WithKeys("esc")),
			Up:      key.NewBinding(key.WithKeys("up")),
			Down:    key.NewBinding(key.WithKeys("down")),
			Approve: key.NewBinding(key.WithKeys("y")),
			Deny:    key.NewBinding(key.WithKeys("n")),
			Enter:   key.NewBinding(key.WithKeys("enter")),
			Refresh: key.NewBinding(key.WithKeys("f5")),
			Quit:    key.NewBinding(key.WithKeys("ctrl+c")),
		},
	}
}

func TestUpdate_WindowSizeMsg(t *testing.T) {
	m := New()
	deps := createTestDependencies()

	cmd := m.Update(tea.WindowSizeMsg{Width: 120, Height: 60}, deps)

	assert.Nil(t, cmd)
	assert.Equal(t, 100, m.contentWidth) // Uses deps.Width
	assert.Equal(t, 50, m.contentHeight) // Uses deps.Height
}

func TestUpdate_FetchConversationMsg_Success(t *testing.T) {
	m := New()
	m.sessionID = "test-session"
	deps := createTestDependencies()

	session := &rpc.SessionState{
		ID:     "test-session",
		Status: "running",
		Query:  "test query",
	}
	events := []rpc.ConversationEvent{
		{EventType: "message", Content: "test"},
	}

	msg := domain.FetchConversationMsg{
		Session: session,
		Events:  events,
		Err:     nil,
	}

	cmd := m.Update(msg, deps)

	assert.False(t, m.loading)
	assert.Nil(t, m.error)
	assert.Equal(t, session, m.session)
	assert.Equal(t, events, m.events)
	assert.NotNil(t, cmd) // Should start polling for active session

	// Check cache was updated
	cached, cachedEvents, found := deps.ConversationCache.Get("test-session")
	assert.True(t, found)
	assert.Equal(t, session, cached)
	assert.Equal(t, events, cachedEvents)
}

func TestUpdate_FetchConversationMsg_Error(t *testing.T) {
	m := New()
	deps := createTestDependencies()

	testErr := errors.New("fetch failed")
	msg := domain.FetchConversationMsg{
		Session: nil,
		Events:  nil,
		Err:     testErr,
	}

	cmd := m.Update(msg, deps)

	assert.False(t, m.loading)
	assert.Equal(t, testErr, m.error)
	assert.Nil(t, cmd)
}

func TestUpdate_FetchConversationMsg_ParentDataInheritance(t *testing.T) {
	m := New()
	m.sessionID = "child-session"
	m.parentModel = "parent-model"
	m.parentWorkingDir = "/parent/dir"
	deps := createTestDependencies()

	session := &rpc.SessionState{
		ID:              "child-session",
		ParentSessionID: "parent-session",
		Status:          "running",
		Model:           "", // Empty, should inherit
		WorkingDir:      "", // Empty, should inherit
	}

	msg := domain.FetchConversationMsg{
		Session: session,
		Events:  []rpc.ConversationEvent{},
		Err:     nil,
	}

	m.Update(msg, deps)

	assert.Equal(t, "parent-model", m.session.Model)
	assert.Equal(t, "/parent/dir", m.session.WorkingDir)
}

func TestUpdate_PollRefreshMsg(t *testing.T) {
	m := New()
	m.sessionID = "test-session"
	m.session = &rpc.SessionState{Status: "running"}
	m.isPolling = true
	m.pollTicker = time.NewTicker(3 * time.Second)
	m.lastRefresh = time.Now() // Not initial load

	// Set up viewport with content and scroll position
	m.viewport.SetContent("line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10")
	m.viewport.Height = 3
	m.viewport.GotoTop() // User has scrolled to top

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("FetchConversationSilent", "test-session").Return(func() tea.Msg {
		return domain.FetchConversationMsg{}
	})

	// Process the poll refresh
	msg := domain.PollRefreshMsg{SessionID: "test-session"}
	cmd := m.Update(msg, deps)

	assert.NotNil(t, cmd)
	// wasAtBottom should be false since we scrolled to top
	assert.False(t, m.wasAtBottom)
	mockAPI.AssertExpectations(t)
}

func TestUpdate_PollRefreshMsg_InactiveSession(t *testing.T) {
	m := New()
	m.sessionID = "test-session"
	m.session = &rpc.SessionState{Status: "completed"} // Not active

	deps := createTestDependencies()

	msg := domain.PollRefreshMsg{SessionID: "test-session"}
	cmd := m.Update(msg, deps)

	assert.Nil(t, cmd) // Should not refresh inactive sessions
}

func TestUpdate_ApprovalSentMsg_Success(t *testing.T) {
	m := New()
	m.sessionID = "test-session"
	m.showApprovalPrompt = true

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("FetchConversation", "test-session").Return(func() tea.Msg {
		return domain.FetchConversationMsg{}
	})

	msg := domain.ApprovalSentMsg{
		RequestID: "test-request",
		Approved:  true,
		Err:       nil,
	}

	cmd := m.Update(msg, deps)

	assert.False(t, m.showApprovalPrompt)
	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestUpdate_ApprovalSentMsg_Error(t *testing.T) {
	m := New()
	deps := createTestDependencies()

	testErr := errors.New("approval failed")
	msg := domain.ApprovalSentMsg{
		RequestID: "test-request",
		Approved:  false,
		Err:       testErr,
	}

	cmd := m.Update(msg, deps)

	assert.Equal(t, testErr, m.error)
	assert.Nil(t, cmd)
}

func TestUpdate_ContinueSessionMsg_Success(t *testing.T) {
	m := New()
	m.showResumePrompt = true

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("FetchConversation", "new-session").Return(func() tea.Msg {
		return domain.FetchConversationMsg{}
	})

	msg := domain.ContinueSessionMsg{
		SessionID:       "new-session",
		ClaudeSessionID: "claude-123",
		Err:             nil,
	}

	cmd := m.Update(msg, deps)

	assert.False(t, m.showResumePrompt)
	assert.Equal(t, "new-session", m.sessionID)
	assert.True(t, m.loading)
	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestUpdateConversationView_Scrolling(t *testing.T) {
	m := New()
	m.viewport.SetContent("line1\nline2\nline3\nline4\nline5")
	m.viewport.Height = 3 // Make viewport smaller than content
	m.wasAtBottom = true
	deps := createTestDependencies()

	// Test scrolling up
	upKey := tea.KeyMsg{Type: tea.KeyUp}
	_ = m.updateConversationView(upKey, deps)

	// Note: cmd may be nil if viewport doesn't need to update
	// The important thing is that wasAtBottom is updated
	assert.False(t, m.wasAtBottom) // Should update scroll tracking

	// Test scrolling down
	m.wasAtBottom = false
	downKey := tea.KeyMsg{Type: tea.KeyDown}
	_ = m.updateConversationView(downKey, deps)
	// Scroll tracking should be updated after any scroll
}

func TestUpdateConversationView_Approve(t *testing.T) {
	m := New()
	m.events = []rpc.ConversationEvent{
		{EventType: "tool_call", ApprovalStatus: "pending", ApprovalID: "approval-123"},
	}
	m.currentApprovalIndex = 0

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("SendApproval", "approval-123", true, "").Return(func() tea.Msg {
		return domain.ApprovalSentMsg{Approved: true}
	})

	approveKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}}
	cmd := m.updateConversationView(approveKey, deps)

	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestUpdateConversationView_Deny(t *testing.T) {
	m := New()
	m.events = []rpc.ConversationEvent{
		{EventType: "tool_call", ApprovalStatus: "pending", ApprovalID: "approval-123"},
	}
	m.currentApprovalIndex = 0
	deps := createTestDependencies()

	denyKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}}
	cmd := m.updateConversationView(denyKey, deps)

	assert.True(t, m.showApprovalPrompt)
	assert.True(t, m.approvalInput.Focused())
	assert.Equal(t, "Reason for denial...", m.approvalInput.Placeholder)
	assert.Nil(t, cmd)
}

func TestUpdateConversationView_Resume(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "completed"}
	deps := createTestDependencies()

	resumeKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}}
	cmd := m.updateConversationView(resumeKey, deps)

	assert.True(t, m.showResumePrompt)
	assert.True(t, m.resumeInput.Focused())
	assert.Nil(t, cmd)
}

func TestUpdateConversationView_ParentNavigation(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ID:              "child-session",
		ParentSessionID: "parent-session",
	}

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("FetchConversation", "parent-session").Return(func() tea.Msg {
		return domain.FetchConversationMsg{}
	})

	parentKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}
	cmd := m.updateConversationView(parentKey, deps)

	assert.Equal(t, "parent-session", m.sessionID)
	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestUpdateConversationView_Refresh(t *testing.T) {
	m := New()
	m.sessionID = "test-session"

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("FetchConversation", "test-session").Return(func() tea.Msg {
		return domain.FetchConversationMsg{}
	})

	refreshKey := tea.KeyMsg{Type: tea.KeyF5}
	cmd := m.updateConversationView(refreshKey, deps)

	assert.NotNil(t, cmd)

	// Check cache was invalidated
	_, _, found := deps.ConversationCache.Get("test-session")
	assert.False(t, found)

	mockAPI.AssertExpectations(t)
}

func TestUpdateApprovalInput_Back(t *testing.T) {
	m := New()
	m.showApprovalPrompt = true
	m.approvalInput.SetValue("test comment")
	deps := createTestDependencies()

	backKey := tea.KeyMsg{Type: tea.KeyEsc}
	cmd := m.updateApprovalInput(backKey, deps)

	assert.False(t, m.showApprovalPrompt)
	assert.Empty(t, m.approvalInput.Value())
	assert.Nil(t, cmd)
}

func TestUpdateApprovalInput_Submit(t *testing.T) {
	m := New()
	m.showApprovalPrompt = true
	m.events = []rpc.ConversationEvent{
		{EventType: "tool_call", ApprovalStatus: "pending", ApprovalID: "approval-123"},
	}
	m.currentApprovalIndex = 0
	m.approvalInput.SetValue("Denial reason")

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("SendApproval", "approval-123", false, "Denial reason").Return(func() tea.Msg {
		return domain.ApprovalSentMsg{Approved: false}
	})

	enterKey := tea.KeyMsg{Type: tea.KeyEnter}
	cmd := m.updateApprovalInput(enterKey, deps)

	assert.False(t, m.showApprovalPrompt)
	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestUpdateResumeInput_EscapeKeys(t *testing.T) {
	tests := []struct {
		name string
		key  tea.KeyMsg
	}{
		{
			name: "escape key",
			key:  tea.KeyMsg{Type: tea.KeyEsc},
		},
		{
			name: "ctrl+c",
			key:  tea.KeyMsg{Type: tea.KeyCtrlC},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			m.showResumePrompt = true
			m.resumeInput.SetValue("test message")
			deps := createTestDependencies()

			cmd := m.updateResumeInput(tt.key, deps)

			assert.False(t, m.showResumePrompt)
			assert.Empty(t, m.resumeInput.Value())
			assert.Nil(t, cmd)
		})
	}
}

func TestUpdateResumeInput_Submit(t *testing.T) {
	m := New()
	m.showResumePrompt = true
	m.sessionID = "current-session"
	m.session = &rpc.SessionState{
		Model:      "claude-3",
		WorkingDir: "/test/dir",
	}
	m.resumeInput.SetValue("Continue with this")

	deps := createTestDependencies()
	mockAPI := deps.APIClient.(*MockAPIClient)

	// Set up expectation
	mockAPI.On("ContinueSession", "current-session", "Continue with this").Return(func() tea.Msg {
		return domain.ContinueSessionMsg{SessionID: "new-session"}
	})

	enterKey := tea.KeyMsg{Type: tea.KeyEnter}
	cmd := m.updateResumeInput(enterKey, deps)

	// Resume prompt stays open until ContinueSessionMsg is received
	assert.True(t, m.showResumePrompt)
	assert.Equal(t, "claude-3", m.parentModel)
	assert.Equal(t, "/test/dir", m.parentWorkingDir)
	assert.NotNil(t, cmd)
	mockAPI.AssertExpectations(t)
}

func TestStartPolling(t *testing.T) {
	m := New()
	m.sessionID = "test-session"

	// First call should start polling
	cmd := m.startPolling()
	require.NotNil(t, cmd)
	assert.True(t, m.isPolling)
	assert.NotNil(t, m.pollTicker)

	// Second call should return nil (already polling)
	cmd2 := m.startPolling()
	assert.Nil(t, cmd2)

	// Clean up
	m.StopPolling()
}

func TestUpdate_KeyMsg_InputModes(t *testing.T) {
	// Test that key messages are routed correctly based on input state
	m := New()
	deps := createTestDependencies()

	// Test approval input mode
	m.showApprovalPrompt = true
	m.approvalInput.Focus()

	key := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}}
	cmd := m.Update(key, deps)
	assert.NotNil(t, cmd) // Should handle text input

	// Test resume input mode
	m.showApprovalPrompt = false
	m.showResumePrompt = true
	m.resumeInput.Focus()

	cmd = m.Update(key, deps)
	assert.NotNil(t, cmd) // Should handle text input

	// Test normal conversation view mode
	m.showResumePrompt = false

	cmd = m.Update(key, deps)
	assert.Nil(t, cmd) // 'a' key does nothing in normal mode
}
