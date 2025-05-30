// +build integration

package daemon

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/internal/testutil"
)

// TestDaemonBinaryIntegration tests the actual daemon binary
func TestDaemonBinaryIntegration(t *testing.T) {
	// Build the daemon binary
	binPath := filepath.Join(t.TempDir(), "hld")
	cmd := exec.Command("go", "build", "-o", binPath, "../cmd/hld")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to build daemon: %v\n%s", err, output)
	}

	// Test 1: Daemon starts successfully
	t.Run("daemon_starts", func(t *testing.T) {
		socketPath := testutil.SocketPath(t, "starts")
		t.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		cmd := exec.CommandContext(ctx, binPath)
		// Capture output for debugging
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			t.Fatalf("failed to start daemon: %v", err)
		}

		// Wait for daemon to be ready
		time.Sleep(200 * time.Millisecond)

		// Verify socket exists with correct permissions
		info, err := os.Stat(socketPath)
		if err != nil {
			t.Fatalf("socket not created: %v", err)
		}

		if info.Mode().Perm() != 0600 {
			t.Errorf("wrong socket permissions: got %v, want 0600", info.Mode().Perm())
		}

		// Verify we can connect
		conn, err := net.Dial("unix", socketPath)
		if err != nil {
			t.Fatalf("cannot connect to daemon: %v", err)
		}
		conn.Close()

		// Clean shutdown
		cmd.Process.Signal(syscall.SIGTERM)
		cmd.Wait()

		// Verify socket cleaned up
		if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
			t.Error("socket not cleaned up after shutdown")
		}
	})

	// Test 2: Daemon refuses double start
	t.Run("refuses_double_start", func(t *testing.T) {
		socketPath := testutil.SocketPath(t, "starts")
		t.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)

		// Start first daemon
		ctx1, cancel1 := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel1()

		cmd1 := exec.CommandContext(ctx1, binPath)
		if err := cmd1.Start(); err != nil {
			t.Fatalf("failed to start first daemon: %v", err)
		}
		defer func() {
			cmd1.Process.Signal(syscall.SIGTERM)
			cmd1.Wait()
		}()

		// Wait for first daemon to be ready
		time.Sleep(200 * time.Millisecond)

		// Try to start second daemon
		cmd2 := exec.Command(binPath)
		output, err := cmd2.CombinedOutput()
		if err == nil {
			t.Fatal("second daemon should have failed to start")
		}

		// Check error message
		if !strings.Contains(string(output), "daemon already running") {
			t.Errorf("unexpected error output: %s", output)
		}
	})

	// Test 3: Graceful shutdown on signals
	t.Run("graceful_shutdown", func(t *testing.T) {
		for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
			t.Run(sig.String(), func(t *testing.T) {
				socketPath := testutil.SocketPath(t, sig.String())
				t.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)

				cmd := exec.Command(binPath)
				if err := cmd.Start(); err != nil {
					t.Fatalf("failed to start daemon: %v", err)
				}

				// Wait for daemon to be ready
				time.Sleep(200 * time.Millisecond)

				// Send signal
				if err := cmd.Process.Signal(sig); err != nil {
					t.Fatalf("failed to send signal: %v", err)
				}

				// Wait for process to exit
				done := make(chan error, 1)
				go func() {
					done <- cmd.Wait()
				}()

				select {
				case err := <-done:
					if err != nil {
						t.Errorf("daemon did not exit cleanly: %v", err)
					}
				case <-time.After(2 * time.Second):
					t.Error("daemon did not shut down within timeout")
					cmd.Process.Kill()
				}

				// Verify socket cleaned up
				if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
					t.Errorf("socket not cleaned up after %v", sig)
				}
			})
		}
	})
}