package testutil

import (
	"fmt"
	"os"
	"testing"
)

// SocketPath returns a short socket path suitable for macOS (which has a 104 char limit).
// It automatically registers cleanup with t.Cleanup().
func SocketPath(t *testing.T, suffix string) string {
	t.Helper()

	// Keep it short - macOS has a 104 char limit for socket paths
	path := fmt.Sprintf("/tmp/hld-%d-%s.sock", os.Getpid(), suffix)

	// Ensure any existing socket is removed first
	_ = os.Remove(path)

	// Register cleanup
	t.Cleanup(func() {
		_ = os.Remove(path)
	})

	return path
}

// CreateTestSocket creates a test socket path with automatic cleanup
func CreateTestSocket(t *testing.T) string {
	t.Helper()
	return SocketPath(t, "test")
}

// DatabasePath returns a temporary database path for testing.
// It automatically sets the HUMANLAYER_DATABASE_PATH environment variable
// and registers cleanup with t.Cleanup().
func DatabasePath(t *testing.T, suffix string) string {
	t.Helper()

	// Create a temporary directory for the test
	tempDir := t.TempDir()

	// Create database path
	dbPath := fmt.Sprintf("%s/test-%s.db", tempDir, suffix)

	// Set environment variable
	oldPath := os.Getenv("HUMANLAYER_DATABASE_PATH")
	if err := os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath); err != nil {
		t.Fatalf("Failed to set HUMANLAYER_DATABASE_PATH: %v", err)
	}

	// Register cleanup to restore original environment
	t.Cleanup(func() {
		if oldPath != "" {
			_ = os.Setenv("HUMANLAYER_DATABASE_PATH", oldPath)
		} else {
			_ = os.Unsetenv("HUMANLAYER_DATABASE_PATH")
		}
	})

	return dbPath
}
