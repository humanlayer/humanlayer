package util

import (
	"errors"
	"strings"
	"testing"
)

func TestPreprocessError(t *testing.T) {
	tests := []struct {
		name     string
		errMsg   string
		expected string
	}{
		{
			name:     "call already has response with 400",
			errMsg:   "400 Bad Request: call already has a response",
			expected: "Approval already responded to",
		},
		{
			name:     "call already has response generic",
			errMsg:   "call already has a response",
			expected: "Call already has a response",
		},
		{
			name:     "409 conflict",
			errMsg:   "409 Conflict: resource exists",
			expected: "Conflict: Resource already exists",
		},
		{
			name:     "404 not found",
			errMsg:   "404 Not Found: resource not found",
			expected: "Resource not found",
		},
		{
			name:     "500 server error",
			errMsg:   "500 Internal Server Error: something went wrong",
			expected: "Server error occurred",
		},
		{
			name:     "error with newline",
			errMsg:   "Error occurred\nStack trace: ...",
			expected: "Error occurred",
		},
		{
			name:     "regular error message",
			errMsg:   "Something went wrong",
			expected: "Something went wrong",
		},
		{
			name:     "empty error",
			errMsg:   "",
			expected: "",
		},
		{
			name:     "multiline error with stack trace",
			errMsg:   "Error: failed to connect\n\tat main.go:123\n\tat foo.go:456",
			expected: "Error: failed to connect",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := PreprocessError(tt.errMsg)
			if got != tt.expected {
				t.Errorf("PreprocessError(%q) = %q, want %q", tt.errMsg, got, tt.expected)
			}
		})
	}
}

func TestTruncateError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		maxWidth int
		expected string
	}{
		{
			name:     "nil error",
			err:      nil,
			maxWidth: 50,
			expected: "",
		},
		{
			name:     "short error fits",
			err:      errors.New("file not found"),
			maxWidth: 50,
			expected: "Error: file not found",
		},
		{
			name:     "error needs truncation",
			err:      errors.New("this is a very long error message that needs to be truncated"),
			maxWidth: 30,
			expected: "Error: this is a very long...",
		},
		{
			name:     "error already has prefix",
			err:      errors.New("Error: file not found"),
			maxWidth: 50,
			expected: "Error: file not found",
		},
		{
			name:     "very small max width",
			err:      errors.New("error"),
			maxWidth: 5,
			expected: "Error",
		},
		{
			name:     "word boundary truncation",
			err:      errors.New("this error message should break at word boundary"),
			maxWidth: 35,
			expected: "Error: this error message...",
		},
		{
			name:     "preprocessed 404 error",
			err:      errors.New("404 Not Found: resource missing"),
			maxWidth: 50,
			expected: "Error: Resource not found",
		},
		{
			name:     "zero max width",
			err:      errors.New("error"),
			maxWidth: 0,
			expected: "",
		},
		{
			name:     "unicode error message",
			err:      errors.New("错误：文件未找到"),
			maxWidth: 50,
			expected: "Error: 错误：文件未找到",
		},
		{
			name:     "exact fit with ellipsis",
			err:      errors.New("exactly fitting message"),
			maxWidth: 29,
			expected: "Error: exactly fitting...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TruncateError(tt.err, tt.maxWidth)
			if got != tt.expected {
				t.Errorf("TruncateError(%v, %d) = %q, want %q", tt.err, tt.maxWidth, got, tt.expected)
			}
		})
	}
}

func TestTruncateError_LongMessages(t *testing.T) {
	// Test with very long error message
	longMsg := strings.Repeat("very long error message ", 20)
	err := errors.New(longMsg)

	result := TruncateError(err, 50)
	if len(result) > 50 {
		t.Errorf("TruncateError result too long: got %d chars, want <= 50", len(result))
	}
	if !strings.HasPrefix(result, "Error: ") {
		t.Errorf("TruncateError should start with 'Error: ', got %q", result)
	}
	if !strings.HasSuffix(result, "...") {
		t.Errorf("TruncateError should end with '...', got %q", result)
	}
}

// Benchmark tests
func BenchmarkPreprocessError(b *testing.B) {
	errMsg := "500 Internal Server Error: something went wrong\nStack trace:\n\tat foo.go:123"
	for i := 0; i < b.N; i++ {
		PreprocessError(errMsg)
	}
}

func BenchmarkTruncateError(b *testing.B) {
	err := errors.New("this is a very long error message that needs to be truncated for display purposes")
	for i := 0; i < b.N; i++ {
		TruncateError(err, 50)
	}
}
