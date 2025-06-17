package sessions

import (
	"errors"
	"strings"
	"testing"

	"github.com/atotto/clipboard"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestUpdateListView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	model.viewState = domain.ListView
	keys := DefaultKeyMap()

	// Add some test sessions
	model.sessions = []session.Info{
		{ID: "1", Status: "running"},
		{ID: "2", Status: "completed"},
		{ID: "3", Status: "failed"},
	}
	model.updateSortedSessions()

	tests := []struct {
		name               string
		key                tea.KeyMsg
		initialCursor      int
		expectedCursor     int
		expectRefresh      bool
		expectConversation bool
		expectViewChange   bool
	}{
		{
			name:           "move cursor down",
			key:            tea.KeyMsg{Type: tea.KeyDown},
			initialCursor:  0,
			expectedCursor: 1,
		},
		{
			name:           "move cursor up",
			key:            tea.KeyMsg{Type: tea.KeyUp},
			initialCursor:  1,
			expectedCursor: 0,
		},
		{
			name:           "move cursor down at bottom",
			key:            tea.KeyMsg{Type: tea.KeyDown},
			initialCursor:  2,
			expectedCursor: 2, // stays at bottom
		},
		{
			name:           "move cursor up at top",
			key:            tea.KeyMsg{Type: tea.KeyUp},
			initialCursor:  0,
			expectedCursor: 0, // stays at top
		},
		{
			name:               "enter opens conversation",
			key:                tea.KeyMsg{Type: tea.KeyEnter},
			initialCursor:      1,
			expectConversation: true,
		},
		{
			name:             "launch key opens launch view",
			key:              tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}},
			expectViewChange: true,
		},
		{
			name:          "refresh key",
			key:           tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}},
			expectRefresh: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.cursor = tt.initialCursor
			model.viewState = domain.ListView

			if tt.expectRefresh {
				mockClient.EXPECT().FetchSessions().Return(func() tea.Msg {
					return domain.FetchSessionsMsg{}
				})
			}

			result := model.updateListView(tt.key, keys)

			if tt.expectConversation {
				if !result.OpenConversation {
					t.Error("expected OpenConversation to be true")
				}
				if result.OpenConversationID != model.sortedSessions[tt.initialCursor].ID {
					t.Errorf("expected conversation ID %s, got %s",
						model.sortedSessions[tt.initialCursor].ID,
						result.OpenConversationID)
				}
			}

			if tt.expectViewChange {
				if model.viewState != domain.LaunchSessionView {
					t.Errorf("expected view state to be LaunchSessionView, got %v", model.viewState)
				}
			}

			if !tt.expectConversation && !tt.expectViewChange && !tt.expectRefresh {
				if model.cursor != tt.expectedCursor {
					t.Errorf("expected cursor %d, got %d", tt.expectedCursor, model.cursor)
				}
			}

			if tt.expectRefresh && result.Cmd == nil {
				t.Error("expected refresh command")
			}
		})
	}
}

func TestUpdateModalEditor(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	keys := DefaultKeyMap()

	tests := []struct {
		name             string
		key              string
		initialLines     []string
		initialCursor    int
		expectedLines    []string
		expectedCursor   int
		modalType        string
		expectViewChange bool
	}{
		{
			name:           "type character",
			key:            "a",
			initialLines:   []string{"hello"},
			initialCursor:  0,
			expectedLines:  []string{"helloa"},
			expectedCursor: 0,
		},
		{
			name:           "insert newline",
			key:            "enter",
			initialLines:   []string{"hello world"},
			initialCursor:  0,
			expectedLines:  []string{"hello world", ""},
			expectedCursor: 1,
			modalType:      "query", // only query supports multiline
		},
		{
			name:           "backspace character",
			key:            "backspace",
			initialLines:   []string{"hello"},
			initialCursor:  0,
			expectedLines:  []string{"hell"},
			expectedCursor: 0,
		},
		{
			name:           "backspace empty line",
			key:            "backspace",
			initialLines:   []string{"hello", ""},
			initialCursor:  1,
			expectedLines:  []string{"hello"},
			expectedCursor: 0,
		},
		{
			name:           "move cursor up",
			key:            "up",
			initialLines:   []string{"line1", "line2"},
			initialCursor:  1,
			expectedLines:  []string{"line1", "line2"},
			expectedCursor: 0,
		},
		{
			name:           "move cursor down",
			key:            "down",
			initialLines:   []string{"line1", "line2"},
			initialCursor:  0,
			expectedLines:  []string{"line1", "line2"},
			expectedCursor: 1,
		},
		{
			name:           "insert tab",
			key:            "tab",
			initialLines:   []string{"hello"},
			initialCursor:  0,
			expectedLines:  []string{"hello\t"},
			expectedCursor: 0,
		},
		{
			name:             "escape saves and exits",
			key:              "esc",
			initialLines:     []string{"saved content"},
			initialCursor:    0,
			expectedLines:    []string{"saved content"},
			expectedCursor:   0,
			expectViewChange: true,
			modalType:        "query",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.modalLines = tt.initialLines
			model.modalCursor = tt.initialCursor
			model.modalType = tt.modalType
			if model.modalType == "" {
				model.modalType = "query"
			}
			model.viewState = domain.QueryModalView

			keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(tt.key)}
			switch tt.key {
			case "enter":
				keyMsg = tea.KeyMsg{Type: tea.KeyEnter}
			case "backspace":
				keyMsg = tea.KeyMsg{Type: tea.KeyBackspace}
			case "up":
				keyMsg = tea.KeyMsg{Type: tea.KeyUp}
			case "down":
				keyMsg = tea.KeyMsg{Type: tea.KeyDown}
			case "tab":
				keyMsg = tea.KeyMsg{Type: tea.KeyTab}
			case "esc":
				keyMsg = tea.KeyMsg{Type: tea.KeyEsc}
			}

			result := model.updateQueryModalView(keyMsg, keys)

			if !tt.expectViewChange {
				if !equalStringSlices(model.modalLines, tt.expectedLines) {
					t.Errorf("expected lines %v, got %v", tt.expectedLines, model.modalLines)
				}

				if model.modalCursor != tt.expectedCursor {
					t.Errorf("expected cursor %d, got %d", tt.expectedCursor, model.modalCursor)
				}
			} else {
				if model.viewState != domain.LaunchSessionView {
					t.Errorf("expected view state LaunchSessionView, got %v", model.viewState)
				}

				// Check that content was saved
				if tt.modalType == "query" && model.savedQueryContent != strings.Join(tt.initialLines, "\n") {
					t.Errorf("expected saved content '%s', got '%s'",
						strings.Join(tt.initialLines, "\n"),
						model.savedQueryContent)
				}
			}

			_ = result // result checked in other tests
		})
	}
}

func TestClipboardPaste(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	keys := DefaultKeyMap()

	tests := []struct {
		name           string
		clipboardText  string
		initialLines   []string
		initialCursor  int
		expectedLines  []string
		expectedCursor int
		skipTest       bool // Skip if clipboard not available
	}{
		{
			name:           "paste single line",
			clipboardText:  "pasted",
			initialLines:   []string{"hello "},
			initialCursor:  0,
			expectedLines:  []string{"hello pasted"},
			expectedCursor: 0,
		},
		{
			name:           "paste multiple lines",
			clipboardText:  "line1\nline2\nline3",
			initialLines:   []string{"start"},
			initialCursor:  0,
			expectedLines:  []string{"startline1", "line2", "line3"},
			expectedCursor: 2,
		},
		{
			name:           "paste into middle of text",
			clipboardText:  "inserted",
			initialLines:   []string{"hello world"},
			initialCursor:  0,
			expectedLines:  []string{"hello worldinserted"},
			expectedCursor: 0,
		},
	}

	// Check if clipboard is available
	err := clipboard.WriteAll("test")
	clipboardAvailable := err == nil

	for _, tt := range tests {
		if !clipboardAvailable && !tt.skipTest {
			t.Skip("clipboard not available on this system")
		}

		t.Run(tt.name, func(t *testing.T) {
			// Set up clipboard
			if err := clipboard.WriteAll(tt.clipboardText); err != nil {
				t.Skipf("failed to write to clipboard: %v", err)
			}

			model.modalLines = tt.initialLines
			model.modalCursor = tt.initialCursor
			model.viewState = domain.QueryModalView

			keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("ctrl+v")}
			result := model.updateQueryModalView(keyMsg, keys)

			if !equalStringSlices(model.modalLines, tt.expectedLines) {
				t.Errorf("expected lines %v, got %v", tt.expectedLines, model.modalLines)
			}

			if model.modalCursor != tt.expectedCursor {
				t.Errorf("expected cursor %d, got %d", tt.expectedCursor, model.modalCursor)
			}

			_ = result
		})
	}
}

func TestFormValidation(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	keys := DefaultKeyMap()

	tests := []struct {
		name              string
		modalType         string
		initialLines      []string
		expectSave        bool
		expectLaunch      bool
		savedQueryContent string
	}{
		{
			name:         "working directory validation - valid path",
			modalType:    "workingdir",
			initialLines: []string{"/tmp"},
			expectSave:   true,
		},
		{
			name:         "working directory validation - invalid path",
			modalType:    "workingdir",
			initialLines: []string{"/nonexistent/path/that/does/not/exist"},
			expectSave:   false,
		},
		{
			name:              "launch with query content",
			modalType:         "query",
			initialLines:      []string{"test query"},
			savedQueryContent: "test query",
			expectLaunch:      true,
		},
		{
			name:         "launch without query content",
			modalType:    "query",
			initialLines: []string{""},
			expectLaunch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset form fields to ensure clean state
			model.launchWorkingDir.Reset()
			model.savedQueryContent = ""

			model.modalType = tt.modalType
			model.modalLines = tt.initialLines
			model.savedQueryContent = tt.savedQueryContent
			model.viewState = domain.QueryModalView

			if tt.expectLaunch {
				mockClient.EXPECT().LaunchSession(gomock.Any(), gomock.Any(), gomock.Any()).Return(
					func() tea.Msg {
						return domain.LaunchSessionMsg{}
					},
				)
			}

			// Test escape (save and return)
			keyMsg := tea.KeyMsg{Type: tea.KeyEsc}
			result := model.updateQueryModalView(keyMsg, keys)

			switch tt.modalType {
			case "workingdir":
				if tt.expectSave {
					expectedValue := strings.TrimSpace(strings.Join(tt.initialLines, "\n"))
					if model.launchWorkingDir.Value() != expectedValue {
						t.Errorf("expected working dir to be saved as '%s', got '%s'",
							expectedValue, model.launchWorkingDir.Value())
					}
					// Should return to launch view
					if model.viewState != domain.LaunchSessionView {
						t.Errorf("expected view state to be LaunchSessionView, got %v", model.viewState)
					}
				} else {
					if model.launchWorkingDir.Value() != "" {
						t.Error("expected working dir not to be saved for invalid path")
					}
					// Should still be in modal view for invalid path
					if model.viewState != domain.QueryModalView {
						t.Errorf("expected view state to remain QueryModalView for invalid path, got %v", model.viewState)
					}
				}
			case "query":
				// Query should always save and return to launch view
				if model.viewState != domain.LaunchSessionView {
					t.Errorf("expected view state to be LaunchSessionView, got %v", model.viewState)
				}
			}

			// Test ctrl+enter (save and launch)
			model.modalLines = tt.initialLines
			model.viewState = domain.QueryModalView

			keyMsg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("ctrl+enter")}
			result = model.updateQueryModalView(keyMsg, keys)

			if tt.expectLaunch && result.Cmd == nil {
				t.Error("expected launch command")
			} else if !tt.expectLaunch && result.Cmd != nil {
				t.Error("expected no launch command")
			}
		})
	}
}

func TestUpdateWithMessages(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	keys := DefaultKeyMap()

	t.Run("FetchSessionsMsg success", func(t *testing.T) {
		sessions := []session.Info{
			{ID: "1", Status: "running"},
			{ID: "2", Status: "starting"},
			{ID: "3", Status: "completed"},
		}

		msg := domain.FetchSessionsMsg{
			Sessions: sessions,
		}

		result := model.Update(msg, keys)

		if result.Err != nil {
			t.Errorf("unexpected error: %v", result.Err)
		}

		if len(model.sessions) != 3 {
			t.Errorf("expected 3 sessions, got %d", len(model.sessions))
		}

		if result.ActiveSessionCount != 2 {
			t.Errorf("expected 2 active sessions, got %d", result.ActiveSessionCount)
		}
	})

	t.Run("FetchSessionsMsg error", func(t *testing.T) {
		expectedErr := errors.New("network error")
		msg := domain.FetchSessionsMsg{
			Err: expectedErr,
		}

		result := model.Update(msg, keys)

		if result.Err != expectedErr {
			t.Errorf("expected error %v, got %v", expectedErr, result.Err)
		}
	})

	t.Run("LaunchSessionMsg success", func(t *testing.T) {
		msg := domain.LaunchSessionMsg{
			SessionID: "new-session",
			RunID:     "new-run",
		}

		// Set up some initial state
		model.launchQueryInput.SetValue("test query")
		model.launchWorkingDir.SetValue("/tmp")
		model.viewState = domain.LaunchSessionView

		mockClient.EXPECT().FetchSessions().Return(func() tea.Msg {
			return domain.FetchSessionsMsg{}
		})

		result := model.Update(msg, keys)

		if result.Err != nil {
			t.Errorf("unexpected error: %v", result.Err)
		}

		// Check form was cleared
		if model.launchQueryInput.Value() != "" {
			t.Error("expected query input to be cleared")
		}

		if model.launchWorkingDir.Value() != "" {
			t.Error("expected working dir input to be cleared")
		}

		if model.viewState != domain.ListView {
			t.Errorf("expected view state to be ListView, got %v", model.viewState)
		}

		if result.Cmd == nil {
			t.Error("expected refresh command")
		}
	})

	t.Run("FetchSessionApprovalsMsg", func(t *testing.T) {
		approvals := []domain.Request{
			{ID: "1", Type: domain.ApprovalRequest},
			{ID: "2", Type: domain.HumanContactRequest},
		}

		msg := domain.FetchSessionApprovalsMsg{
			Approvals: approvals,
		}

		result := model.Update(msg, keys)

		if result.Err != nil {
			t.Errorf("unexpected error: %v", result.Err)
		}

		if len(model.sessionApprovals) != 2 {
			t.Errorf("expected 2 approvals, got %d", len(model.sessionApprovals))
		}
	})
}

func TestModalStateTransitions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	keys := DefaultKeyMap()

	// Test transition from launch view to modal editor
	model.viewState = domain.LaunchSessionView
	model.launchActiveField = 0 // Query field

	enterKey := tea.KeyMsg{Type: tea.KeyEnter}
	result := model.updateLaunchSessionView(enterKey, keys)

	if model.viewState != domain.QueryModalView {
		t.Errorf("expected QueryModalView, got %v", model.viewState)
	}

	if model.modalType != "query" {
		t.Errorf("expected modal type 'query', got %s", model.modalType)
	}

	if !result.TriggerSizeUpdate {
		t.Error("expected TriggerSizeUpdate to be true")
	}

	// Test transition back to launch view
	escKey := tea.KeyMsg{Type: tea.KeyEsc}
	result = model.updateQueryModalView(escKey, keys)

	if model.viewState != domain.LaunchSessionView {
		t.Errorf("expected LaunchSessionView, got %v", model.viewState)
	}

	// Test working directory field modal
	model.launchActiveField = 2 // Working dir field
	result = model.updateLaunchSessionView(enterKey, keys)

	if model.viewState != domain.QueryModalView {
		t.Errorf("expected QueryModalView, got %v", model.viewState)
	}

	if model.modalType != "workingdir" {
		t.Errorf("expected modal type 'workingdir', got %s", model.modalType)
	}
}

// Helper function to compare string slices
func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
