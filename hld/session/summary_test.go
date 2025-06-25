package session

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCalculateSummary(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		expected string
	}{
		// Basic cases
		{
			name:     "short query",
			query:    "Hello world",
			expected: "Hello world",
		},
		{
			name:     "exact 50 chars",
			query:    strings.Repeat("a", 50),
			expected: strings.Repeat("a", 50),
		},
		{
			name:     "51 chars gets truncated",
			query:    strings.Repeat("a", 51),
			expected: strings.Repeat("a", 47) + "...",
		},
		{
			name:     "long query",
			query:    strings.Repeat("a", 100),
			expected: strings.Repeat("a", 47) + "...",
		},

		// Whitespace normalization
		{
			name:     "multiline query",
			query:    "Line 1\nLine 2\nLine 3",
			expected: "Line 1 Line 2 Line 3",
		},
		{
			name:     "tabs and spaces",
			query:    "Hello\t\tworld\n\ntest",
			expected: "Hello world test",
		},
		{
			name:     "carriage returns",
			query:    "Hello\rworld\r\ntest",
			expected: "Hello world test",
		},
		{
			name:     "multiple spaces collapsed",
			query:    "Hello     world    test",
			expected: "Hello world test",
		},
		{
			name:     "leading and trailing whitespace",
			query:    "  \n\t  Hello world  \t\n  ",
			expected: "Hello world",
		},

		// Edge cases
		{
			name:     "empty query",
			query:    "",
			expected: "",
		},
		{
			name:     "whitespace only",
			query:    "   \n\t  ",
			expected: "",
		},
		{
			name:     "single character",
			query:    "a",
			expected: "a",
		},
		{
			name:     "unicode characters",
			query:    "Hello 世界 🌍",
			expected: "Hello 世界 🌍",
		},
		{
			name:     "unicode truncation",
			query:    "Hello " + strings.Repeat("世", 50),
			expected: "Hello " + strings.Repeat("世", 41) + "...",
		},

		// Real-world examples
		{
			name:     "typical user query",
			query:    "Help me implement a REST API endpoint for user authentication",
			expected: "Help me implement a REST API endpoint for user ...",
		},
		{
			name:     "query with code snippet",
			query:    "Fix this error:\n```\nTypeError: Cannot read property 'map' of undefined\n```",
			expected: "Fix this error: ``` TypeError: Cannot read prop...",
		},
		{
			name:     "multi-paragraph query",
			query:    "I need help with:\n\n1. Setting up Docker\n2. Creating a compose file\n3. Deploying to production",
			expected: "I need help with: 1. Setting up Docker 2. Creat...",
		},

		// Boundary conditions
		{
			name:     "49 chars no truncation",
			query:    strings.Repeat("a", 49),
			expected: strings.Repeat("a", 49),
		},
		{
			name:     "whitespace at truncation boundary",
			query:    strings.Repeat("a", 45) + "     " + strings.Repeat("b", 10),
			expected: strings.Repeat("a", 45) + " " + "b...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CalculateSummary(tt.query)
			if got != tt.expected {
				t.Errorf("CalculateSummary() = %q (len=%d), want %q (len=%d)",
					got, len(got), tt.expected, len(tt.expected))
			}

			// Verify rune length constraint (not byte length)
			if utf8.RuneCountInString(got) > 50 {
				t.Errorf("Summary rune count %d exceeds maximum of 50", utf8.RuneCountInString(got))
			}
		})
	}
}

func TestCalculateSummaryWhitespaceNormalization(t *testing.T) {
	// Test that all types of whitespace are properly normalized
	whitespaceChars := []string{
		"\n",   // newline
		"\r",   // carriage return
		"\t",   // tab
		"\r\n", // Windows line ending
		"  ",   // multiple spaces
	}

	for _, ws := range whitespaceChars {
		query := "Hello" + ws + "world"
		got := CalculateSummary(query)
		expected := "Hello world"

		if got != expected {
			t.Errorf("Whitespace normalization failed for %q: got %q, want %q",
				query, got, expected)
		}
	}
}

func TestCalculateSummaryConsistency(t *testing.T) {
	// Test that the function is consistent (same input -> same output)
	query := "This is a test query that should produce consistent results"

	results := make([]string, 10)
	for i := 0; i < 10; i++ {
		results[i] = CalculateSummary(query)
	}

	// All results should be identical
	for i := 1; i < len(results); i++ {
		if results[i] != results[0] {
			t.Errorf("Inconsistent results: run %d returned %q, but run 0 returned %q",
				i, results[i], results[0])
		}
	}
}

func TestCalculateSummaryPerformance(t *testing.T) {
	// Test with very long input to ensure reasonable performance
	veryLongQuery := strings.Repeat("This is a very long query. ", 1000)

	// This should complete quickly despite the long input
	result := CalculateSummary(veryLongQuery)

	if utf8.RuneCountInString(result) != 50 {
		t.Errorf("Expected summary rune count of 50, got %d", utf8.RuneCountInString(result))
	}

	if !strings.HasSuffix(result, "...") {
		t.Errorf("Expected summary to end with '...', got %q", result)
	}
}
