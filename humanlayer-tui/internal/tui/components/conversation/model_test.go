package conversation

import (
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew(t *testing.T) {
	m := New()

	assert.NotNil(t, m.viewport)
	assert.NotNil(t, m.approvalInput)
	assert.NotNil(t, m.resumeInput)
	assert.False(t, m.loading)
	assert.Empty(t, m.sessionID)
	assert.Nil(t, m.session)
	assert.Nil(t, m.events)
	assert.False(t, m.showApprovalPrompt)
	assert.False(t, m.showResumePrompt)
}

func TestSetSession(t *testing.T) {
	m := New()
	sessionID := "test-session-123"

	m.SetSession(sessionID)

	assert.Equal(t, sessionID, m.sessionID)
	assert.True(t, m.loading)
	assert.Nil(t, m.error)
	assert.False(t, m.showApprovalPrompt)
	assert.False(t, m.showResumePrompt)
	assert.Empty(t, m.parentModel)
	assert.Empty(t, m.parentWorkingDir)
	assert.True(t, m.wasAtBottom)
}

func TestClearSession(t *testing.T) {
	m := New()
	m.sessionID = "test-session"
	m.isPolling = true
	m.pollTicker = time.NewTicker(3 * time.Second)

	m.ClearSession()

	assert.Empty(t, m.sessionID)
	assert.False(t, m.isPolling)
	assert.Nil(t, m.pollTicker)
}

func TestStopPolling(t *testing.T) {
	m := New()
	m.isPolling = true
	m.pollTicker = time.NewTicker(3 * time.Second)

	m.StopPolling()

	assert.False(t, m.isPolling)
	assert.Nil(t, m.pollTicker)
}

func TestIsActiveSession(t *testing.T) {
	tests := []struct {
		name     string
		session  *rpc.SessionState
		expected bool
	}{
		{
			name:     "nil session",
			session:  nil,
			expected: false,
		},
		{
			name:     "running session",
			session:  &rpc.SessionState{Status: "running"},
			expected: true,
		},
		{
			name:     "starting session",
			session:  &rpc.SessionState{Status: "starting"},
			expected: true,
		},
		{
			name:     "completed session",
			session:  &rpc.SessionState{Status: "completed"},
			expected: false,
		},
		{
			name:     "failed session",
			session:  &rpc.SessionState{Status: "failed"},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			m.session = tt.session
			assert.Equal(t, tt.expected, m.isActiveSession())
		})
	}
}

func TestUpdateSize(t *testing.T) {
	m := New()

	// Test normal size update
	m.UpdateSize(100, 50)

	assert.Equal(t, 100, m.contentWidth)
	assert.Equal(t, 50, m.contentHeight)
	assert.Equal(t, 100, m.viewport.Width)
	assert.Equal(t, 47, m.viewport.Height)     // 50 - 3 (header 2 + status 1)
	assert.Equal(t, 90, m.approvalInput.Width) // 100 - 10
	assert.Equal(t, 90, m.resumeInput.Width)   // 100 - 10

	// Test minimum size constraints
	m.UpdateSize(5, 10)

	assert.Equal(t, 20, m.viewport.Width)      // minimum 20
	assert.Equal(t, 7, m.viewport.Height)      // 10 - 3 = 7
	assert.Equal(t, 10, m.approvalInput.Width) // minimum 10
	assert.Equal(t, 10, m.resumeInput.Width)   // minimum 10
}

func TestAdjustViewportSize(t *testing.T) {
	m := New()
	m.contentWidth = 100
	m.contentHeight = 50

	// Test without prompts
	m.adjustViewportSize()
	assert.Equal(t, 47, m.viewport.Height) // 50 - 3

	// Test with approval prompt
	m.showApprovalPrompt = true
	m.adjustViewportSize()
	assert.Equal(t, 39, m.viewport.Height) // 50 - 3 - 8

	// Test with resume prompt
	m.showApprovalPrompt = false
	m.showResumePrompt = true
	m.adjustViewportSize()
	assert.Equal(t, 39, m.viewport.Height) // 50 - 3 - 8

	// Test minimum height constraint
	m.contentHeight = 15
	m.adjustViewportSize()
	assert.Equal(t, 5, m.viewport.Height) // minimum 5
}

func TestFindPendingApproval(t *testing.T) {
	m := New()
	m.events = []rpc.ConversationEvent{
		{
			EventType:      "tool_call",
			ApprovalStatus: "approved",
			IsCompleted:    false,
		},
		{
			EventType:      "tool_call",
			ApprovalStatus: "pending",
			IsCompleted:    false,
			ApprovalID:     "approval-1",
		},
		{
			EventType:      "tool_call",
			ApprovalStatus: "pending",
			IsCompleted:    false,
			ApprovalID:     "approval-2",
		},
		{
			EventType:      "tool_call",
			ApprovalStatus: "pending",
			IsCompleted:    true, // completed, should be ignored
			ApprovalID:     "approval-3",
		},
		{
			EventType:      "message",
			ApprovalStatus: "pending", // not a tool_call, should be ignored
		},
	}

	m.findPendingApproval()

	require.Len(t, m.pendingApprovalIndices, 2)
	assert.Equal(t, 1, m.pendingApprovalIndices[0])
	assert.Equal(t, 2, m.pendingApprovalIndices[1])
	assert.Equal(t, 1, m.currentApprovalIndex)

	// Verify PendingApproval() returns the correct event
	approval := m.PendingApproval()
	require.NotNil(t, approval)
	assert.Equal(t, "approval-1", approval.ApprovalID)
}

func TestClearApprovalState(t *testing.T) {
	m := New()
	m.contentWidth = 100
	m.contentHeight = 50
	m.currentApprovalIndex = 1
	m.showApprovalPrompt = true
	m.approvalInput.SetValue("test comment")

	m.clearApprovalState()

	assert.Equal(t, -1, m.currentApprovalIndex)
	assert.False(t, m.showApprovalPrompt)
	assert.Empty(t, m.approvalInput.Value())
}

func TestClearResumeState(t *testing.T) {
	m := New()
	m.contentWidth = 100
	m.contentHeight = 50
	m.showResumePrompt = true
	m.resumeInput.SetValue("test message")

	m.clearResumeState()

	assert.False(t, m.showResumePrompt)
	assert.Empty(t, m.resumeInput.Value())
}

func TestGetters(t *testing.T) {
	m := New()

	// Set up test data
	sessionID := "test-session"
	session := &rpc.SessionState{Status: "running"}
	events := []rpc.ConversationEvent{
		{EventType: "message"},
		{EventType: "tool_call", ApprovalID: "test"},
	}

	m.sessionID = sessionID
	m.session = session
	m.events = events
	m.loading = true
	m.error = assert.AnError
	m.isPolling = true
	m.showApprovalPrompt = true
	m.showResumePrompt = true
	m.currentApprovalIndex = 1
	m.pendingApprovalIndices = []int{1}
	m.wasAtBottom = true

	// Test all getters
	assert.Equal(t, sessionID, m.SessionID())
	assert.Equal(t, session, m.Session())
	assert.Equal(t, events, m.Events())
	assert.True(t, m.Loading())
	assert.Equal(t, assert.AnError, m.Error())
	assert.True(t, m.IsPolling())
	assert.True(t, m.ShowApprovalPrompt())
	assert.True(t, m.ShowResumePrompt())
	assert.True(t, m.WasAtBottom())

	// Test PendingApproval
	approval := m.PendingApproval()
	require.NotNil(t, approval)
	assert.Equal(t, "test", approval.ApprovalID)

	// Test PendingApprovalCount
	assert.Equal(t, 1, m.PendingApprovalCount())
}
