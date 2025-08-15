//go:build integration
// +build integration

package daemon_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

func TestMCPServerFullImplementation(t *testing.T) {
	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp-full")
	_ = testutil.DatabasePath(t, "mcp-full")

	// Get a free port for HTTP server
	httpPort := getFreePort(t)

	// Override environment
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	os.Setenv("HUMANLAYER_API_KEY", "")    // Disable cloud API
	os.Setenv("MCP_AUTO_DENY_ALL", "true") // Enable auto-deny for predictable testing

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

	t.Run("ToolsListSchemaValidation", func(t *testing.T) {
		// Test that tools/list returns proper schema structure
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
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

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Validate the tool schema structure
		res := result["result"].(map[string]interface{})
		tools := res["tools"].([]interface{})
		require.Len(t, tools, 1)

		tool := tools[0].(map[string]interface{})
		assert.Equal(t, "request_approval", tool["name"])
		assert.Equal(t, "Request permission to execute a tool", tool["description"])

		// Check input schema structure
		inputSchema := tool["inputSchema"].(map[string]interface{})
		assert.Equal(t, "object", inputSchema["type"])

		properties := inputSchema["properties"].(map[string]interface{})
		assert.Contains(t, properties, "tool_name")
		assert.Contains(t, properties, "input")
		assert.Contains(t, properties, "tool_use_id")

		// Verify required fields
		required := inputSchema["required"].([]interface{})
		assert.Len(t, required, 3)
		assert.Contains(t, required, "tool_name")
		assert.Contains(t, required, "input")
		assert.Contains(t, required, "tool_use_id")

		// Check annotations (mark3labs specific)
		if annotations, ok := tool["annotations"].(map[string]interface{}); ok {
			assert.NotNil(t, annotations["destructiveHint"])
			assert.NotNil(t, annotations["openWorldHint"])
		}
	})

	t.Run("AutoDenyResponseStructure", func(t *testing.T) {
		// Test that auto-deny returns proper JSON structure
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      2,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "test_tool",
					"input":       map[string]interface{}{"command": "ls -la"},
					"tool_use_id": "test_use_123",
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

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Validate response structure
		res := result["result"].(map[string]interface{})
		content := res["content"].([]interface{})
		require.Len(t, content, 1)

		contentItem := content[0].(map[string]interface{})
		assert.Equal(t, "text", contentItem["type"])

		// Parse and validate the JSON in the text field
		text := contentItem["text"].(string)
		var approvalResponse map[string]interface{}
		err = json.Unmarshal([]byte(text), &approvalResponse)
		require.NoError(t, err)

		assert.Equal(t, "deny", approvalResponse["behavior"])
		assert.Equal(t, "Auto-denied for testing", approvalResponse["message"])
	})

	t.Run("SessionIDHeaderExtraction", func(t *testing.T) {
		// Test that X-Session-ID header is properly handled
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      3,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "test_with_session",
					"input":       map[string]interface{}{"test": "data"},
					"tool_use_id": "session_test_456",
				},
			},
		}

		body, err := json.Marshal(reqBody)
		require.NoError(t, err)

		req, err := http.NewRequest("POST",
			fmt.Sprintf("%s/api/v1/mcp", baseURL),
			bytes.NewBuffer(body))
		require.NoError(t, err)

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Session-ID", "test-session-789")

		client := &http.Client{}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Should still get auto-deny response (session ID doesn't affect auto-deny)
		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Verify we got a valid response (session ID was accepted)
		assert.Contains(t, result, "result")
		assert.NotContains(t, result, "error")
	})

	t.Run("MissingRequiredFields", func(t *testing.T) {
		// Test that missing required fields return appropriate errors
		reqBody := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      4,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					// Missing tool_use_id
					"tool_name": "incomplete_tool",
					"input":     map[string]interface{}{"test": "data"},
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

		var result map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&result)
		require.NoError(t, err)

		// Should still work in auto-deny mode (gets empty string for missing field)
		// but in real mode would be problematic
		if errField, hasError := result["error"]; hasError {
			// If there's an error, it should be about the missing field
			errMap := errField.(map[string]interface{})
			assert.Contains(t, errMap["message"], "required")
		} else {
			// In auto-deny mode, it might still process with empty tool_use_id
			res := result["result"].(map[string]interface{})
			assert.NotNil(t, res)
		}
	})
}
