package conversation

import (
	"errors"
	"strings"
	"testing"

	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestView_Loading(t *testing.T) {
	m := New()
	m.loading = true

	view := m.View(100, 50)

	assert.Contains(t, view, "Loading conversation...")
}

func TestView_Error(t *testing.T) {
	m := New()
	m.error = errors.New("test error message")

	view := m.View(100, 50)

	assert.Contains(t, view, "Error: test error message")
}

func TestView_NoSession(t *testing.T) {
	m := New()
	m.session = nil

	view := m.View(100, 50)

	assert.Contains(t, view, "No conversation selected")
}

func TestView_WithSession(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ID:     "test-session",
		Status: "running",
		Model:  "claude-3",
		Query:  "Test query",
	}
	m.events = []rpc.ConversationEvent{
		{
			EventType: "message",
			Role:      "assistant",
			Content:   "Hello, how can I help?",
		},
	}

	// Set viewport content (normally done by Update method)
	content := m.renderConversationContent()
	m.viewport.SetContent(content)

	view := m.View(100, 50)

	// Should contain header
	assert.Contains(t, view, "Conversation")
	assert.Contains(t, view, "claude-3")

	// Should contain conversation content
	assert.Contains(t, view, "Test query")
	assert.Contains(t, view, "Hello, how can I help?")

	// Should contain status line
	assert.Contains(t, view, "[esc] back")
	assert.Contains(t, view, "[↑/↓] scroll")
}

func TestView_WithPendingApprovals(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ID:     "test-session",
		Status: "running",
	}
	m.events = []rpc.ConversationEvent{
		{EventType: "tool_call", ApprovalStatus: "pending", ApprovalID: "1"},
		{EventType: "tool_call", ApprovalStatus: "pending", ApprovalID: "2"},
	}
	m.pendingApprovalIndices = []int{0, 1}
	m.currentApprovalIndex = 0

	view := m.View(100, 50)

	assert.Contains(t, view, "2 pending approvals")
	assert.Contains(t, view, "[y] approve")
	assert.Contains(t, view, "[n] deny")
}

func TestView_WithApprovalPrompt(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "running"}
	m.showApprovalPrompt = true
	m.approvalInput.SetValue("Test denial reason")

	view := m.View(100, 50)

	assert.Contains(t, view, "❌ Deny with reason:")
	assert.Contains(t, view, "[enter] to submit")
	assert.Contains(t, view, "[esc] to cancel")
}

func TestView_WithResumePrompt(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "completed"}
	m.showResumePrompt = true
	m.resumeInput.SetValue("Continue message")

	view := m.View(100, 50)

	assert.Contains(t, view, "🔄 Continue session:")
	assert.Contains(t, view, "[enter] to submit")
	assert.Contains(t, view, "[esc] to cancel")
}

func TestView_ParentSession(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ID:              "child",
		ParentSessionID: "parent",
		Status:          "running",
	}

	view := m.View(100, 50)

	assert.Contains(t, view, "[continued]")
	assert.Contains(t, view, "[p] parent")
}

func TestRenderHeader_StatusIcons(t *testing.T) {
	tests := []struct {
		status       string
		expectedIcon string
	}{
		{"starting", "🔄"},
		{"running", "🟢"},
		{"completed", "✅"},
		{"failed", "❌"},
		{"waiting_input", "⏳"},
		{"unknown", "⏸"}, // default
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			m := New()
			m.session = &rpc.SessionState{Status: tt.status}

			header := m.renderHeader(100)

			assert.Contains(t, header, tt.expectedIcon)
		})
	}
}

func TestRenderConversationContent_Empty(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{}
	m.events = []rpc.ConversationEvent{}

	content := m.renderConversationContent()

	assert.Contains(t, content, "No conversation events yet...")
}

func TestRenderConversationContent_WithEvents(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		Query: "Initial query",
	}
	m.events = []rpc.ConversationEvent{
		{
			EventType: "message",
			Role:      "user",
			Content:   "Follow-up question",
		},
		{
			EventType: "message",
			Role:      "assistant",
			Content:   "Assistant response",
		},
		{
			EventType:      "tool_call",
			ToolName:       "calculator",
			ApprovalStatus: "approved",
			ToolInputJSON:  `{"operation": "add", "a": 1, "b": 2}`,
		},
		{
			EventType:         "tool_result",
			ToolResultContent: "Result: 3",
			ToolResultForID:   "tool-123",
		},
	}

	content := m.renderConversationContent()

	// Check all content is rendered
	assert.Contains(t, content, "Initial query")
	assert.Contains(t, content, "👤 User:")
	assert.Contains(t, content, "Follow-up question")
	assert.Contains(t, content, "🤖 Assistant:")
	assert.Contains(t, content, "Assistant response")
	assert.Contains(t, content, "✅ Tool: calculator (approved)")
	assert.Contains(t, content, "📄 Tool Output:")
	assert.Contains(t, content, "Result: 3")
}

func TestRenderToolCall_States(t *testing.T) {
	tests := []struct {
		name           string
		approvalStatus string
		expectedIcon   string
		expectedText   string
	}{
		{
			name:           "pending",
			approvalStatus: "pending",
			expectedIcon:   "⏳",
			expectedText:   "(pending approval)",
		},
		{
			name:           "approved",
			approvalStatus: "approved",
			expectedIcon:   "✅",
			expectedText:   "(approved)",
		},
		{
			name:           "denied",
			approvalStatus: "denied",
			expectedIcon:   "❌",
			expectedText:   "(denied)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := New()
			event := &rpc.ConversationEvent{
				EventType:      "tool_call",
				ToolName:       "test_tool",
				ApprovalStatus: tt.approvalStatus,
			}

			result := m.renderToolCall(event, 0)

			assert.Contains(t, result, tt.expectedIcon)
			assert.Contains(t, result, tt.expectedText)
		})
	}
}

func TestRenderToolCall_PendingWithHint(t *testing.T) {
	m := New()
	event := &rpc.ConversationEvent{
		EventType:      "tool_call",
		ToolName:       "test_tool",
		ApprovalStatus: "pending",
		ApprovalID:     "approval-123",
	}
	m.events = []rpc.ConversationEvent{*event}
	m.pendingApprovalIndices = []int{0}
	m.currentApprovalIndex = 0

	result := m.renderToolCall(event, 0)

	assert.Contains(t, result, "Press [y] to approve, [n] to deny")
}

func TestRenderToolCall_MultipleApprovals(t *testing.T) {
	m := New()
	event1 := &rpc.ConversationEvent{
		EventType:      "tool_call",
		ApprovalStatus: "pending",
		ApprovalID:     "1",
	}
	event2 := &rpc.ConversationEvent{
		EventType:      "tool_call",
		ApprovalStatus: "pending",
		ApprovalID:     "2",
	}
	m.events = []rpc.ConversationEvent{*event1, *event2}
	m.pendingApprovalIndices = []int{0, 1}

	result := m.renderToolCall(event2, 1)

	assert.Contains(t, result, "2 of 2")
}

func TestRenderToolResult_Correlation(t *testing.T) {
	m := New()

	// Set up tool call and result
	toolCall := rpc.ConversationEvent{
		EventType:      "tool_call",
		ToolID:         "tool-123",
		ApprovalStatus: "denied",
	}
	toolResult := &rpc.ConversationEvent{
		EventType:         "tool_result",
		ToolResultContent: "Permission denied by user",
		ToolResultForID:   "tool-123",
	}

	m.events = []rpc.ConversationEvent{toolCall}

	result := m.renderToolResult(toolResult)

	// Should render as denial reason
	assert.Contains(t, result, "💬 Denial Reason:")
	assert.Contains(t, result, "Permission denied by user")
}

func TestRenderToolResult_NoCorrelation(t *testing.T) {
	m := New()

	// Create content that's longer than 200 characters
	longContent := "Normal tool output that is very long and should be truncated after a certain number of characters to avoid taking up too much space in the UI. This content is intentionally made longer to exceed the 200 character limit for truncation testing."

	toolResult := &rpc.ConversationEvent{
		EventType:         "tool_result",
		ToolResultContent: longContent,
		ToolResultForID:   "tool-999", // No matching tool call
	}

	result := m.renderToolResult(toolResult)

	// Should render as normal tool output with truncation
	assert.Contains(t, result, "📄 Tool Output:")
	assert.Contains(t, result, "...")
	assert.Less(t, len(result), len(longContent)+50) // Should be truncated (adding some buffer for the header)
}

func TestRenderToolOutput_Truncation(t *testing.T) {
	m := New()

	// Test line truncation
	longContent := strings.Repeat("Line\n", 10)
	result := m.renderToolOutput(longContent)

	lines := strings.Split(result, "\n")
	assert.LessOrEqual(t, len(lines)-1, 6) // 5 lines + header
	assert.Contains(t, result, "...")

	// Test character truncation
	veryLongLine := strings.Repeat("a", 300)
	result = m.renderToolOutput(veryLongLine)

	assert.Less(t, len(result), 250)
	assert.Contains(t, result, "...")
}

func TestRenderInputPrompts_StatusLine(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "running"}

	prompts := m.renderInputPrompts(100)

	// Should show basic navigation
	assert.Contains(t, prompts, "[esc] back")
	assert.Contains(t, prompts, "[↑/↓] scroll")
	assert.Contains(t, prompts, "[F5] refresh")
}

func TestRenderInputPrompts_CompletedSession(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "completed"}

	prompts := m.renderInputPrompts(100)

	assert.Contains(t, prompts, "[r] resume")
}

func TestRenderInputPrompts_WithParent(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ParentSessionID: "parent-123",
	}

	prompts := m.renderInputPrompts(100)

	assert.Contains(t, prompts, "[p] parent")
}

func TestView_UpdatesSizeOnRender(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{Status: "running"}

	// Initial size
	m.View(80, 40)
	assert.Equal(t, 80, m.contentWidth)
	assert.Equal(t, 40, m.contentHeight)

	// Size change
	m.View(120, 60)
	assert.Equal(t, 120, m.contentWidth)
	assert.Equal(t, 60, m.contentHeight)
}

func TestRenderEvent_UnknownType(t *testing.T) {
	m := New()
	event := &rpc.ConversationEvent{
		EventType: "unknown_type",
	}

	result := m.renderEvent(event, 0)

	assert.Contains(t, result, "[unknown_type event]")
}

func TestRenderToolResult_EmptyContent(t *testing.T) {
	m := New()
	event := &rpc.ConversationEvent{
		EventType:         "tool_result",
		ToolResultContent: "",
	}

	result := m.renderToolResult(event)

	assert.Empty(t, result)
}

// Integration test for full view rendering
func TestView_Integration(t *testing.T) {
	m := New()
	m.session = &rpc.SessionState{
		ID:              "child-session",
		ParentSessionID: "parent-session",
		Status:          "running",
		Model:           "claude-3-opus",
		Query:           "Help me write a function",
	}

	// Add various event types
	m.events = []rpc.ConversationEvent{
		{
			EventType: "message",
			Role:      "assistant",
			Content:   "I'll help you write a function.",
		},
		{
			EventType:      "tool_call",
			ToolName:       "code_editor",
			ApprovalStatus: "pending",
			ApprovalID:     "approval-1",
			ToolInputJSON:  `{"action": "create_file", "path": "main.go"}`,
		},
	}

	// Set up pending approval
	m.findPendingApproval() // This will populate pendingApprovalIndices and currentApprovalIndex

	// Verify the pending approval was found
	require.Len(t, m.pendingApprovalIndices, 1)
	require.Equal(t, 1, m.currentApprovalIndex) // Event at index 1 is the tool call

	// Set the viewport content (normally done in Update method)
	content := m.renderConversationContent()
	m.viewport.SetContent(content)

	// Render full view
	view := m.View(120, 50)

	// Verify all components are present
	require.NotEmpty(t, view)

	// Header
	assert.Contains(t, view, "🟢 Conversation (claude-3-opus) [continued]")
	assert.Contains(t, view, "1 pending approval")

	// Content
	assert.Contains(t, view, "Help me write a function")
	assert.Contains(t, view, "I'll help you write a function")
	assert.Contains(t, view, "⏳ Tool: code_editor (pending approval)")
	assert.Contains(t, view, "Press [y] to approve, [n] to deny") // Should now work with index-based comparison

	// Status line
	assert.Contains(t, view, "[y] approve")
	assert.Contains(t, view, "[n] deny")
	assert.Contains(t, view, "[p] parent")
}
