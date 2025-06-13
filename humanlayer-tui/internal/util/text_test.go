package util

import (
	"strings"
	"testing"
)

func TestTruncate(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		max      int
		expected string
	}{
		{
			name:     "no truncation needed",
			input:    "hello",
			max:      10,
			expected: "hello",
		},
		{
			name:     "exact length",
			input:    "hello",
			max:      5,
			expected: "hello",
		},
		{
			name:     "truncate with ellipsis",
			input:    "hello world",
			max:      8,
			expected: "hello...",
		},
		{
			name:     "truncate very short",
			input:    "hello",
			max:      3,
			expected: "hel",
		},
		{
			name:     "truncate at boundary",
			input:    "hello",
			max:      4,
			expected: "h...",
		},
		{
			name:     "newlines replaced",
			input:    "hello\nworld",
			max:      20,
			expected: "hello world",
		},
		{
			name:     "tabs replaced",
			input:    "hello\tworld",
			max:      20,
			expected: "hello world",
		},
		{
			name:     "carriage returns replaced",
			input:    "hello\rworld",
			max:      20,
			expected: "hello world",
		},
		{
			name:     "mixed whitespace",
			input:    "hello\n\t\rworld",
			max:      20,
			expected: "hello   world",
		},
		{
			name:     "empty string",
			input:    "",
			max:      10,
			expected: "",
		},
		{
			name:     "zero max length",
			input:    "hello",
			max:      0,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Truncate(tt.input, tt.max)
			if got != tt.expected {
				t.Errorf("Truncate(%q, %d) = %q, want %q", tt.input, tt.max, got, tt.expected)
			}
		})
	}
}

func TestCenterText(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		width    int
		expected string
	}{
		{
			name:     "text shorter than width",
			text:     "hi",
			width:    6,
			expected: "  hi  ",
		},
		{
			name:     "odd padding",
			text:     "hi",
			width:    7,
			expected: "  hi   ",
		},
		{
			name:     "exact width",
			text:     "hello",
			width:    5,
			expected: "hello",
		},
		{
			name:     "text longer than width",
			text:     "hello world",
			width:    5,
			expected: "hello",
		},
		{
			name:     "empty string",
			text:     "",
			width:    4,
			expected: "    ",
		},
		{
			name:     "single character centered",
			text:     "x",
			width:    5,
			expected: "  x  ",
		},
		{
			name:     "unicode text",
			text:     "你好",
			width:    6,
			expected: "  你好  ",
		},
		{
			name:     "zero width",
			text:     "hello",
			width:    0,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CenterText(tt.text, tt.width)
			if got != tt.expected {
				t.Errorf("CenterText(%q, %d) = %q, want %q", tt.text, tt.width, got, tt.expected)
			}
		})
	}
}

func TestLeftPadText(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		width    int
		expected string
	}{
		{
			name:     "text shorter than width",
			text:     "hi",
			width:    5,
			expected: "hi   ",
		},
		{
			name:     "exact width",
			text:     "hello",
			width:    5,
			expected: "hello",
		},
		{
			name:     "text longer than width",
			text:     "hello world",
			width:    5,
			expected: "hello",
		},
		{
			name:     "empty string",
			text:     "",
			width:    3,
			expected: "   ",
		},
		{
			name:     "unicode text",
			text:     "你好",
			width:    5,
			expected: "你好   ",
		},
		{
			name:     "zero width",
			text:     "hello",
			width:    0,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := LeftPadText(tt.text, tt.width)
			if got != tt.expected {
				t.Errorf("LeftPadText(%q, %d) = %q, want %q", tt.text, tt.width, got, tt.expected)
			}
		})
	}
}

// Benchmark tests
func BenchmarkTruncate(b *testing.B) {
	longString := strings.Repeat("hello world ", 100)
	for i := 0; i < b.N; i++ {
		Truncate(longString, 50)
	}
}

func BenchmarkCenterText(b *testing.B) {
	for i := 0; i < b.N; i++ {
		CenterText("hello world", 50)
	}
}

func BenchmarkLeftPadText(b *testing.B) {
	for i := 0; i < b.N; i++ {
		LeftPadText("hello world", 50)
	}
}
