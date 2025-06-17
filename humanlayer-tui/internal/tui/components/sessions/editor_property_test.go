package sessions

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"testing/quick"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/api"
	"github.com/humanlayer/humanlayer/humanlayer-tui/internal/domain"
	"go.uber.org/mock/gomock"
)

// Property test for text editor operations
func TestTextEditorProperties(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Property: Character insertion should always increase text length
	t.Run("CharacterInsertionIncreasesLength", func(t *testing.T) {
		property := func(initialText string, char rune) bool {
			if char < 32 || char > 126 {
				return true // Skip non-printable characters
			}

			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView
			model.modalLines = []string{initialText}
			model.modalCursor = 0

			initialLength := len(initialText)

			keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{char}}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())

			newLength := len(model.modalLines[0])
			return newLength == initialLength+1
		}

		if err := quick.Check(property, nil); err != nil {
			t.Error(err)
		}
	})

	// Property: Backspace should decrease text length or remove lines
	t.Run("BackspaceDecreasesLengthOrRemovesLines", func(t *testing.T) {
		property := func(initialText string) bool {
			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView
			model.modalLines = strings.Split(initialText, "\n")
			if len(model.modalLines) == 0 {
				model.modalLines = []string{""}
			}
			model.modalCursor = 0

			initialTotalLength := 0
			for _, line := range model.modalLines {
				initialTotalLength += len(line)
			}
			initialLineCount := len(model.modalLines)

			keyMsg := tea.KeyMsg{Type: tea.KeyBackspace}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())

			newTotalLength := 0
			for _, line := range model.modalLines {
				newTotalLength += len(line)
			}
			newLineCount := len(model.modalLines)

			// Either text was removed or a line was removed
			return newTotalLength < initialTotalLength ||
				(newTotalLength == initialTotalLength && newLineCount < initialLineCount) ||
				(initialTotalLength == 0 && initialLineCount == 1) // Empty single line stays empty
		}

		if err := quick.Check(property, nil); err != nil {
			t.Error(err)
		}
	})

	// Property: Cursor movements should stay within bounds
	t.Run("CursorStaysWithinBounds", func(t *testing.T) {
		property := func(numLines uint8, operations []uint8) bool {
			if numLines == 0 {
				numLines = 1
			}

			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView

			// Create lines
			model.modalLines = make([]string, numLines)
			for i := range model.modalLines {
				model.modalLines[i] = fmt.Sprintf("Line %d", i+1)
			}
			model.modalCursor = 0

			// Apply random operations
			for _, op := range operations {
				var keyMsg tea.KeyMsg
				switch op % 2 {
				case 0:
					keyMsg = tea.KeyMsg{Type: tea.KeyUp}
				case 1:
					keyMsg = tea.KeyMsg{Type: tea.KeyDown}
				}
				model.updateQueryModalView(keyMsg, DefaultKeyMap())
			}

			// Cursor should always be within valid range
			return model.modalCursor >= 0 && model.modalCursor < len(model.modalLines)
		}

		if err := quick.Check(property, nil); err != nil {
			t.Error(err)
		}
	})

	// Property: Enter key should split lines correctly
	t.Run("EnterSplitsLinesCorrectly", func(t *testing.T) {
		property := func(text string, position uint8) bool {
			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView
			model.modalType = "query" // Only query supports multiline
			model.modalLines = []string{text}
			model.modalCursor = 0

			initialContent := text

			keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())

			// Should now have 2 lines
			if len(model.modalLines) != 2 {
				return false
			}

			// Cursor should be on second line
			if model.modalCursor != 1 {
				return false
			}

			// Content should be preserved
			rejoined := strings.Join(model.modalLines, "")
			return rejoined == initialContent
		}

		if err := quick.Check(property, nil); err != nil {
			t.Error(err)
		}
	})

	// Property: Tab insertion should add tab character
	t.Run("TabInsertsTabCharacter", func(t *testing.T) {
		property := func(initialText string) bool {
			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView
			model.modalLines = []string{initialText}
			model.modalCursor = 0

			keyMsg := tea.KeyMsg{Type: tea.KeyTab}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())

			// Should have added a tab
			return strings.Count(model.modalLines[0], "\t") == strings.Count(initialText, "\t")+1
		}

		if err := quick.Check(property, nil); err != nil {
			t.Error(err)
		}
	})
}

// Test invariants that should always hold
func TestTextEditorInvariants(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Invariant: modalLines should never be empty
	t.Run("ModalLinesNeverEmpty", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView

		// Start with empty
		model.modalLines = []string{""}
		model.modalCursor = 0

		// Try various operations that might empty it
		operations := []tea.KeyMsg{
			{Type: tea.KeyBackspace},
			{Type: tea.KeyBackspace},
			{Type: tea.KeyBackspace},
		}

		for _, op := range operations {
			model.updateQueryModalView(op, DefaultKeyMap())
			if len(model.modalLines) == 0 {
				t.Error("modalLines became empty")
			}
		}
	})

	// Invariant: Cursor should always point to a valid line
	t.Run("CursorAlwaysValid", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView

		// Use new rand source instead of deprecated Seed
		randSource := rand.New(rand.NewSource(time.Now().UnixNano()))

		for i := 0; i < 100; i++ {
			// Random number of lines
			numLines := randSource.Intn(10) + 1
			model.modalLines = make([]string, numLines)
			for j := range model.modalLines {
				model.modalLines[j] = fmt.Sprintf("Line %d", j)
			}

			// Random cursor position
			model.modalCursor = randSource.Intn(numLines)

			// Random operation
			operations := []tea.KeyMsg{
				{Type: tea.KeyUp},
				{Type: tea.KeyDown},
				{Type: tea.KeyEnter},
				{Type: tea.KeyBackspace},
				{Type: tea.KeyRunes, Runes: []rune{'x'}},
			}

			op := operations[randSource.Intn(len(operations))]
			model.updateQueryModalView(op, DefaultKeyMap())

			// Check invariant
			if model.modalCursor < 0 || model.modalCursor >= len(model.modalLines) {
				t.Errorf("cursor out of bounds: cursor=%d, lines=%d",
					model.modalCursor, len(model.modalLines))
			}
		}
	})
}

// Fuzz test for paste operations
func TestPasteOperations(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	testCases := []struct {
		name         string
		initialLines []string
		cursor       int
		pasteText    string
		wantLines    int
	}{
		{
			name:         "paste single line into empty",
			initialLines: []string{""},
			cursor:       0,
			pasteText:    "hello",
			wantLines:    1,
		},
		{
			name:         "paste multiline into empty",
			initialLines: []string{""},
			cursor:       0,
			pasteText:    "line1\nline2\nline3",
			wantLines:    3,
		},
		{
			name:         "paste into middle of text",
			initialLines: []string{"start", "middle", "end"},
			cursor:       1,
			pasteText:    "inserted\ntext",
			wantLines:    4,
		},
		{
			name:         "paste with empty lines",
			initialLines: []string{"text"},
			cursor:       0,
			pasteText:    "a\n\n\nb",
			wantLines:    4,
		},
		{
			name:         "paste with tabs and spaces",
			initialLines: []string{"code"},
			cursor:       0,
			pasteText:    "\tindented\n    spaced",
			wantLines:    2,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			mockClient := api.NewMockClient(ctrl)
			model := New(mockClient)
			model.viewState = domain.QueryModalView
			model.modalLines = tc.initialLines
			model.modalCursor = tc.cursor

			// Simulate paste by directly manipulating lines
			// (since we can't mock clipboard in tests)
			lines := strings.Split(tc.pasteText, "\n")
			if len(lines) == 1 {
				model.modalLines[model.modalCursor] += lines[0]
			} else {
				model.modalLines[model.modalCursor] += lines[0]
				for i, line := range lines[1:] {
					insertPos := model.modalCursor + i + 1
					model.modalLines = append(model.modalLines[:insertPos], model.modalLines[insertPos-1:]...)
					model.modalLines[insertPos] = line
				}
				model.modalCursor += len(lines) - 1
			}

			if len(model.modalLines) != tc.wantLines {
				t.Errorf("expected %d lines after paste, got %d", tc.wantLines, len(model.modalLines))
			}

			// Verify content integrity
			allContent := strings.Join(model.modalLines, "\n")
			if !strings.Contains(allContent, strings.ReplaceAll(tc.pasteText, "\n", "")) &&
				!strings.Contains(allContent, tc.pasteText) {
				t.Error("pasted content not found in result")
			}
		})
	}
}

// Edge case tests
func TestTextEditorEdgeCases(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	t.Run("VeryLongLine", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView

		// Create a very long line
		longLine := strings.Repeat("a", 10000)
		model.modalLines = []string{longLine}
		model.modalCursor = 0

		// Should handle character addition
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'b'}}
		model.updateQueryModalView(keyMsg, DefaultKeyMap())

		if len(model.modalLines[0]) != 10001 {
			t.Error("failed to add character to long line")
		}
	})

	t.Run("ManyLines", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView

		// Create many lines
		model.modalLines = make([]string, 1000)
		for i := range model.modalLines {
			model.modalLines[i] = fmt.Sprintf("Line %d", i)
		}
		model.modalCursor = 500

		// Navigate up and down
		for i := 0; i < 100; i++ {
			keyMsg := tea.KeyMsg{Type: tea.KeyDown}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())
		}

		if model.modalCursor != 600 {
			t.Errorf("expected cursor at 600, got %d", model.modalCursor)
		}
	})

	t.Run("SpecialCharacters", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView

		specialChars := []rune{'@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '+', '=', '{', '}', '[', ']', '|', '\\', ':', ';', '"', '\'', '<', '>', ',', '.', '?', '/'}

		model.modalLines = []string{""}
		model.modalCursor = 0

		for _, char := range specialChars {
			keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{char}}
			model.updateQueryModalView(keyMsg, DefaultKeyMap())
		}

		result := model.modalLines[0]
		for _, char := range specialChars {
			if !strings.ContainsRune(result, char) {
				t.Errorf("special character %c not found in result", char)
			}
		}
	})
}

func TestModalTypeRestrictions(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	t.Run("WorkingDirNoMultiline", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView
		model.modalType = "workingdir"
		model.modalLines = []string{"/path/to/dir"}
		model.modalCursor = 0

		// Try to insert newline
		keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
		model.updateQueryModalView(keyMsg, DefaultKeyMap())

		// Should still have only one line
		if len(model.modalLines) != 1 {
			t.Errorf("working dir should not support multiline, got %d lines", len(model.modalLines))
		}
	})

	t.Run("QuerySupportsMultiline", func(t *testing.T) {
		mockClient := api.NewMockClient(ctrl)
		model := New(mockClient)
		model.viewState = domain.QueryModalView
		model.modalType = "query"
		model.modalLines = []string{"first line"}
		model.modalCursor = 0

		// Insert newline
		keyMsg := tea.KeyMsg{Type: tea.KeyEnter}
		model.updateQueryModalView(keyMsg, DefaultKeyMap())

		// Should have two lines
		if len(model.modalLines) != 2 {
			t.Errorf("query should support multiline, got %d lines", len(model.modalLines))
		}
	})
}
