//go:build integration
// +build integration

package daemon_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/daemon"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPStubEndpoint(t *testing.T) {
	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp")
	_ = testutil.DatabasePath(t, "mcp") // Sets HUMANLAYER_DATABASE_PATH

	// Get a free port for HTTP server
	httpPort := getFreePort(t)

	// Override environment
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	os.Setenv("HUMANLAYER_API_KEY", "") // Disable cloud API

	// Create isolated config
	tempDir := t.TempDir()
	os.Setenv("XDG_CONFIG_HOME", tempDir)
	configDir := filepath.Join(tempDir, "humanlayer")
	require.NoError(t, os.MkdirAll(configDir, 0755))
	configFile := filepath.Join(configDir, "humanlayer.json")
	require.NoError(t, os.WriteFile(configFile, []byte(`{}`), 0644))

	// Create daemon
	d, err := daemon.New()
	require.NoError(t, err, "Failed to create daemon")

	// Start daemon in background
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- d.Run(ctx)
	}()

	// Wait for HTTP server to be ready
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", httpPort)
	require.Eventually(t, func() bool {
		resp, err := http.Get(fmt.Sprintf("%s/api/v1/health", baseURL))
		if err == nil {
			resp.Body.Close()
			return resp.StatusCode == 200
		}
		return false
	}, 5*time.Second, 100*time.Millisecond, "HTTP server did not start")

	t.Run("Initialize", func(t *testing.T) {
		// Test MCP initialize method
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "initialize",
			"params": map[string]interface{}{
				"protocolVersion": "2025-03-26",
				"capabilities":    map[string]interface{}{},
				"clientInfo": map[string]interface{}{
					"name":    "test",
					"version": "1.0",
				},
			},
		}

		body, err := json.Marshal(reqBody)
		require.NoError(t, err)

		resp, err := http.Post(
			fmt.Sprintf("%s/api/v1/mcp", baseURL),
			"application/json",
			bytes.NewBuffer(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Verify response structure
		assert.Equal(t, "2.0", result["jsonrpc"])
		assert.Equal(t, float64(1), result["id"])

		// Check result field
		res, ok := result["result"].(map[string]interface{})
		require.True(t, ok, "result field should be a map")

		assert.Equal(t, "2025-03-26", res["protocolVersion"])

		serverInfo, ok := res["serverInfo"].(map[string]interface{})
		require.True(t, ok, "serverInfo should be a map")
		assert.Equal(t, "humanlayer-daemon", serverInfo["name"])
		assert.Equal(t, "1.0.0", serverInfo["version"])
	})

	t.Run("ToolsList", func(t *testing.T) {
		// Test tools/list method
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      2,
			"method":  "tools/list",
			"params":  map[string]interface{}{},
		}

		body, err := json.Marshal(reqBody)
		require.NoError(t, err)

		resp, err := http.Post(
			fmt.Sprintf("%s/api/v1/mcp", baseURL),
			"application/json",
			bytes.NewBuffer(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Check tools list
		res, ok := result["result"].(map[string]interface{})
		require.True(t, ok)

		tools, ok := res["tools"].([]interface{})
		require.True(t, ok)
		assert.Len(t, tools, 1)

		tool := tools[0].(map[string]interface{})
		assert.Equal(t, "request_approval", tool["name"])
		assert.Contains(t, tool["description"], "Request permission to execute a tool")
	})

	t.Run("UnknownMethod", func(t *testing.T) {
		// Test unknown method
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      4,
			"method":  "unknown/method",
			"params":  map[string]interface{}{},
		}

		body, err := json.Marshal(reqBody)
		require.NoError(t, err)

		resp, err := http.Post(
			fmt.Sprintf("%s/api/v1/mcp", baseURL),
			"application/json",
			bytes.NewBuffer(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Should have error response
		errResp, ok := result["error"].(map[string]interface{})
		require.True(t, ok, "Should have error field")

		assert.Equal(t, float64(-32601), errResp["code"])
		assert.Contains(t, errResp["message"], "not found")
	})

	t.Run("AutoDeny", func(t *testing.T) {
		// Set auto-deny mode
		os.Setenv("MCP_AUTO_DENY_ALL", "true")
		defer os.Unsetenv("MCP_AUTO_DENY_ALL")

		// Restart daemon with auto-deny
		cancel()

		// Wait for shutdown
		select {
		case <-errCh:
		case <-time.After(2 * time.Second):
			t.Fatal("Daemon did not shut down")
		}

		// Create new daemon with auto-deny
		d2, err := daemon.New()
		require.NoError(t, err)

		ctx2, cancel2 := context.WithCancel(context.Background())
		defer cancel2()

		errCh2 := make(chan error, 1)
		go func() {
			errCh2 <- d2.Run(ctx2)
		}()

		// Wait for server to be ready again
		require.Eventually(t, func() bool {
			resp, err := http.Get(fmt.Sprintf("%s/api/v1/health", baseURL))
			if err == nil {
				resp.Body.Close()
				return resp.StatusCode == 200
			}
			return false
		}, 5*time.Second, 100*time.Millisecond)

		// Test tools/call with auto-deny
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      3,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "test_tool",
					"input":       map[string]interface{}{"test": "data"},
					"tool_use_id": "test_123",
				},
			},
		}

		body, err := json.Marshal(reqBody)
		require.NoError(t, err)

		resp, err := http.Post(
			fmt.Sprintf("%s/api/v1/mcp", baseURL),
			"application/json",
			bytes.NewBuffer(body),
		)
		require.NoError(t, err)
		defer resp.Body.Close()

		assert.Equal(t, 200, resp.StatusCode)

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Check auto-deny response
		res, ok := result["result"].(map[string]interface{})
		require.True(t, ok)

		content, ok := res["content"].([]interface{})
		require.True(t, ok)
		require.Len(t, content, 1)

		contentItem := content[0].(map[string]interface{})
		assert.Equal(t, "text", contentItem["type"])

		// Parse the JSON text content
		text := contentItem["text"].(string)
		var approval map[string]interface{}
		err = json.Unmarshal([]byte(text), &approval)
		require.NoError(t, err)

		assert.Equal(t, "deny", approval["behavior"])
		assert.Contains(t, approval["message"], "Auto-denied")
	})
}

// getFreePort gets a free TCP port for testing
func getFreePort(t *testing.T) int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	return listener.Addr().(*net.TCPAddr).Port
}
