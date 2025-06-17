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
