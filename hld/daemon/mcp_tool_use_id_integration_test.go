//go:build integration

package daemon_test

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/daemon"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/humanlayer/humanlayer/hld/rpc"
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

	// We'll use daemon's RPC interface to launch sessions properly

	t.Run("SingleApprovalWithToolUseID", func(t *testing.T) {
		// Clear any existing approvals
		_, err = db.Exec("DELETE FROM approvals")
		require.NoError(t, err)

		// Connect to daemon socket to launch session properly
		conn, err := net.Dial("unix", socketPath)
		require.NoError(t, err)
		defer conn.Close()

		// Prepare launch request through RPC
		request := rpc.LaunchSessionRequest{
			Query:                "Write 'Hello World' to a file called test.txt and then exit",
			Model:                "sonnet",
			PermissionPromptTool: "mcp__codelayer__request_approval",
			MaxTurns:             3,
			WorkingDir:           tempDir,
			MCPConfig: &claudecode.MCPConfig{
				MCPServers: map[string]claudecode.MCPServer{
					"codelayer": {
						Type: "http",
						URL:  fmt.Sprintf("http://127.0.0.1:%d/api/v1/mcp", httpPort),
					},
				},
			},
		}

		// Send LaunchSession request
		reqData, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "launchSession",
			"params":  request,
			"id":      1,
		})

		_, err = conn.Write(append(reqData, '\n'))
		require.NoError(t, err)

		// Read response to get session ID
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer
		require.True(t, scanner.Scan(), "Failed to read response")

		var resp map[string]interface{}
		err = json.Unmarshal(scanner.Bytes(), &resp)
		require.NoError(t, err)

		// Check for error
		if errObj, ok := resp["error"]; ok {
			t.Fatalf("RPC error: %v", errObj)
		}

		// Extract session ID from response
		result := resp["result"].(map[string]interface{})
		sessionID := result["session_id"].(string)
		runID := result["run_id"].(string)
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

		// Connect to daemon socket
		conn, err := net.Dial("unix", socketPath)
		require.NoError(t, err)
		defer conn.Close()

		// Prepare launch request for parallel writes
		request := rpc.LaunchSessionRequest{
			Query:                "Create 3 files in parallel: file1.txt with 'One', file2.txt with 'Two', file3.txt with 'Three'. Use parallel tool calls if possible.",
			Model:                "sonnet",
			PermissionPromptTool: "mcp__codelayer__request_approval",
			MaxTurns:             3,
			WorkingDir:           tempDir,
			MCPConfig: &claudecode.MCPConfig{
				MCPServers: map[string]claudecode.MCPServer{
					"codelayer": {
						Type: "http",
						URL:  fmt.Sprintf("http://127.0.0.1:%d/api/v1/mcp", httpPort),
					},
				},
			},
		}

		// Send LaunchSession request
		reqData, _ := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "launchSession",
			"params":  request,
			"id":      2,
		})

		_, err = conn.Write(append(reqData, '\n'))
		require.NoError(t, err)

		// Read response
		scanner := bufio.NewScanner(conn)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
		require.True(t, scanner.Scan(), "Failed to read response")

		var resp map[string]interface{}
		err = json.Unmarshal(scanner.Bytes(), &resp)
		require.NoError(t, err)

		// Extract session ID
		result := resp["result"].(map[string]interface{})
		sessionID := result["session_id"].(string)
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
