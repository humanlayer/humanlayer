package approvals

import (
	"testing"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"github.com/stretchr/testify/assert"
)

func TestNew(t *testing.T) {
	model := New()

	assert.NotNil(t, model)
	assert.Empty(t, model.GetRequests())
	assert.Equal(t, 0, model.GetCursor())
	assert.Equal(t, domain.ListView, model.GetViewState())
	assert.Nil(t, model.GetSelectedRequest())
	assert.Nil(t, model.GetFeedbackFor())
	assert.False(t, model.IsApproving())

	// Check that viewport and input are initialized
	vp := model.GetViewport()
	assert.NotNil(t, vp)
	assert.Equal(t, 80, vp.Width)
	assert.Equal(t, 20, vp.Height)

	input := model.GetFeedbackInput()
	assert.NotNil(t, input)
	assert.Equal(t, "Enter your response...", input.Placeholder)
	assert.Equal(t, 500, input.CharLimit)
	assert.Equal(t, 60, input.Width)
}

func TestUpdateSize(t *testing.T) {
	tests := []struct {
		name           string
		width          int
		height         int
		expectedWidth  int
		expectedHeight int
		expectedInput  int
	}{
		{
			name:           "Normal size",
			width:          100,
			height:         30,
			expectedWidth:  100,
			expectedHeight: 30,
			expectedInput:  80, // width - 20
		},
		{
			name:           "Minimum size",
			width:          10,
			height:         3,
			expectedWidth:  20, // minimum
			expectedHeight: 5,  // minimum
			expectedInput:  10, // minimum
		},
		{
			name:           "Small width",
			width:          25,
			height:         20,
			expectedWidth:  25,
			expectedHeight: 20,
			expectedInput:  10, // minimum when width-20 < 10
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model := New()
			model.UpdateSize(tt.width, tt.height)

			vp := model.GetViewport()
			assert.Equal(t, tt.expectedWidth, vp.Width)
			assert.Equal(t, tt.expectedHeight, vp.Height)

			input := model.GetFeedbackInput()
			assert.Equal(t, tt.expectedInput, input.Width)
		})
	}
}

func TestGetSetRequests(t *testing.T) {
	model := New()

	requests := []domain.Request{
		{ID: "req-1", Type: domain.ApprovalRequest},
		{ID: "req-2", Type: domain.HumanContactRequest},
	}

	model.SetRequests(requests)

	assert.Equal(t, requests, model.GetRequests())
	assert.Equal(t, 2, len(model.GetRequests()))
}

func TestCursorManagement(t *testing.T) {
	model := New()

	// Test cursor adjustment when setting requests
	model.SetCursor(5)
	model.SetRequests([]domain.Request{
		{ID: "req-1"},
		{ID: "req-2"},
	})

	// Cursor should be adjusted to valid range
	assert.Equal(t, 1, model.GetCursor())

	// Test cursor movement
	model.MoveCursorUp()
	assert.Equal(t, 0, model.GetCursor())

	// Can't move up from top
	model.MoveCursorUp()
	assert.Equal(t, 0, model.GetCursor())

	// Move down
	model.MoveCursorDown()
	assert.Equal(t, 1, model.GetCursor())

	// Can't move down from bottom
	model.MoveCursorDown()
	assert.Equal(t, 1, model.GetCursor())

	// Test SetCursor
	model.SetCursor(0)
	assert.Equal(t, 0, model.GetCursor())
}

func TestGetRequestAtCursor(t *testing.T) {
	model := New()

	// Empty list
	assert.Nil(t, model.GetRequestAtCursor())

	// With requests
	req1 := domain.Request{ID: "req-1", Message: "First"}
	req2 := domain.Request{ID: "req-2", Message: "Second"}
	model.SetRequests([]domain.Request{req1, req2})

	model.SetCursor(0)
	result := model.GetRequestAtCursor()
	assert.NotNil(t, result)
	assert.Equal(t, "req-1", result.ID)

	model.SetCursor(1)
	result = model.GetRequestAtCursor()
	assert.NotNil(t, result)
	assert.Equal(t, "req-2", result.ID)

	// Out of bounds
	model.SetCursor(2)
	assert.Nil(t, model.GetRequestAtCursor())
}

func TestViewStateManagement(t *testing.T) {
	model := New()

	assert.Equal(t, domain.ListView, model.GetViewState())

	model.SetViewState(domain.DetailView)
	assert.Equal(t, domain.DetailView, model.GetViewState())

	model.SetViewState(domain.FeedbackView)
	assert.Equal(t, domain.FeedbackView, model.GetViewState())
}

func TestSelectedRequestManagement(t *testing.T) {
	model := New()

	assert.Nil(t, model.GetSelectedRequest())

	req := &domain.Request{ID: "req-1", Message: "Test"}
	model.SetSelectedRequest(req)

	selected := model.GetSelectedRequest()
	assert.NotNil(t, selected)
	assert.Equal(t, "req-1", selected.ID)

	model.SetSelectedRequest(nil)
	assert.Nil(t, model.GetSelectedRequest())
}

func TestFeedbackManagement(t *testing.T) {
	model := New()

	// Test feedback for request
	assert.Nil(t, model.GetFeedbackFor())

	req := &domain.Request{ID: "req-1"}
	model.SetFeedbackFor(req)
	assert.Equal(t, req, model.GetFeedbackFor())

	// Test approving flag
	assert.False(t, model.IsApproving())
	model.SetIsApproving(true)
	assert.True(t, model.IsApproving())

	// Test feedback input
	input := model.GetFeedbackInput()
	assert.NotNil(t, input)

	// Modify and set input
	input.SetValue("test feedback")
	model.SetFeedbackInput(input)

	updatedInput := model.GetFeedbackInput()
	assert.Equal(t, "test feedback", updatedInput.Value())

	// Test reset and focus
	model.ResetFeedbackInput()
	assert.Empty(t, model.GetFeedbackInput().Value())

	model.FocusFeedbackInput()
	assert.True(t, model.GetFeedbackInput().Focused())
}

func TestRemoveRequest(t *testing.T) {
	model := New()

	requests := []domain.Request{
		{ID: "req-1", CreatedAt: time.Now()},
		{ID: "req-2", CreatedAt: time.Now()},
		{ID: "req-3", CreatedAt: time.Now()},
	}
	model.SetRequests(requests)
	model.SetCursor(2) // Point to last item

	// Remove middle item
	model.RemoveRequest("req-2")

	remaining := model.GetRequests()
	assert.Equal(t, 2, len(remaining))
	assert.Equal(t, "req-1", remaining[0].ID)
	assert.Equal(t, "req-3", remaining[1].ID)

	// Cursor should be adjusted
	assert.Equal(t, 1, model.GetCursor())

	// Remove non-existent item (no effect)
	model.RemoveRequest("req-999")
	assert.Equal(t, 2, len(model.GetRequests()))

	// Remove last item when cursor points to it
	model.SetCursor(1)
	model.RemoveRequest("req-3")
	assert.Equal(t, 1, len(model.GetRequests()))
	assert.Equal(t, 0, model.GetCursor())

	// Remove last remaining item
	model.RemoveRequest("req-1")
	assert.Empty(t, model.GetRequests())
	assert.Equal(t, 0, model.GetCursor())
}

func TestHasRequests(t *testing.T) {
	model := New()

	assert.False(t, model.HasRequests())

	model.SetRequests([]domain.Request{{ID: "req-1"}})
	assert.True(t, model.HasRequests())

	model.SetRequests([]domain.Request{})
	assert.False(t, model.HasRequests())
}

func TestViewportAndInputInteraction(t *testing.T) {
	model := New()

	// Get initial viewport
	vp := model.GetViewport()
	assert.NotNil(t, vp)

	// Create new viewport and set it
	newVp := viewport.New(120, 40)
	newVp.SetContent("test content")
	model.SetViewport(newVp)

	// Verify it was set
	updatedVp := model.GetViewport()
	assert.Equal(t, 120, updatedVp.Width)
	assert.Equal(t, 40, updatedVp.Height)

	// Similar test for input
	newInput := textinput.New()
	newInput.Placeholder = "Custom placeholder"
	model.SetFeedbackInput(newInput)

	updatedInput := model.GetFeedbackInput()
	assert.Equal(t, "Custom placeholder", updatedInput.Placeholder)
}
