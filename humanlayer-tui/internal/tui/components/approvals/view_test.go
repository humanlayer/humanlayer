package approvals

import (
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestView_EmptyState(t *testing.T) {
	model := New()
	model.SetRequests([]domain.Request{})

	output := model.View()

	assert.Contains(t, output, "No pending approvals")
}

func TestView_ListViewGrouping(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name           string
		requests       []domain.Request
		expectedGroups []string
		expectedOrder  []string
	}{
		{
			name: "Group by session",
			requests: []domain.Request{
				{
					ID:           "req-1",
					SessionID:    "sess-1",
					SessionQuery: "Query 1",
					SessionModel: "claude-3",
					Type:         domain.ApprovalRequest,
					Message:      "Approval 1",
					CreatedAt:    now.Add(-5 * time.Minute),
				},
				{
					ID:           "req-2",
					SessionID:    "sess-1",
					SessionQuery: "Query 1",
					SessionModel: "claude-3",
					Type:         domain.ApprovalRequest,
					Message:      "Approval 2",
					CreatedAt:    now.Add(-3 * time.Minute),
				},
				{
					ID:           "req-3",
					SessionID:    "sess-2",
					SessionQuery: "Query 2",
					SessionModel: "gpt-4",
					Type:         domain.HumanContactRequest,
					Message:      "Human contact",
					CreatedAt:    now.Add(-1 * time.Minute),
				},
			},
			expectedGroups: []string{
				"Session: Query 2 (gpt-4)",
				"Session: Query 1 (claude-3)",
			},
			expectedOrder: []string{
				"Human contact",
				"Approval 1",
				"Approval 2",
			},
		},
		{
			name: "Mixed session and no-session requests",
			requests: []domain.Request{
				{
					ID:        "req-1",
					Type:      domain.ApprovalRequest,
					Message:   "No session approval",
					CreatedAt: now,
				},
				{
					ID:           "req-2",
					SessionID:    "sess-1",
					SessionQuery: "Query 1",
					Type:         domain.ApprovalRequest,
					Message:      "Session approval",
					CreatedAt:    now.Add(-2 * time.Minute),
				},
			},
			expectedGroups: []string{
				"Session: Query 1",
			},
			expectedOrder: []string{
				"Session approval",
				"No session approval",
			},
		},
		{
			name: "Sort sessions by most recent",
			requests: []domain.Request{
				{
					ID:           "req-1",
					SessionID:    "sess-old",
					SessionQuery: "Old session",
					Type:         domain.ApprovalRequest,
					Message:      "Old approval",
					CreatedAt:    now.Add(-10 * time.Minute),
				},
				{
					ID:           "req-2",
					SessionID:    "sess-new",
					SessionQuery: "New session",
					Type:         domain.ApprovalRequest,
					Message:      "New approval 1",
					CreatedAt:    now.Add(-2 * time.Minute),
				},
				{
					ID:           "req-3",
					SessionID:    "sess-new",
					SessionQuery: "New session",
					Type:         domain.ApprovalRequest,
					Message:      "New approval 2",
					CreatedAt:    now.Add(-1 * time.Minute), // Most recent
				},
			},
			expectedGroups: []string{
				"Session: New session",
				"Session: Old session",
			},
			expectedOrder: []string{
				"New approval 1",
				"New approval 2",
				"Old approval",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := New()
			model.SetRequests(tt.requests)
			model.UpdateSize(80, 20)

			output := model.View()

			// Check that groups appear in the expected order
			for _, group := range tt.expectedGroups {
				assert.Contains(t, output, group)
			}

			// Check that requests appear in the expected order
			for i, msg := range tt.expectedOrder {
				pos := strings.Index(output, msg)
				require.NotEqual(t, -1, pos, "Expected to find '%s' in output", msg)

				// Check ordering
				if i > 0 {
					prevPos := strings.Index(output, tt.expectedOrder[i-1])
					assert.Less(t, prevPos, pos, "Expected '%s' to appear before '%s'", tt.expectedOrder[i-1], msg)
				}
			}
		})
	}
}

func TestView_IconsAndFormatting(t *testing.T) {
	now := time.Now()
	model := New()

	requests := []domain.Request{
		{
			ID:        "req-1",
			Type:      domain.ApprovalRequest,
			Message:   "Approval request",
			CreatedAt: now,
		},
		{
			ID:        "req-2",
			Type:      domain.HumanContactRequest,
			Message:   "Human contact request",
			CreatedAt: now,
		},
	}

	model.SetRequests(requests)
	model.UpdateSize(80, 20)

	output := model.View()

	// Check icons
	assert.Contains(t, output, "📋") // Approval icon
	assert.Contains(t, output, "💬") // Human contact icon

	// Check time formatting
	timeStr := now.Format("15:04")
	assert.Contains(t, output, timeStr)
}

func TestView_MessageTruncation(t *testing.T) {
	model := New()

	longMessage := strings.Repeat("This is a very long message. ", 10)
	requests := []domain.Request{
		{
			ID:        "req-1",
			Type:      domain.ApprovalRequest,
			Message:   longMessage,
			CreatedAt: time.Now(),
		},
	}

	model.SetRequests(requests)
	model.UpdateSize(80, 20)

	output := model.View()

	// Check that message is truncated
	assert.Contains(t, output, "...")
	assert.LessOrEqual(t, len(output), 2000) // Reasonable output size
}

func TestView_CursorHighlighting(t *testing.T) {
	model := New()

	requests := []domain.Request{
		{
			ID:        "req-1",
			Type:      domain.ApprovalRequest,
			Message:   "First request",
			CreatedAt: time.Now(),
		},
		{
			ID:        "req-2",
			Type:      domain.ApprovalRequest,
			Message:   "Second request",
			CreatedAt: time.Now(),
		},
	}

	model.SetRequests(requests)
	model.SetCursor(0)
	model.UpdateSize(80, 20)

	// Note: We can't easily test the actual highlighting (ANSI codes)
	// but we can verify the view renders without error
	output := model.View()
	assert.NotEmpty(t, output)
	assert.Contains(t, output, "First request")
	assert.Contains(t, output, "Second request")
}

func TestView_DetailView(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name     string
		request  domain.Request
		expected []string
	}{
		{
			name: "Approval request detail",
			request: domain.Request{
				ID:   "req-1",
				Type: domain.ApprovalRequest,
				Tool: "dangerous_function",
				Parameters: map[string]interface{}{
					"param1": "value1",
					"param2": 42,
				},
				SessionID:    "sess-123",
				SessionQuery: "Test query",
				SessionModel: "claude-3",
				CreatedAt:    now,
			},
			expected: []string{
				"Time:",
				now.Format("15:04:05"),
				"Session:",
				"Test query (claude-3)",
				"Function:",
				"dangerous_function",
				"Parameters:",
				"param1: value1",
				"param2: 42",
				"Press [y] to approve, [n] to deny, [esc] to go back",
			},
		},
		{
			name: "Human contact detail",
			request: domain.Request{
				ID:        "req-2",
				Type:      domain.HumanContactRequest,
				Message:   "Please help with this task",
				CreatedAt: now,
			},
			expected: []string{
				"Time:",
				now.Format("15:04:05"),
				"Message:",
				"Please help with this task",
				"Press [n] to respond, [esc] to go back",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := New()
			model.SetViewState(domain.DetailView)
			model.SetSelectedRequest(&tt.request)

			output := model.View()

			for _, exp := range tt.expected {
				assert.Contains(t, output, exp)
			}
		})
	}
}

func TestView_FeedbackView(t *testing.T) {
	tests := []struct {
		name     string
		request  domain.Request
		expected []string
	}{
		{
			name: "Feedback for approval",
			request: domain.Request{
				ID:   "req-1",
				Type: domain.ApprovalRequest,
				Tool: "some_function",
			},
			expected: []string{
				"Function: some_function",
				"Press [enter] to submit, [esc] to cancel",
			},
		},
		{
			name: "Feedback for human contact",
			request: domain.Request{
				ID:      "req-2",
				Type:    domain.HumanContactRequest,
				Message: strings.Repeat("Long message ", 20),
			},
			expected: []string{
				"Message: Long message",
				"...",
				"Press [enter] to submit, [esc] to cancel",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := New()
			model.SetViewState(domain.FeedbackView)
			model.SetFeedbackFor(&tt.request)

			output := model.View()

			for _, exp := range tt.expected {
				assert.Contains(t, output, exp)
			}
		})
	}
}

func TestView_NoSelectedRequest(t *testing.T) {
	tests := []struct {
		name      string
		viewState domain.ViewState
		expected  string
	}{
		{
			name:      "Detail view without selection",
			viewState: domain.DetailView,
			expected:  "No request selected",
		},
		{
			name:      "Feedback view without selection",
			viewState: domain.FeedbackView,
			expected:  "No request selected for feedback",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := New()
			model.SetViewState(tt.viewState)
			model.SetSelectedRequest(nil)
			model.SetFeedbackFor(nil)

			output := model.View()

			assert.Contains(t, output, tt.expected)
		})
	}
}

func TestView_SessionModelDisplay(t *testing.T) {
	model := New()

	requests := []domain.Request{
		{
			ID:           "req-1",
			SessionID:    "sess-1",
			SessionQuery: "Query 1",
			SessionModel: "claude-3",
			Type:         domain.ApprovalRequest,
			Message:      "With model",
			CreatedAt:    time.Now(),
		},
		{
			ID:           "req-2",
			SessionID:    "sess-2",
			SessionQuery: "Query 2",
			SessionModel: "default",
			Type:         domain.ApprovalRequest,
			Message:      "Default model",
			CreatedAt:    time.Now(),
		},
		{
			ID:           "req-3",
			SessionID:    "sess-3",
			SessionQuery: "Query 3",
			SessionModel: "",
			Type:         domain.ApprovalRequest,
			Message:      "No model",
			CreatedAt:    time.Now(),
		},
	}

	model.SetRequests(requests)
	model.UpdateSize(80, 20)

	output := model.View()

	// Should show model for non-default
	assert.Contains(t, output, "Query 1 (claude-3)")

	// Should not show default model
	assert.Contains(t, output, "Session: Query 2")
	assert.NotContains(t, output, "(default)")

	// Should handle empty model
	assert.Contains(t, output, "Session: Query 3")
}
