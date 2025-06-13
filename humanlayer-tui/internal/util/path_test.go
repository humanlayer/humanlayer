package util

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExpandSocketPath(t *testing.T) {
	home := MustGetHomeDir()

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "tilde expansion",
			input:    "~/.humanlayer/daemon.sock",
			expected: filepath.Join(home, ".humanlayer", "daemon.sock"),
		},
		{
			name:     "no tilde",
			input:    "/tmp/daemon.sock",
			expected: "/tmp/daemon.sock",
		},
		{
			name:     "relative path",
			input:    "./daemon.sock",
			expected: "daemon.sock",
		},
		{
			name:     "path with ..",
			input:    "/tmp/../var/daemon.sock",
			expected: "/var/daemon.sock",
		},
		{
			name:     "just tilde",
			input:    "~",
			expected: home,
		},
		{
			name:     "empty path",
			input:    "",
			expected: ".",
		},
		{
			name:     "tilde in middle (not expanded)",
			input:    "/tmp/~user/file",
			expected: "/tmp/~user/file",
		},
		{
			name:     "multiple slashes",
			input:    "/tmp//daemon.sock",
			expected: "/tmp/daemon.sock",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExpandSocketPath(tt.input)
			if got != tt.expected {
				t.Errorf("ExpandSocketPath(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestMustGetHomeDir(t *testing.T) {
	// This should not panic in normal circumstances
	home := MustGetHomeDir()
	if home == "" {
		t.Error("MustGetHomeDir() returned empty string")
	}

	// Verify it's a valid directory
	info, err := os.Stat(home)
	if err != nil {
		t.Errorf("Home directory does not exist: %v", err)
	}
	if !info.IsDir() {
		t.Errorf("Home path is not a directory: %s", home)
	}
}

func TestGetDefaultConfigDir(t *testing.T) {
	// Save original env var
	origXDG := os.Getenv("XDG_CONFIG_HOME")
	defer func() {
		if err := os.Setenv("XDG_CONFIG_HOME", origXDG); err != nil {
			t.Errorf("Failed to restore XDG_CONFIG_HOME: %v", err)
		}
	}()

	tests := []struct {
		name         string
		xdgHome      string
		expectSuffix string
	}{
		{
			name:         "with XDG_CONFIG_HOME",
			xdgHome:      "/custom/config",
			expectSuffix: "/custom/config/humanlayer",
		},
		{
			name:         "without XDG_CONFIG_HOME",
			xdgHome:      "",
			expectSuffix: ".config/humanlayer",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := os.Setenv("XDG_CONFIG_HOME", tt.xdgHome); err != nil {
				t.Fatalf("Failed to set XDG_CONFIG_HOME: %v", err)
			}
			got := GetDefaultConfigDir()

			if tt.xdgHome != "" {
				if got != tt.expectSuffix {
					t.Errorf("GetDefaultConfigDir() = %q, want %q", got, tt.expectSuffix)
				}
			} else {
				if !strings.HasSuffix(got, tt.expectSuffix) {
					t.Errorf("GetDefaultConfigDir() = %q, want suffix %q", got, tt.expectSuffix)
				}
			}
		})
	}
}

func TestGetDefaultConfigDir_HomeDirError(t *testing.T) {
	// This test is tricky because we can't easily simulate UserHomeDir failing
	// But we can at least verify the function doesn't panic

	// Clear XDG_CONFIG_HOME to test the fallback path
	origXDG := os.Getenv("XDG_CONFIG_HOME")
	defer func() {
		if err := os.Setenv("XDG_CONFIG_HOME", origXDG); err != nil {
			t.Errorf("Failed to restore XDG_CONFIG_HOME: %v", err)
		}
	}()
	if err := os.Unsetenv("XDG_CONFIG_HOME"); err != nil {
		t.Fatalf("Failed to unset XDG_CONFIG_HOME: %v", err)
	}

	// The function should still return something reasonable
	got := GetDefaultConfigDir()
	if got == "" {
		t.Error("GetDefaultConfigDir() returned empty string")
	}
}

// Test panic behavior of MustGetHomeDir
func TestMustGetHomeDir_Panic(t *testing.T) {
	// We can't easily test the panic case without mocking os.UserHomeDir
	// But we can at least verify the function signature
	defer func() {
		if r := recover(); r != nil {
			// If we somehow trigger a panic, make sure it's the right message
			if !strings.Contains(r.(string), "failed to get home directory") {
				t.Errorf("Unexpected panic message: %v", r)
			}
		}
	}()

	// This should not panic in normal test environment
	_ = MustGetHomeDir()
}

// Benchmark tests
func BenchmarkExpandSocketPath(b *testing.B) {
	for i := 0; i < b.N; i++ {
		ExpandSocketPath("~/.humanlayer/daemon.sock")
	}
}

func BenchmarkGetDefaultConfigDir(b *testing.B) {
	for i := 0; i < b.N; i++ {
		GetDefaultConfigDir()
	}
}
