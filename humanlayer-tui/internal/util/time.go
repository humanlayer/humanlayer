// Package util provides generic helper functions and utilities.
package util

import (
	"fmt"
	"time"
)

// FormatDuration formats a duration in a human-readable way
func FormatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	} else if d < time.Hour {
		return fmt.Sprintf("%dm%ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh%dm", int(d.Hours()), int(d.Minutes())%60)
}

// FormatRelativeTime formats a timestamp as relative time (e.g., "2m ago")
func FormatRelativeTime(t time.Time) string {
	now := time.Now()
	if t.After(now) {
		return "future" // Shouldn't happen, but handle gracefully
	}

	diff := now.Sub(t)
	if diff < time.Minute {
		return "just now"
	} else if diff < time.Hour {
		return fmt.Sprintf("%dm ago", int(diff.Minutes()))
	} else if diff < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(diff.Hours()))
	}
	// For older items, show the date
	return t.Format("Jan 2")
}
