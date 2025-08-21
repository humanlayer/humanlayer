//go:build integration

package daemon_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/daemon"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPPhase4ApprovalCreation(t *testing.T) {
	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp-phase4")
	dbPath := testutil.DatabasePath(t, "mcp-phase4")

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

	// Open database connection
	db, err := sql.Open("sqlite3", dbPath)
	require.NoError(t, err)
	defer db.Close()

	// Create a test session
	sessionID := "test-session-phase4"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message
		) VALUES (
			?, 'run-phase4', 'claude-phase4', 'test query', 'claude-3-sonnet', '/tmp',
			'running', datetime('now'), datetime('now'), 0, 0, 10, '',
			'', 0.0, 0, 0, 0, 0, '', ''
		)
	`, sessionID)
	require.NoError(t, err)

	t.Run("ApprovalCreatedWithToolUseID", func(t *testing.T) {
		// Send MCP approval request
		toolUseID := "test_use_phase4_123"
		req := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "test_tool",
					"input":       map[string]interface{}{"test": "data"},
					"tool_use_id": toolUseID,
				},
			},
		}

		body, _ := json.Marshal(req)
		httpReq, _ := http.NewRequest("POST", baseURL+"/api/v1/mcp", bytes.NewBuffer(body))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-Session-ID", sessionID)

		// Send request in background (it will block waiting for approval)
		go func() {
			client := &http.Client{Timeout: 2 * time.Second}
			client.Do(httpReq)
		}()

		// Wait for approval to be created
		time.Sleep(500 * time.Millisecond)

		// Check database for approval with tool_use_id
		var count int
		err := db.QueryRow(`
			SELECT COUNT(*) FROM approvals
			WHERE tool_use_id = ? AND session_id = ?
		`, toolUseID, sessionID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 1, count, "Expected exactly one approval with tool_use_id")

		// Verify approval details
		var approvalID, toolName, status string
		var toolInput string
		err = db.QueryRow(`
			SELECT id, tool_name, tool_input, status
			FROM approvals
			WHERE tool_use_id = ? AND session_id = ?
		`, toolUseID, sessionID).Scan(&approvalID, &toolName, &toolInput, &status)
		require.NoError(t, err)

		assert.Equal(t, "test_tool", toolName)
		assert.Equal(t, "pending", status)
		assert.Contains(t, toolInput, `"test":"data"`)
		assert.NotEmpty(t, approvalID)

		t.Logf("Successfully created approval with ID=%s, tool_use_id=%s", approvalID, toolUseID)
	})

	t.Run("AutoApprovalWithDangerousSkip", func(t *testing.T) {
		// Enable dangerous skip permissions
		_, err := db.Exec(`
			UPDATE sessions
			SET dangerously_skip_permissions = 1
			WHERE id = ?
		`, sessionID)
		require.NoError(t, err)

		// Send MCP approval request
		toolUseID := "test_use_auto_approve"
		req := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      2,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "edit_tool",
					"input":       map[string]interface{}{"file": "test.txt"},
					"tool_use_id": toolUseID,
				},
			},
		}

		body, _ := json.Marshal(req)
		httpReq, _ := http.NewRequest("POST", baseURL+"/api/v1/mcp", bytes.NewBuffer(body))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-Session-ID", sessionID)

		resp, err := http.DefaultClient.Do(httpReq)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Should get immediate response due to auto-approval
		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)

		// Check that the approval was created and auto-approved
		var status, comment string
		err = db.QueryRow(`
			SELECT status, comment
			FROM approvals
			WHERE tool_use_id = ? AND session_id = ?
		`, toolUseID, sessionID).Scan(&status, &comment)
		require.NoError(t, err)

		assert.Equal(t, "approved", status)
		assert.Contains(t, comment, "dangerous skip permissions")

		// Verify response contains allow behavior
		if responseContent, ok := result["result"].(map[string]interface{}); ok {
			if content, ok := responseContent["content"].([]interface{}); ok && len(content) > 0 {
				if textContent, ok := content[0].(map[string]interface{}); ok {
					if text, ok := textContent["text"].(string); ok {
						var responseData map[string]interface{}
						json.Unmarshal([]byte(text), &responseData)
						assert.Equal(t, "allow", responseData["behavior"])
					}
				}
			}
		}

		// Disable dangerous skip for cleanup
		_, err = db.Exec(`
			UPDATE sessions
			SET dangerously_skip_permissions = 0
			WHERE id = ?
		`, sessionID)
		require.NoError(t, err)
	})

	t.Run("MultipleApprovalsDifferentToolUseIDs", func(t *testing.T) {
		// Create multiple approval requests with different tool_use_ids
		toolUseIDs := []string{"multi_1", "multi_2", "multi_3"}

		for _, toolUseID := range toolUseIDs {
			req := map[string]interface{}{
				"jsonrpc": "2.0",
				"id":      toolUseID,
				"method":  "tools/call",
				"params": map[string]interface{}{
					"name": "request_approval",
					"arguments": map[string]interface{}{
						"tool_name":   "multi_tool",
						"input":       map[string]interface{}{"id": toolUseID},
						"tool_use_id": toolUseID,
					},
				},
			}

			body, _ := json.Marshal(req)
			httpReq, _ := http.NewRequest("POST", baseURL+"/api/v1/mcp", bytes.NewBuffer(body))
			httpReq.Header.Set("Content-Type", "application/json")
			httpReq.Header.Set("X-Session-ID", sessionID)

			// Send requests in background
			go func() {
				client := &http.Client{Timeout: 1 * time.Second}
				client.Do(httpReq)
			}()
		}

		// Wait for approvals to be created
		time.Sleep(500 * time.Millisecond)

		// Verify all approvals were created with correct tool_use_ids
		for _, toolUseID := range toolUseIDs {
			var count int
			err := db.QueryRow(`
				SELECT COUNT(*) FROM approvals
				WHERE tool_use_id = ? AND session_id = ?
			`, toolUseID, sessionID).Scan(&count)
			require.NoError(t, err)
			assert.Equal(t, 1, count, "Expected approval for tool_use_id=%s", toolUseID)
		}

		// Verify total count
		var totalCount int
		err := db.QueryRow(`
			SELECT COUNT(*) FROM approvals
			WHERE tool_use_id IN ('multi_1', 'multi_2', 'multi_3')
			AND session_id = ?
		`, sessionID).Scan(&totalCount)
		require.NoError(t, err)
		assert.Equal(t, 3, totalCount, "Expected exactly 3 approvals")
	})
}

func TestMCPPhase4AutoDenyMode(t *testing.T) {
	// Set auto-deny mode
	os.Setenv("MCP_AUTO_DENY_ALL", "true")
	defer os.Unsetenv("MCP_AUTO_DENY_ALL")

	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp-phase4-autodeny")
	dbPath := testutil.DatabasePath(t, "mcp-phase4-autodeny")

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

	// Open database connection
	db, err := sql.Open("sqlite3", dbPath)
	require.NoError(t, err)
	defer db.Close()

	// Create a test session
	sessionID := "test-session-autodeny"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message
		) VALUES (
			?, 'run-autodeny', 'claude-autodeny', 'test query', 'claude-3-sonnet', '/tmp',
			'running', datetime('now'), datetime('now'), 0, 0, 10, '',
			'', 0.0, 0, 0, 0, 0, '', ''
		)
	`, sessionID)
	require.NoError(t, err)

	t.Run("AutoDenyDoesNotCreateApproval", func(t *testing.T) {
		// Send MCP approval request
		toolUseID := "test_autodeny"
		req := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "tools/call",
			"params": map[string]interface{}{
				"name": "request_approval",
				"arguments": map[string]interface{}{
					"tool_name":   "test_tool",
					"input":       map[string]interface{}{"test": "data"},
					"tool_use_id": toolUseID,
				},
			},
		}

		body, _ := json.Marshal(req)
		httpReq, _ := http.NewRequest("POST", baseURL+"/api/v1/mcp", bytes.NewBuffer(body))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-Session-ID", sessionID)

		resp, err := http.DefaultClient.Do(httpReq)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Should get immediate deny response
		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)

		// Verify deny response
		if responseContent, ok := result["result"].(map[string]interface{}); ok {
			if content, ok := responseContent["content"].([]interface{}); ok && len(content) > 0 {
				if textContent, ok := content[0].(map[string]interface{}); ok {
					if text, ok := textContent["text"].(string); ok {
						var responseData map[string]interface{}
						json.Unmarshal([]byte(text), &responseData)
						assert.Equal(t, "deny", responseData["behavior"])
						assert.Contains(t, responseData["message"], "Auto-denied")
					}
				}
			}
		}

		// Verify no approval was created in database
		var count int
		err = db.QueryRow(`
			SELECT COUNT(*) FROM approvals
			WHERE tool_use_id = ?
		`, toolUseID).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 0, count, "No approval should be created in auto-deny mode")
	})
}
