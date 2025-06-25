package session

import (
	"strings"
	"unicode/utf8"
)

// CalculateSummary generates a summary from a query using the same logic as the WebUI
func CalculateSummary(query string) string {
	// Use strings.Fields to split on all whitespace and filter empty strings in one pass
	// Then join with single spaces to normalize whitespace
	cleaned := strings.Join(strings.Fields(query), " ")

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
