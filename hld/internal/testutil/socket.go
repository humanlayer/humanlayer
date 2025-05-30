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
	os.Remove(path)

	// Register cleanup
	t.Cleanup(func() {
		os.Remove(path)
	})

	return path
}
