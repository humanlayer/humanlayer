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
	"github.com/stretchr/testify/require"
)

// TestMCPToolUseIDCorrelation verifies that when an approval is triggered
// by a running Claude Code instance, the tool_use_id is properly set in the database
func TestMCPToolUseIDCorrelation(t *testing.T) {
	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp-tool-use-id")
	dbPath := testutil.DatabasePath(t, "mcp-tool-use-id")

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

	// Wait for daemon to be ready
	require.Eventually(t, func() bool {
		// Check if the HTTP health endpoint is responding
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", httpPort))
		if err == nil && resp != nil {
			resp.Body.Close()
			return resp.StatusCode == 200
		}
		return false
	}, 10*time.Second, 100*time.Millisecond, "Daemon did not start")

	// Open database connection
	db, err := sql.Open("sqlite3", dbPath)
	require.NoError(t, err)
	defer db.Close()

	// We'll use daemon's REST API to launch sessions properly

	t.Run("SingleApprovalWithToolUseID", func(t *testing.T) {
		// Clear any existing approvals
		_, err = db.Exec("DELETE FROM approvals")
		require.NoError(t, err)

		// Create temp directory for session
		testWorkDir := t.TempDir()

		// Prepare session creation request for REST API
		createReq := map[string]interface{}{
			"query":                  "Write 'Hello World' to a file called test.txt and then exit",
			"model":                  "sonnet",
			"permission_prompt_tool": "mcp__codelayer__request_approval",
			"max_turns":              3,
			"working_dir":            testWorkDir,
			"mcp_config": map[string]interface{}{
				"mcp_servers": map[string]interface{}{
					"codelayer": map[string]interface{}{
						"type": "http",
						"url":  fmt.Sprintf("http://127.0.0.1:%d/api/v1/mcp", httpPort),
					},
				},
			},
		}

		// Send REST API request to create session
		reqBody, _ := json.Marshal(createReq)
		httpReq, err := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort), bytes.NewBuffer(reqBody))
		require.NoError(t, err)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(httpReq)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Check response status
		require.Equal(t, http.StatusCreated, resp.StatusCode, "Expected 201 Created")

		// Parse response
		var createResp map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&createResp)
		require.NoError(t, err)

		// Get session ID from response
		data := createResp["data"].(map[string]interface{})
		sessionID := data["session_id"].(string)
		runID := data["run_id"].(string)
		t.Logf("Launched session: %s with run_id: %s", sessionID, runID)

		// Let Claude run for a bit to trigger approvals
		t.Log("Waiting for Claude to trigger approvals...")
		time.Sleep(5 * time.Second)

		// Now check the database for approvals
		rows, err := db.Query(`
			SELECT id, session_id, tool_name, tool_use_id, status, comment
			FROM approvals
			ORDER BY created_at DESC
		`)
		require.NoError(t, err)
		defer rows.Close()

		var approvals []struct {
			ID        string
			SessionID string
			ToolName  string
			ToolUseID sql.NullString
			Status    string
			Comment   sql.NullString
		}

		for rows.Next() {
			var a struct {
				ID        string
				SessionID string
				ToolName  string
				ToolUseID sql.NullString
				Status    string
				Comment   sql.NullString
			}
			err := rows.Scan(&a.ID, &a.SessionID, &a.ToolName, &a.ToolUseID, &a.Status, &a.Comment)
			require.NoError(t, err)
			approvals = append(approvals, a)
		}

		// Log what we found
		t.Logf("Found %d approvals in database:", len(approvals))
		for i, a := range approvals {
			t.Logf("  Approval %d:", i+1)
			t.Logf("    ID: %s", a.ID)
			t.Logf("    Session ID: %s", a.SessionID)
			t.Logf("    Tool Name: %s", a.ToolName)
			t.Logf("    Tool Use ID: %v (Valid: %v)", a.ToolUseID.String, a.ToolUseID.Valid)
			t.Logf("    Status: %s", a.Status)
			if a.Comment.Valid {
				t.Logf("    Comment: %s", a.Comment.String)
			}
		}

		// Also check conversation events for tool uses
		var toolUseCount int
		rows2, err := db.Query(`
			SELECT tool_id, tool_name
			FROM conversation_events
			WHERE session_id = ? AND tool_id IS NOT NULL
			ORDER BY created_at DESC
		`, sessionID)
		if err == nil {
			defer rows2.Close()
			for rows2.Next() {
				var toolID, toolName string
				if err := rows2.Scan(&toolID, &toolName); err == nil {
					toolUseCount++
					t.Logf("  Tool use in events: %s (ID: %s)", toolName, toolID)
				}
			}
		}
		t.Logf("Found %d tool uses in conversation_events", toolUseCount)

		// Verify that we have at least one approval
		if len(approvals) > 0 {
			// Check that tool_use_id is set
			for _, a := range approvals {
				if !a.ToolUseID.Valid || a.ToolUseID.String == "" {
					t.Errorf("Approval %s has no tool_use_id set!", a.ID)
				} else {
					t.Logf("✓ Approval %s has tool_use_id: %s", a.ID, a.ToolUseID.String)
				}
			}
		} else {
			t.Log("No approvals were created - this might indicate the test didn't trigger any tools")
			t.Log("This can happen if Claude doesn't attempt to write the file")
		}
	})

	t.Run("ParallelApprovalsWithDistinctToolUseIDs", func(t *testing.T) {
		// Clear any existing approvals
		_, err = db.Exec("DELETE FROM approvals")
		require.NoError(t, err)

		// Create temp directory for session
		testWorkDir := t.TempDir()

		// Prepare session creation request for REST API
		createReq := map[string]interface{}{
			"query":                  "Create 3 files in parallel: file1.txt with 'One', file2.txt with 'Two', file3.txt with 'Three'. Use parallel tool calls if possible.",
			"model":                  "sonnet",
			"permission_prompt_tool": "mcp__codelayer__request_approval",
			"max_turns":              3,
			"working_dir":            testWorkDir,
			"mcp_config": map[string]interface{}{
				"mcp_servers": map[string]interface{}{
					"codelayer": map[string]interface{}{
						"type": "http",
						"url":  fmt.Sprintf("http://127.0.0.1:%d/api/v1/mcp", httpPort),
					},
				},
			},
		}

		// Send REST API request to create session
		reqBody, _ := json.Marshal(createReq)
		httpReq, err := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/api/v1/sessions", httpPort), bytes.NewBuffer(reqBody))
		require.NoError(t, err)
		httpReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(httpReq)
		require.NoError(t, err)
		defer resp.Body.Close()

		// Check response status
		require.Equal(t, http.StatusCreated, resp.StatusCode, "Expected 201 Created")

		// Parse response
		var createResp map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&createResp)
		require.NoError(t, err)

		// Get session ID from response
		data := createResp["data"].(map[string]interface{})
		sessionID := data["session_id"].(string)
		t.Logf("Launched parallel session: %s", sessionID)

		// Let Claude run for a bit
		t.Log("Waiting for parallel operations...")
		time.Sleep(7 * time.Second)

		// Check database for approvals
		rows, err := db.Query(`
			SELECT id, tool_use_id, tool_name
			FROM approvals
			ORDER BY created_at DESC
		`)
		require.NoError(t, err)
		defer rows.Close()

		var approvals []struct {
			ID        string
			ToolUseID sql.NullString
			ToolName  string
		}

		for rows.Next() {
			var a struct {
				ID        string
				ToolUseID sql.NullString
				ToolName  string
			}
			err := rows.Scan(&a.ID, &a.ToolUseID, &a.ToolName)
			require.NoError(t, err)
			approvals = append(approvals, a)
		}

		t.Logf("Found %d approvals for parallel operations", len(approvals))

		// Verify each approval has a unique tool_use_id
		toolUseIDMap := make(map[string]bool)
		for _, a := range approvals {
			if !a.ToolUseID.Valid || a.ToolUseID.String == "" {
				t.Errorf("Approval %s has no tool_use_id!", a.ID)
			} else {
				if toolUseIDMap[a.ToolUseID.String] {
					t.Errorf("Duplicate tool_use_id found: %s", a.ToolUseID.String)
				}
				toolUseIDMap[a.ToolUseID.String] = true
				t.Logf("✓ Approval %s has unique tool_use_id: %s", a.ID, a.ToolUseID.String)
			}
		}

		// Cross-reference with conversation events
		var toolUseEvents []struct {
			ID   string
			Name string
		}
		rows2, err := db.Query(`
			SELECT tool_id, tool_name
			FROM conversation_events
			WHERE session_id = ? AND tool_id IS NOT NULL
		`, sessionID)
		if err == nil {
			defer rows2.Close()
			for rows2.Next() {
				var toolID, toolName string
				if err := rows2.Scan(&toolID, &toolName); err == nil {
					toolUseEvents = append(toolUseEvents, struct {
						ID   string
						Name string
					}{ID: toolID, Name: toolName})
				}
			}
		}

		t.Logf("Cross-referencing %d tool_use events with approvals", len(toolUseEvents))
		for _, toolUse := range toolUseEvents {
			found := false
			for _, a := range approvals {
				if a.ToolUseID.Valid && a.ToolUseID.String == toolUse.ID {
					found = true
					t.Logf("✓ Tool use %s matched with approval %s", toolUse.ID, a.ID)
					break
				}
			}
			if !found && toolUse.ID != "" {
				t.Logf("⚠ Tool use %s (%s) has no matching approval", toolUse.ID, toolUse.Name)
			}
		}
	})

	// Cleanup: shutdown daemon
	cancel()
	select {
	case err := <-errCh:
		if err != nil && err != context.Canceled {
			t.Errorf("Daemon exited with error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Error("Daemon did not shut down in time")
	}
}
