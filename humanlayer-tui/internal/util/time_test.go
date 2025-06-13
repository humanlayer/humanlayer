package util

import (
	"testing"
	"time"
)

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		expected string
	}{
		{
			name:     "seconds only",
			duration: 45 * time.Second,
			expected: "45s",
		},
		{
			name:     "exactly one minute",
			duration: 60 * time.Second,
			expected: "1m0s",
		},
		{
			name:     "minutes and seconds",
			duration: 90 * time.Second,
			expected: "1m30s",
		},
		{
			name:     "exactly one hour",
			duration: 3600 * time.Second,
			expected: "1h0m",
		},
		{
			name:     "hours and minutes",
			duration: 3750 * time.Second,
			expected: "1h2m",
		},
		{
			name:     "long duration",
			duration: 25*time.Hour + 30*time.Minute,
			expected: "25h30m",
		},
		{
			name:     "zero duration",
			duration: 0,
			expected: "0s",
		},
		{
			name:     "sub-second duration",
			duration: 500 * time.Millisecond,
			expected: "0s",
		},
		{
			name:     "59 seconds",
			duration: 59 * time.Second,
			expected: "59s",
		},
		{
			name:     "59 minutes 59 seconds",
			duration: 59*time.Minute + 59*time.Second,
			expected: "59m59s",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatDuration(tt.duration)
			if got != tt.expected {
				t.Errorf("FormatDuration(%v) = %q, want %q", tt.duration, got, tt.expected)
			}
		})
	}
}

func TestFormatRelativeTime(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name     string
		time     time.Time
		expected string
	}{
		{
			name:     "just now",
			time:     now.Add(-30 * time.Second),
			expected: "just now",
		},
		{
			name:     "2 minutes ago",
			time:     now.Add(-2 * time.Minute),
			expected: "2m ago",
		},
		{
			name:     "59 minutes ago",
			time:     now.Add(-59 * time.Minute),
			expected: "59m ago",
		},
		{
			name:     "1 hour ago",
			time:     now.Add(-1 * time.Hour),
			expected: "1h ago",
		},
		{
			name:     "23 hours ago",
			time:     now.Add(-23 * time.Hour),
			expected: "23h ago",
		},
		{
			name:     "future time",
			time:     now.Add(1 * time.Hour),
			expected: "future",
		},
		{
			name:     "zero seconds ago",
			time:     now,
			expected: "just now",
		},
		{
			name:     "exactly 1 minute ago",
			time:     now.Add(-60 * time.Second),
			expected: "1m ago",
		},
		{
			name:     "exactly 24 hours ago",
			time:     now.Add(-24 * time.Hour),
			expected: now.Add(-24 * time.Hour).Format("Jan 2"),
		},
		{
			name:     "several days ago",
			time:     now.Add(-72 * time.Hour),
			expected: now.Add(-72 * time.Hour).Format("Jan 2"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatRelativeTime(tt.time)
			if got != tt.expected {
				t.Errorf("FormatRelativeTime(%v) = %q, want %q", tt.time, got, tt.expected)
			}
		})
	}
}

// Test edge cases for date formatting
func TestFormatRelativeTime_DateFormatting(t *testing.T) {
	// Test specific dates to ensure correct formatting
	testDate := time.Date(2024, time.January, 5, 10, 0, 0, 0, time.UTC)
	expected := "Jan 5"

	got := FormatRelativeTime(testDate)
	if got != expected {
		t.Errorf("FormatRelativeTime for old date = %q, want %q", got, expected)
	}

	// Test December date
	testDate = time.Date(2024, time.December, 25, 10, 0, 0, 0, time.UTC)
	expected = "Dec 25"

	got = FormatRelativeTime(testDate)
	if got != expected {
		t.Errorf("FormatRelativeTime for December date = %q, want %q", got, expected)
	}
}

// Benchmark tests
func BenchmarkFormatDuration(b *testing.B) {
	d := 3750 * time.Second
	for i := 0; i < b.N; i++ {
		FormatDuration(d)
	}
}

func BenchmarkFormatRelativeTime(b *testing.B) {
	t := time.Now().Add(-2 * time.Hour)
	for i := 0; i < b.N; i++ {
		FormatRelativeTime(t)
	}
}
