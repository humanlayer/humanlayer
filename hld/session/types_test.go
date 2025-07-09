package session

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReadToolResult(t *testing.T) {
	t.Run("ParseCompleteReadResult", func(t *testing.T) {
		// Test parsing a complete Read tool result
		resultJSON := `{
			"type": "file",
			"file": {
				"filePath": "src/main.go",
				"content": "package main\n\nfunc main() {\n\tprintln(\"Hello\")\n}",
				"numLines": 5,
				"startLine": 1,
				"totalLines": 5
			}
		}`

		var result ReadToolResult
		err := json.Unmarshal([]byte(resultJSON), &result)
		require.NoError(t, err)

		require.Equal(t, "file", result.Type)
		require.Equal(t, "src/main.go", result.File.FilePath)
		require.Equal(t, "package main\n\nfunc main() {\n\tprintln(\"Hello\")\n}", result.File.Content)
		require.Equal(t, 5, result.File.NumLines)
		require.Equal(t, 1, result.File.StartLine)
		require.Equal(t, 5, result.File.TotalLines)
	})

	t.Run("ParsePartialReadResult", func(t *testing.T) {
		// Test parsing a partial Read tool result
		resultJSON := `{
			"type": "file",
			"file": {
				"filePath": "large_file.txt",
				"content": "Line 100\nLine 101\nLine 102",
				"numLines": 3,
				"startLine": 100,
				"totalLines": 1000
			}
		}`

		var result ReadToolResult
		err := json.Unmarshal([]byte(resultJSON), &result)
		require.NoError(t, err)

		require.Equal(t, "file", result.Type)
		require.Equal(t, "large_file.txt", result.File.FilePath)
		require.Equal(t, "Line 100\nLine 101\nLine 102", result.File.Content)
		require.Equal(t, 3, result.File.NumLines)
		require.Equal(t, 100, result.File.StartLine)
		require.Equal(t, 1000, result.File.TotalLines)
		
		// Verify this is a partial read
		require.NotEqual(t, result.File.NumLines, result.File.TotalLines)
	})

	t.Run("ParseReadResultWithSpecialCharacters", func(t *testing.T) {
		// Test parsing with special characters in content
		resultJSON := `{
			"type": "file",
			"file": {
				"filePath": "path/with spaces/file.txt",
				"content": "Content with \"quotes\" and 'single quotes'\nAnd\ttabs\nAnd\\backslashes",
				"numLines": 3,
				"startLine": 1,
				"totalLines": 3
			}
		}`

		var result ReadToolResult
		err := json.Unmarshal([]byte(resultJSON), &result)
		require.NoError(t, err)

		require.Equal(t, "path/with spaces/file.txt", result.File.FilePath)
		require.Equal(t, "Content with \"quotes\" and 'single quotes'\nAnd\ttabs\nAnd\\backslashes", result.File.Content)
	})

	t.Run("IsFullContent", func(t *testing.T) {
		// Test identifying full vs partial content
		testCases := []struct {
			name     string
			numLines int
			total    int
			isFull   bool
		}{
			{"Full content", 100, 100, true},
			{"Partial content", 50, 100, false},
			{"Single line full", 1, 1, true},
			{"Empty file", 0, 0, true},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				result := ReadToolResult{
					File: struct {
						FilePath   string `json:"filePath"`
						Content    string `json:"content"`
						NumLines   int    `json:"numLines"`
						StartLine  int    `json:"startLine"`
						TotalLines int    `json:"totalLines"`
					}{
						NumLines:   tc.numLines,
						TotalLines: tc.total,
					},
				}
				
				isFull := result.File.NumLines == result.File.TotalLines
				require.Equal(t, tc.isFull, isFull)
			})
		}
	})

	t.Run("ParseInvalidJSON", func(t *testing.T) {
		// Test parsing invalid JSON
		invalidJSON := `{invalid json}`
		
		var result ReadToolResult
		err := json.Unmarshal([]byte(invalidJSON), &result)
		require.Error(t, err)
	})

	t.Run("ParseMissingFields", func(t *testing.T) {
		// Test parsing with missing fields (should use zero values)
		minimalJSON := `{
			"type": "file",
			"file": {
				"filePath": "test.txt",
				"content": "test"
			}
		}`

		var result ReadToolResult
		err := json.Unmarshal([]byte(minimalJSON), &result)
		require.NoError(t, err)

		require.Equal(t, "file", result.Type)
		require.Equal(t, "test.txt", result.File.FilePath)
		require.Equal(t, "test", result.File.Content)
		require.Equal(t, 0, result.File.NumLines)    // Zero value
		require.Equal(t, 0, result.File.StartLine)   // Zero value
		require.Equal(t, 0, result.File.TotalLines)  // Zero value
	})
}