// Package testutil provides test utilities for integration tests
package testutil

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// SocketPath returns a unique socket path for testing.
// It handles macOS's 104-character path limit and automatically
// registers cleanup with t.Cleanup().
func SocketPath(t *testing.T, suffix string) string {
	t.Helper()

	// Create short path to avoid macOS 104-char limit
	socketPath := fmt.Sprintf("/tmp/hld-test-%d-%s.sock", os.Getpid(), suffix)

	// Register cleanup
	t.Cleanup(func() {
		_ = os.Remove(socketPath)
	})

	// Ensure parent directory exists
	dir := filepath.Dir(socketPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("failed to create socket directory: %v", err)
	}

	return socketPath
}
