package sessions

import (
	"strings"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

func TestView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	// Set a reasonable size to avoid viewport truncation
	model.UpdateSize(100, 50)

	tests := []struct {
		name      string
		viewState domain.ViewState
		setup     func()
		contains  []string
	}{
		{
			name:      "list view empty",
			viewState: domain.ListView,
			setup:     func() { model.sortedSessions = []session.Info{} },
			contains:  []string{"No sessions", "Press [l] to launch"},
		},
		{
			name:      "list view with sessions",
			viewState: domain.ListView,
			setup: func() {
				model.sortedSessions = []session.Info{
					{
						ID:             "1",
						Status:         "running",
						Query:          "Test query",
						Model:          "claude-3-opus",
						WorkingDir:     "/home/user",
						LastActivityAt: time.Now(),
						StartTime:      time.Now(),
					},
				}
			},
			contains: []string{"Status", "Modified", "Created", "Working Dir", "Model", "Turns", "Query", "🟢", "Test query"},
		},
		{
			name:      "session detail view",
			viewState: domain.SessionDetailView,
			setup: func() {
				model.selectedSession = &session.Info{
					ID:              "sess-123",
					ClaudeSessionID: "claude-456",
					RunID:           "run-789",
					Status:          "completed",
					Query:           "Test session query",
					Model:           "claude-3-opus",
					StartTime:       time.Now().Add(-1 * time.Hour),
					EndTime:         func() *time.Time { t := time.Now(); return &t }(),
				}
			},
			contains: []string{"Status:", "Session ID:", "Run ID:", "Model:", "Query:", "Test session query", "✅"},
		},
		{
			name:      "launch session view",
			viewState: domain.LaunchSessionView,
			setup: func() {
				model.launchActiveField = 0
			},
			contains: []string{"🚀 Launch New Claude Session", "Query:", "Model:", "Working Dir:", "Press Enter to edit"},
		},
		{
			name:      "query modal view",
			viewState: domain.QueryModalView,
			setup: func() {
				model.modalType = "query"
				model.modalLines = []string{"line 1", "line 2", "line 3"}
				model.modalCursor = 1
			},
			contains: []string{"✏️  Edit Query", "line 1", "line 2", "line 3", "[↑/↓] move cursor"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			model.viewState = tt.viewState
			tt.setup()

			output := model.View()

			for _, expected := range tt.contains {
				if !strings.Contains(output, expected) {
					t.Errorf("expected output to contain '%s', but it didn't\nOutput:\n%s", expected, output)
				}
			}
		})
	}
}

func TestRenderListView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	model.UpdateSize(100, 30)

	t.Run("empty list", func(t *testing.T) {
		model.sortedSessions = []session.Info{}
		output := model.renderListView()

		if !strings.Contains(output, "No sessions") {
			t.Error("expected 'No sessions' message")
		}
	})

	t.Run("list with multiple sessions", func(t *testing.T) {
		now := time.Now()
		model.sessions = []session.Info{
			{
				ID:             "1",
				Status:         "running",
				Query:          "First query",
				Model:          "claude-3-opus",
				WorkingDir:     "/home/user/project1",
				LastActivityAt: now.Add(-5 * time.Minute),
				StartTime:      now.Add(-1 * time.Hour),
				Result:         &claudecode.Result{NumTurns: 42},
			},
			{
				ID:             "2",
				Status:         "completed",
				Query:          "Second query with a very long description that should be truncated",
				Model:          "claude-3-sonnet",
				WorkingDir:     "/very/long/path/that/should/be/truncated/to/fit/in/column",
				LastActivityAt: now.Add(-2 * time.Hour),
				StartTime:      now.Add(-3 * time.Hour),
				Result:         &claudecode.Result{NumTurns: 1500},
			},
			{
				ID:             "3",
				Status:         "failed",
				Query:          "Failed query",
				Model:          "",
				WorkingDir:     "",
				LastActivityAt: now.Add(-1 * 24 * time.Hour),
				StartTime:      now.Add(-2 * 24 * time.Hour),
			},
		}
		model.updateSortedSessions()
		model.cursor = 1

		output := model.renderListView()

		// Check headers
		headers := []string{"Status", "Modified", "Created", "Working Dir", "Model", "Turns", "Query"}
		for _, header := range headers {
			if !strings.Contains(output, header) {
				t.Errorf("expected header '%s' in output", header)
			}
		}

		// Check status icons
		if !strings.Contains(output, "🟢") {
			t.Error("expected running status icon")
		}
		if !strings.Contains(output, "✅") {
			t.Error("expected completed status icon")
		}
		if !strings.Contains(output, "❌") {
			t.Error("expected failed status icon")
		}

		// Check relative times
		if !strings.Contains(output, "5m ago") {
			t.Error("expected relative time '5m ago'")
		}

		// Check model shortening
		if !strings.Contains(output, "opus") {
			t.Error("expected shortened model name 'opus'")
		}
		if !strings.Contains(output, "sonnet") {
			t.Error("expected shortened model name 'sonnet'")
		}

		// Check turn counts
		if !strings.Contains(output, "42") {
			t.Error("expected turn count '42'")
		}
		if !strings.Contains(output, "1.5k") {
			t.Error("expected turn count '1.5k'")
		}

		// Check truncated path
		if strings.Contains(output, "/very/long/path/that/should/be/truncated/to/fit/in/column") {
			t.Error("path should be truncated")
		}
		if !strings.Contains(output, "...") {
			t.Error("expected truncation indicator")
		}

		// Check parent session inheritance
		model.sessions = append(model.sessions, session.Info{
			ID:              "4",
			ParentSessionID: "1",
			Status:          "running",
			Query:           "Child session",
			// No WorkingDir or Model set - should inherit from parent
			LastActivityAt: now,
			StartTime:      now,
		})
		model.updateSortedSessions()

		output = model.renderListView()

		// First verify the child session appears in the output
		if !strings.Contains(output, "Child session") {
			t.Error("expected child session to appear in output")
		}

		// Count how many sessions appear in total
		sessionCount := 0
		for _, sess := range model.sortedSessions {
			if strings.Contains(output, sess.Query) {
				sessionCount++
			}
		}

		// Debug information
		t.Logf("Total sessions in model: %d", len(model.sortedSessions))
		t.Logf("Sessions found in output: %d", sessionCount)

		// Should show inherited values - child should show parent's working directory
		// Parent's path "/home/user/project1" (19 chars) will be truncated to last 15 chars
		// "...e/user/project1" (the last 15 chars of the original path with "..." prefix)
		truncatedPath := "...e/user/project1"
		pathCount := strings.Count(output, truncatedPath)
		if pathCount < 2 {
			t.Errorf("expected child session to inherit parent's working directory (truncated), count was %d (expected at least 2)\nOutput:\n%s",
				pathCount, output)
		}
	})
}

func TestRenderSessionDetailView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	model.UpdateSize(100, 30)

	t.Run("no session selected", func(t *testing.T) {
		model.selectedSession = nil
		output := model.renderSessionDetailView()

		if output != "No session selected" {
			t.Errorf("expected 'No session selected', got %s", output)
		}
	})

	t.Run("session with all details", func(t *testing.T) {
		// Set a larger height to avoid scrolling
		model.height = 100

		now := time.Now()
		endTime := now.Add(2 * time.Hour)

		model.selectedSession = &session.Info{
			ID:              "sess-123",
			ClaudeSessionID: "claude-456",
			RunID:           "run-789",
			Status:          "completed",
			Query:           "Multi-line\nquery\ntext",
			Model:           "claude-3-opus-20240229",
			WorkingDir:      "/home/user/project",
			StartTime:       now,
			EndTime:         &endTime,
			Error:           "",
			Result: &claudecode.Result{
				Result:    "The task was completed successfully",
				NumTurns:  25,
				TotalCost: 0.1234,
			},
		}

		model.sessionApprovals = []domain.Request{
			{
				ID:        "approval-1",
				Type:      domain.ApprovalRequest,
				Message:   "Request to execute function foo()",
				CreatedAt: now.Add(30 * time.Minute),
			},
			{
				ID:        "approval-2",
				Type:      domain.HumanContactRequest,
				Message:   "Need human input for decision",
				CreatedAt: now.Add(45 * time.Minute),
			},
		}

		output := model.renderSessionDetailView()

		// Check all expected fields
		expectedContents := []string{
			"Status:", "✅ completed",
			"Session ID:", "claude-456",
			"Run ID:", "run-789",
			"Model:", "claude-3-opus-20240229",
			"Started:", now.Format("15:04:05"),
			"Completed:", endTime.Format("15:04:05"),
			"Duration:", "2h0m",
			"Query:",
			"Multi-line",
			"query",
			"text",
			"Approvals:",
			"📋", "Request to execute function foo()",
			"💬", "Need human input for decision",
			"Result:",
			"The task was completed successfully",
			"Turns:", "25",
			"Cost:", "$0.1234",
		}

		for _, expected := range expectedContents {
			if !strings.Contains(output, expected) {
				t.Errorf("expected output to contain '%s', but it didn't\nOutput:\n%s", expected, output)
			}
		}
	})

	t.Run("session with error", func(t *testing.T) {
		model.selectedSession = &session.Info{
			ID:     "sess-error",
			Status: "failed",
			Error:  "Connection timeout",
		}

		output := model.renderSessionDetailView()

		if !strings.Contains(output, "Error:") {
			t.Error("expected 'Error:' label")
		}
		if !strings.Contains(output, "Connection timeout") {
			t.Error("expected error message")
		}
	})

	t.Run("scrolling behavior", func(t *testing.T) {
		// Create session with lots of content
		model.selectedSession = &session.Info{
			ID:    "sess-long",
			Query: strings.Repeat("Line\n", 100), // 100 lines
		}

		model.height = 20 // Small terminal
		model.sessionDetailScroll = 10

		output := model.renderSessionDetailView()

		// Should show scroll indicator
		if !strings.Contains(output, "Showing") && !strings.Contains(output, "lines") {
			t.Error("expected scroll indicator")
		}
	})
}

func TestRenderLaunchSessionView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)

	t.Run("empty form", func(t *testing.T) {
		model.launchActiveField = 0
		output := model.renderLaunchSessionView()

		if !strings.Contains(output, "🚀 Launch New Claude Session") {
			t.Error("expected launch header")
		}

		if !strings.Contains(output, "Press Enter to edit") {
			t.Error("expected query field hint")
		}

		if !strings.Contains(output, "Default") {
			t.Error("expected default model option")
		}
	})

	t.Run("form with content", func(t *testing.T) {
		model.savedQueryContent = "This is a test query\nwith multiple lines"
		model.launchWorkingDir.SetValue("/home/user/project")
		model.launchModelSelect = 1 // Opus
		model.launchActiveField = 1 // Model field

		output := model.renderLaunchSessionView()

		// Check query preview
		if !strings.Contains(output, "This is a test query") {
			t.Error("expected query preview")
		}

		// Check working directory
		if !strings.Contains(output, "/home/user/project") {
			t.Error("expected working directory")
		}

		// Check model selection
		if !strings.Contains(output, "Claude 4 Opus") {
			t.Error("expected model options")
		}

		// Check instructions
		if !strings.Contains(output, "[tab/j/k] navigate fields") {
			t.Error("expected navigation instructions")
		}
	})

	t.Run("long query preview", func(t *testing.T) {
		// Create query with more than 5 lines
		longQuery := strings.Join([]string{
			"Line 1",
			"Line 2",
			"Line 3",
			"Line 4",
			"Line 5",
			"Line 6",
			"Line 7",
		}, "\n")

		model.savedQueryContent = longQuery
		output := model.renderLaunchSessionView()

		// Should truncate to 5 lines plus ellipsis
		if !strings.Contains(output, "Line 5") {
			t.Error("expected line 5 in preview")
		}
		if strings.Contains(output, "Line 6") {
			t.Error("line 6 should not be in preview")
		}
		if !strings.Contains(output, "...") {
			t.Error("expected ellipsis for truncated preview")
		}
	})
}

func TestRenderQueryModalView(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockClient := api.NewMockClient(ctrl)
	model := New(mockClient)
	model.UpdateSize(80, 24)

	t.Run("query editor", func(t *testing.T) {
		model.modalType = "query"
		model.modalLines = []string{
			"First line of query",
			"Second line with more text",
			"Third line",
		}
		model.modalCursor = 1

		output := model.renderQueryModalView()

		// Check title
		if !strings.Contains(output, "✏️  Edit Query") {
			t.Error("expected query editor title")
		}

		// Check line numbers
		if !strings.Contains(output, " 1 ") {
			t.Error("expected line number 1")
		}
		if !strings.Contains(output, " 2 ") {
			t.Error("expected line number 2")
		}
		if !strings.Contains(output, " 3 ") {
			t.Error("expected line number 3")
		}

		// Check content
		if !strings.Contains(output, "First line of query") {
			t.Error("expected first line content")
		}

		// Check cursor indicator on line 2
		if !strings.Contains(output, "Second line with more text█") {
			t.Error("expected cursor indicator on line 2")
		}

		// Check instructions
		if !strings.Contains(output, "[enter] new line") {
			t.Error("expected enter instruction")
		}
		if !strings.Contains(output, "[ctrl+enter] save & launch") {
			t.Error("expected ctrl+enter instruction")
		}
	})

	t.Run("working directory editor", func(t *testing.T) {
		model.modalType = "workingdir"
		model.modalLines = []string{"/home/user/project"}
		model.modalCursor = 0

		output := model.renderQueryModalView()

		// Check title
		if !strings.Contains(output, "📁  Edit Working Directory") {
			t.Error("expected working directory editor title")
		}

		// Check content
		if !strings.Contains(output, "/home/user/project") {
			t.Error("expected working directory content")
		}
	})
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		duration time.Duration
		expected string
	}{
		{30 * time.Second, "30s"},
		{90 * time.Second, "1m30s"},
		{3600 * time.Second, "1h0m"},
		{3665 * time.Second, "1h1m"},
		{7320 * time.Second, "2h2m"},
	}

	for _, tt := range tests {
		result := formatDuration(tt.duration)
		if result != tt.expected {
			t.Errorf("formatDuration(%v) = %s, expected %s", tt.duration, result, tt.expected)
		}
	}
}

func TestFormatRelativeTime(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name     string
		time     time.Time
		expected string
	}{
		{"just now", now.Add(-30 * time.Second), "now"},
		{"minutes ago", now.Add(-5 * time.Minute), "5m ago"},
		{"hours ago", now.Add(-2 * time.Hour), "2h ago"},
		{"days ago", now.Add(-3 * 24 * time.Hour), "3d ago"},
		{"old date", now.Add(-30 * 24 * time.Hour), now.Add(-30 * 24 * time.Hour).Format("Jan 2")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Note: This function is defined in update.go
			result := formatRelativeTime(tt.time)
			if result != tt.expected {
				t.Errorf("formatRelativeTime(%v) = %s, expected %s", tt.time, result, tt.expected)
			}
		})
	}
}
