package sessions

import (
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestNew(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)

	if model == nil {
		t.Fatal("expected model to be created")
	}

	if model.apiClient != mockClient {
		t.Error("expected apiClient to be set")
	}

	if model.viewState != domain.ListView {
		t.Errorf("expected initial viewState to be ListView, got %v", model.viewState)
	}

	if len(model.sessions) != 0 {
		t.Errorf("expected sessions to be empty, got %d", len(model.sessions))
	}

	if model.cursor != 0 {
		t.Errorf("expected cursor to be 0, got %d", model.cursor)
	}

	if model.launchModelSelect != 0 {
		t.Errorf("expected launchModelSelect to be 0, got %d", model.launchModelSelect)
	}

	if model.launchActiveField != 0 {
		t.Errorf("expected launchActiveField to be 0, got %d", model.launchActiveField)
	}
}

func TestUpdateSize(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)

	tests := []struct {
		name           string
		width          int
		height         int
		expectedWidth  int
		expectedHeight int
	}{
		{
			name:           "normal dimensions",
			width:          100,
			height:         30,
			expectedWidth:  100,
			expectedHeight: 30,
		},
		{
			name:           "minimum width",
			width:          10,
			height:         30,
			expectedWidth:  20, // minimum width
			expectedHeight: 30,
		},
		{
			name:           "minimum height",
			width:          100,
			height:         2,
			expectedWidth:  100,
			expectedHeight: 5, // minimum height
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.UpdateSize(tt.width, tt.height)

			if model.width != tt.width {
				t.Errorf("expected width %d, got %d", tt.width, model.width)
			}

			if model.height != tt.height {
				t.Errorf("expected height %d, got %d", tt.height, model.height)
			}

			if model.viewport.Width != tt.expectedWidth {
				t.Errorf("expected viewport width %d, got %d", tt.expectedWidth, model.viewport.Width)
			}

			if model.viewport.Height != tt.expectedHeight {
				t.Errorf("expected viewport height %d, got %d", tt.expectedHeight, model.viewport.Height)
			}

			// Check input field widths
			expectedInputWidth := tt.expectedWidth - 20
			if expectedInputWidth < 10 {
				expectedInputWidth = 10
			}

			if model.launchQueryInput.Width != expectedInputWidth {
				t.Errorf("expected query input width %d, got %d", expectedInputWidth, model.launchQueryInput.Width)
			}

			if model.launchWorkingDir.Width != expectedInputWidth {
				t.Errorf("expected working dir input width %d, got %d", expectedInputWidth, model.launchWorkingDir.Width)
			}
		})
	}
}

func TestSessionSorting(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)

	now := time.Now()

	// Create test sessions with different statuses and times
	testSessions := []session.Info{
		{
			ID:             "1",
			Status:         "completed",
			LastActivityAt: now.Add(-2 * time.Hour),
		},
		{
			ID:             "2",
			Status:         "waiting_input",
			LastActivityAt: now.Add(-1 * time.Hour),
		},
		{
			ID:             "3",
			Status:         "running",
			LastActivityAt: now.Add(-30 * time.Minute),
		},
		{
			ID:             "4",
			Status:         "failed",
			LastActivityAt: now.Add(-5 * time.Minute),
		},
		{
			ID:             "5",
			Status:         "running",
			LastActivityAt: now.Add(-45 * time.Minute),
		},
		{
			ID:             "6",
			Status:         "waiting_input",
			LastActivityAt: now.Add(-2 * time.Hour),
		},
	}

	model.sessions = testSessions
	model.updateSortedSessions()

	// Expected order:
	// 1. waiting_input (newer first)
	// 2. running (newer first)
	// 3. completed
	// 4. failed
	expectedOrder := []string{"2", "6", "3", "5", "1", "4"}

	if len(model.sortedSessions) != len(expectedOrder) {
		t.Fatalf("expected %d sorted sessions, got %d", len(expectedOrder), len(model.sortedSessions))
	}

	for i, expectedID := range expectedOrder {
		if model.sortedSessions[i].ID != expectedID {
			t.Errorf("position %d: expected session ID %s, got %s", i, expectedID, model.sortedSessions[i].ID)
		}
	}
}

func TestGetters(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)

	// Test GetViewState
	if model.GetViewState() != domain.ListView {
		t.Errorf("expected ListView, got %v", model.GetViewState())
	}

	// Test GetSessions
	testSessions := []session.Info{{ID: "test1"}, {ID: "test2"}}
	model.sessions = testSessions
	gotSessions := model.GetSessions()
	if len(gotSessions) != len(testSessions) {
		t.Errorf("expected %d sessions, got %d", len(testSessions), len(gotSessions))
	}

	// Test GetCursor
	model.cursor = 5
	if model.GetCursor() != 5 {
		t.Errorf("expected cursor 5, got %d", model.GetCursor())
	}

	// Test GetSelectedSession
	sess := &session.Info{ID: "selected"}
	model.selectedSession = sess
	if model.GetSelectedSession() != sess {
		t.Error("expected selected session to match")
	}

	// Test GetSavedQueryContent
	model.savedQueryContent = "test query"
	if model.GetSavedQueryContent() != "test query" {
		t.Errorf("expected 'test query', got %s", model.GetSavedQueryContent())
	}

	// Test GetLaunchModelSelect
	model.launchModelSelect = 2
	if model.GetLaunchModelSelect() != 2 {
		t.Errorf("expected launch model select 2, got %d", model.GetLaunchModelSelect())
	}
}
