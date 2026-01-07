package opencode

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewClientWithPath(t *testing.T) {
	path := "/custom/path/to/opencode"
	client := NewClientWithPath(path)

	if client.opencodePath != path {
		t.Errorf("NewClientWithPath() opencodePath = %v, want %v", client.opencodePath, path)
	}
}

func TestClient_GetPath(t *testing.T) {
	path := "/test/opencode"
	client := NewClientWithPath(path)

	if got := client.GetPath(); got != path {
		t.Errorf("Client.GetPath() = %v, want %v", got, path)
	}
}

func TestBuildArgs(t *testing.T) {
	client := NewClientWithPath("/usr/local/bin/opencode")

	tests := []struct {
		name     string
		config   SessionConfig
		expected []string
	}{
		{
			name: "basic query",
			config: SessionConfig{
				Query: "Hello world",
			},
			expected: []string{"run", "--format", "json", "Hello world"},
		},
		{
			name: "with session ID",
			config: SessionConfig{
				Query:     "Continue previous work",
				SessionID: "session-123",
			},
			expected: []string{"run", "--session", "session-123", "--format", "json", "Continue previous work"},
		},
		{
			name: "with continue last",
			config: SessionConfig{
				Query:        "Keep going",
				ContinueLast: true,
			},
			expected: []string{"run", "--continue", "--format", "json", "Keep going"},
		},
		{
			name: "with model",
			config: SessionConfig{
				Query: "Test query",
				Model: "anthropic/claude-sonnet-4-20250514",
			},
			expected: []string{"run", "--model", "anthropic/claude-sonnet-4-20250514", "--format", "json", "Test query"},
		},
		{
			name: "with agent",
			config: SessionConfig{
				Query: "Code review",
				Agent: "code-reviewer",
			},
			expected: []string{"run", "--agent", "code-reviewer", "--format", "json", "Code review"},
		},
		{
			name: "with title",
			config: SessionConfig{
				Query: "New feature",
				Title: "Feature Implementation",
			},
			expected: []string{"run", "--title", "Feature Implementation", "--format", "json", "New feature"},
		},
		{
			name: "with files",
			config: SessionConfig{
				Query: "Review these files",
				Files: []string{"file1.go", "file2.go"},
			},
			expected: []string{"run", "--file", "file1.go", "--file", "file2.go", "--format", "json", "Review these files"},
		},
		{
			name: "with attach URL",
			config: SessionConfig{
				Query:     "Connect to server",
				AttachURL: "http://localhost:8080",
			},
			expected: []string{"run", "--attach", "http://localhost:8080", "--format", "json", "Connect to server"},
		},
		{
			name: "with port",
			config: SessionConfig{
				Query: "Start server",
				Port:  9000,
			},
			expected: []string{"run", "--port", "9000", "--format", "json", "Start server"},
		},
		{
			name: "full config",
			config: SessionConfig{
				Query:     "Full test",
				SessionID: "sess-456",
				Model:     "anthropic/claude-opus-4-20250514",
				Agent:     "general",
				Title:     "Full Config Test",
				Files:     []string{"test.go"},
				Port:      8080,
			},
			expected: []string{
				"run",
				"--session", "sess-456",
				"--model", "anthropic/claude-opus-4-20250514",
				"--agent", "general",
				"--title", "Full Config Test",
				"--file", "test.go",
				"--port", "8080",
				"--format", "json",
				"Full test",
			},
		},
		{
			name:     "empty query",
			config:   SessionConfig{},
			expected: []string{"run", "--format", "json"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args, err := client.buildArgs(tt.config)
			if err != nil {
				t.Fatalf("buildArgs() error = %v", err)
			}

			if len(args) != len(tt.expected) {
				t.Errorf("buildArgs() returned %d args, want %d", len(args), len(tt.expected))
				t.Errorf("got: %v", args)
				t.Errorf("want: %v", tt.expected)
				return
			}

			for i, arg := range args {
				if arg != tt.expected[i] {
					t.Errorf("buildArgs()[%d] = %v, want %v", i, arg, tt.expected[i])
				}
			}
		})
	}
}

func TestShouldSkipPath(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/usr/local/bin/opencode", false},
		{"/home/user/.local/bin/opencode", false},
		{"/home/user/node_modules/.bin/opencode", true},
		{"/project/node_modules/opencode/bin/opencode", true},
		{"/home/user/.opencode/bin/opencode", false},
		{"/tmp/opencode.bak", true},
		{"/home/user/backup/opencode.bak", true},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := ShouldSkipPath(tt.path)
			if got != tt.expected {
				t.Errorf("ShouldSkipPath(%q) = %v, want %v", tt.path, got, tt.expected)
			}
		})
	}
}

func TestIsExecutable(t *testing.T) {
	// Create a temporary directory for test files
	tmpDir := t.TempDir()

	// Test 1: Non-existent file
	t.Run("non-existent file", func(t *testing.T) {
		err := IsExecutable(filepath.Join(tmpDir, "nonexistent"))
		if err == nil {
			t.Error("IsExecutable() expected error for non-existent file")
		}
	})

	// Test 2: File without execute permission
	t.Run("non-executable file", func(t *testing.T) {
		nonExec := filepath.Join(tmpDir, "nonexec")
		err := os.WriteFile(nonExec, []byte("test"), 0644)
		if err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}

		err = IsExecutable(nonExec)
		if err == nil {
			t.Error("IsExecutable() expected error for non-executable file")
		}
	})

	// Test 3: File with execute permission
	t.Run("executable file", func(t *testing.T) {
		exec := filepath.Join(tmpDir, "exec")
		err := os.WriteFile(exec, []byte("#!/bin/sh\necho test"), 0755)
		if err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}

		err = IsExecutable(exec)
		if err != nil {
			t.Errorf("IsExecutable() unexpected error for executable file: %v", err)
		}
	})
}

func TestIsClosedPipeError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		// Note: Testing actual pipe errors requires more complex setup
		// These tests verify the basic nil handling
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isClosedPipeError(tt.err)
			if got != tt.expected {
				t.Errorf("isClosedPipeError() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// TestSessionConfig_Defaults verifies that default values are sensible
func TestSessionConfig_Defaults(t *testing.T) {
	config := SessionConfig{}

	// Verify zero values
	if config.Query != "" {
		t.Errorf("Default Query should be empty, got %q", config.Query)
	}
	if config.SessionID != "" {
		t.Errorf("Default SessionID should be empty, got %q", config.SessionID)
	}
	if config.ContinueLast != false {
		t.Error("Default ContinueLast should be false")
	}
	if config.Model != "" {
		t.Errorf("Default Model should be empty, got %q", config.Model)
	}
	if config.OutputFormat != "" {
		t.Errorf("Default OutputFormat should be empty, got %q", config.OutputFormat)
	}
	if config.WorkingDir != "" {
		t.Errorf("Default WorkingDir should be empty, got %q", config.WorkingDir)
	}
	if len(config.Files) != 0 {
		t.Errorf("Default Files should be empty, got %v", config.Files)
	}
	if config.Agent != "" {
		t.Errorf("Default Agent should be empty, got %q", config.Agent)
	}
	if config.AttachURL != "" {
		t.Errorf("Default AttachURL should be empty, got %q", config.AttachURL)
	}
	if config.Port != 0 {
		t.Errorf("Default Port should be 0, got %d", config.Port)
	}
	if len(config.Env) != 0 {
		t.Errorf("Default Env should be empty, got %v", config.Env)
	}
}

// TestOutputFormat verifies output format constants
func TestOutputFormat(t *testing.T) {
	if OutputDefault != "default" {
		t.Errorf("OutputDefault = %q, want %q", OutputDefault, "default")
	}
	if OutputJSON != "json" {
		t.Errorf("OutputJSON = %q, want %q", OutputJSON, "json")
	}
}
