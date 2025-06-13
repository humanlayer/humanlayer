// Package util provides generic helper functions and utilities.
// This package contains pure functions for text manipulation,
// time formatting, error handling, and other common operations.
package util

import (
	"strings"
	"unicode/utf8"
)

// Truncate truncates a string to a maximum length, replacing newlines with spaces
func Truncate(s string, max int) string {
	// Replace newlines and other whitespace with spaces first
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\t", " ")

	if len(s) <= max {
		return s
	}
	if max > 3 {
		return s[:max-3] + "..."
	}
	return s[:max]
}

// CenterText centers text within a fixed width column
func CenterText(text string, width int) string {
	textLen := utf8.RuneCountInString(text)
	if textLen >= width {
		return text[:width]
	}
	leftPad := (width - textLen) / 2
	rightPad := width - textLen - leftPad
	return strings.Repeat(" ", leftPad) + text + strings.Repeat(" ", rightPad)
}

// LeftPadText left-aligns text within a fixed width column
func LeftPadText(text string, width int) string {
	textLen := utf8.RuneCountInString(text)
	if textLen >= width {
		return text[:width]
	}
	return text + strings.Repeat(" ", width-textLen)
}
