// Package util provides generic helper functions and utilities.
package util

import (
	"strings"
	"unicode/utf8"
)

// PreprocessError converts common API errors into user-friendly messages
func PreprocessError(errMsg string) string {
	// Handle "call already has a response" errors
	if strings.Contains(errMsg, "call already has a response") {
		// Extract just the key part of the error
		if strings.Contains(errMsg, "400 Bad Request") {
			return "Approval already responded to"
		}
		return "Call already has a response"
	}

	// Handle other common API errors
	if strings.Contains(errMsg, "409 Conflict") {
		return "Conflict: Resource already exists"
	}

	if strings.Contains(errMsg, "404 Not Found") {
		return "Resource not found"
	}

	if strings.Contains(errMsg, "500 Internal Server Error") {
		return "Server error occurred"
	}

	// Remove excessive technical details like stack traces
	if idx := strings.Index(errMsg, "\n"); idx > 0 {
		errMsg = errMsg[:idx]
	}

	return errMsg
}

// TruncateError intelligently truncates error messages for display
func TruncateError(err error, maxWidth int) string {
	if err == nil {
		return ""
	}

	// Convert error to string
	fullError := err.Error()

	// Preprocess the error first
	fullError = PreprocessError(fullError)

	// Handle "Error: " prefix
	const errorPrefix = "Error: "
	availableWidth := maxWidth
	if !strings.HasPrefix(fullError, errorPrefix) {
		fullError = errorPrefix + fullError
	}

	// Check if the full error fits
	if utf8.RuneCountInString(fullError) <= availableWidth {
		return fullError
	}

	// Need to truncate - account for the prefix length
	prefixLen := utf8.RuneCountInString(errorPrefix)
	messageWidth := availableWidth - prefixLen - 3 // -3 for "..."

	if messageWidth <= 0 {
		// Not enough space even for truncation
		runes := []rune(fullError)
		if len(runes) > availableWidth {
			return string(runes[:availableWidth])
		}
		return fullError
	}

	// Extract the message part (after "Error: ")
	message := fullError[len(errorPrefix):]

	// Try to find a good breaking point (word boundary)
	runes := []rune(message)
	if len(runes) > messageWidth {
		truncated := string(runes[:messageWidth])
		// Look for last space to break at word boundary
		if lastSpace := strings.LastIndex(truncated, " "); lastSpace > messageWidth/2 {
			truncated = truncated[:lastSpace]
		}
		return errorPrefix + truncated + "..."
	}

	return fullError
}
