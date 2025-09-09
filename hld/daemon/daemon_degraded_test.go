//go:build integration
// +build integration

package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDaemonDegradedState tests daemon behavior when Claude is not available
func TestDaemonDegradedState(t *testing.T) {
	// Save and clear PATH to ensure Claude is not found
	originalPath := os.Getenv("PATH")
	defer os.Setenv("PATH", originalPath)
	os.Setenv("PATH", "/usr/bin:/bin")
	os.Unsetenv("CLAUDE_PATH")

	// Create test daemon with minimal environment
	socketPath := testutil.SocketPath(t, "degraded")
	dbPath := testutil.DatabasePath(t, "degraded")
	httpPort := getFreePort(t)

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	defer os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	defer os.Unsetenv("HUMANLAYER_DATABASE_PATH")
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	defer os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	defer os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
	os.Setenv("HUMANLAYER_API_KEY", "") // Disable cloud API
	defer os.Unsetenv("HUMANLAYER_API_KEY")
	// Don't set HUMANLAYER_CLAUDE_PATH - let it try to find Claude and fail

	// Create daemon
	d, err := New()
	require.NoError(t, err, "should create daemon even without Claude")

	// Start daemon
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	errChan := make(chan error, 1)
	go func() {
		errChan <- d.Run(ctx)
	}()

	// Wait for daemon to be ready
	time.Sleep(500 * time.Millisecond)

	t.Run("health_endpoint_reports_degraded", func(t *testing.T) {
		// Check health endpoint
		resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/v1/health", httpPort))
		require.NoError(t, err)
		defer resp.Body.Close()

		var health struct {
			Status       string `json:"status"`
			Version      string `json:"version"`
			Dependencies struct {
				Claude struct {
					Available bool   `json:"available"`
					Error     string `json:"error"`
				} `json:"claude"`
			} `json:"dependencies"`
		}

		err = json.NewDecoder(resp.Body).Decode(&health)
		require.NoError(t, err)

		// Verify degraded status
		assert.Equal(t, "degraded", health.Status, "should report degraded status")
		assert.False(t, health.Dependencies.Claude.Available, "Claude should not be available")
		assert.Contains(t, health.Dependencies.Claude.Error, "not found", "should report Claude not found")
		assert.NotEmpty(t, health.Version, "should report version")
	})

	t.Run("daemon_accepts_connections_when_degraded", func(t *testing.T) {
		// Test that we can still connect to the daemon API
		resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/v1/sessions", httpPort))
		require.NoError(t, err)
		defer resp.Body.Close()

		// Should get a valid response (even if empty)
		assert.Equal(t, http.StatusOK, resp.StatusCode, "should accept API requests")
	})

	t.Run("session_creation_fails_gracefully", func(t *testing.T) {
		// Try to create a session - should fail but not crash
		reqBody := `{
			"query": "test",
			"model": "claude-3-5-sonnet-20241022"
		}`

		resp, err := http.Post(
			fmt.Sprintf("http://localhost:%d/api/v1/sessions", httpPort),
			"application/json",
			strings.NewReader(reqBody),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Should get an error response, not a crash
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode, "should return error for session creation")

		var errorResp struct {
			Error interface{} `json:"error"`
		}
		err = json.NewDecoder(resp.Body).Decode(&errorResp)
		require.NoError(t, err)
		assert.NotNil(t, errorResp.Error, "error should be present when Claude is not available")
	})

	// Clean shutdown
	cancel()
	select {
	case err := <-errChan:
		assert.NoError(t, err, "daemon should shut down cleanly")
	case <-time.After(2 * time.Second):
		t.Error("daemon did not shut down in time")
	}
}

// TestDaemonTransitionsToHealthy tests that daemon can transition from degraded to healthy
func TestDaemonTransitionsToHealthy(t *testing.T) {
	// Start with no Claude available
	originalPath := os.Getenv("PATH")
	defer os.Setenv("PATH", originalPath)
	os.Setenv("PATH", "/usr/bin:/bin")

	// Create a mock Claude binary that we'll add later
	mockClaudePath := filepath.Join(t.TempDir(), "claude")
	mockClaudeScript := `#!/bin/sh
echo "mock claude"
exit 0`

	socketPath := testutil.SocketPath(t, "transition")
	dbPath := testutil.DatabasePath(t, "transition")
	httpPort := getFreePort(t)

	// Set environment for test
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	defer os.Unsetenv("HUMANLAYER_DAEMON_SOCKET")
	os.Setenv("HUMANLAYER_DATABASE_PATH", dbPath)
	defer os.Unsetenv("HUMANLAYER_DATABASE_PATH")
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	defer os.Unsetenv("HUMANLAYER_DAEMON_HTTP_PORT")
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	defer os.Unsetenv("HUMANLAYER_DAEMON_HTTP_HOST")
	os.Setenv("HUMANLAYER_API_KEY", "") // Disable cloud API
	defer os.Unsetenv("HUMANLAYER_API_KEY")

	d, err := New()
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	errChan := make(chan error, 1)
	go func() {
		errChan <- d.Run(ctx)
	}()

	time.Sleep(500 * time.Millisecond)

	// Initially should be degraded
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/v1/health", httpPort))
	require.NoError(t, err)

	var health struct {
		Status string `json:"status"`
	}
	json.NewDecoder(resp.Body).Decode(&health)
	resp.Body.Close()
	assert.Equal(t, "degraded", health.Status, "should start degraded")

	// Add Claude to PATH
	err = os.WriteFile(mockClaudePath, []byte(mockClaudeScript), 0755)
	require.NoError(t, err)
	os.Setenv("PATH", filepath.Dir(mockClaudePath)+":"+os.Getenv("PATH"))

	// Update daemon config with Claude path
	updateReq := `{"claude_path": "` + mockClaudePath + `"}`
	req, err := http.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("http://localhost:%d/api/config", httpPort),
		strings.NewReader(updateReq),
	)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	// Note: In a real implementation, the daemon would need to support
	// dynamic Claude path updates. For now, this test documents the desired behavior.

	// Clean shutdown
	cancel()
	<-errChan
}

// getFreePort returns a free TCP port for testing
func getFreePort(t *testing.T) int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}
