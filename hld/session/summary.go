package session

import (
	"strings"
	"unicode/utf8"
)

// CalculateSummary generates a summary from a query using the same logic as the WebUI
func CalculateSummary(query string) string {
	// Replace whitespace with single spaces and trim
	cleaned := strings.ReplaceAll(query, "\n", " ")
	cleaned = strings.ReplaceAll(cleaned, "\r", " ")
	cleaned = strings.ReplaceAll(cleaned, "\t", " ")

	// Collapse multiple spaces into single spaces
	for strings.Contains(cleaned, "  ") {
		cleaned = strings.ReplaceAll(cleaned, "  ", " ")
	}

	cleaned = strings.TrimSpace(cleaned)

	const maxLength = 50
	// Use rune count for proper Unicode handling
	if utf8.RuneCountInString(cleaned) <= maxLength {
		return cleaned
	}

	// Truncate by runes to avoid breaking Unicode characters
	runes := []rune(cleaned)
	truncated := string(runes[:maxLength-3])
	return truncated + "..."
}
