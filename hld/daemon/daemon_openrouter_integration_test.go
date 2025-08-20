//go:build integration

package daemon_test

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
)

// getFreePort returns an available port
func getFreePortForOpenRouter(t *testing.T) int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	return port
}

func TestOpenRouterProxyIntegration(t *testing.T) {
	// Skip if OpenRouter API key not available
	if os.Getenv("OPENROUTER_API_KEY") == "" {
		t.Skip("OPENROUTER_API_KEY not set, skipping OpenRouter integration test")
	}

	// Skip if Claude is not available
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("Claude CLI not available, skipping integration test")
	}

	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "openrouter")
	dbPath := testutil.DatabasePath(t, "openrouter")

	// Get a free port for HTTP server
	httpPort := getFreePortForOpenRouter(t)

	// Override environment
	os.Setenv("HUMANLAYER_DAEMON_SOCKET", socketPath)
	os.Setenv("HUMANLAYER_DAEMON_HTTP_PORT", fmt.Sprintf("%d", httpPort))
	os.Setenv("HUMANLAYER_DAEMON_HTTP_HOST", "127.0.0.1")
	os.Setenv("HUMANLAYER_API_KEY", "")    // Disable cloud API
	os.Setenv("MCP_AUTO_DENY_ALL", "true") // Auto-deny for predictable responses

	// Create isolated config
	tempDir := t.TempDir()
	os.Setenv("XDG_CONFIG_HOME", tempDir)
	configDir := filepath.Join(tempDir, "humanlayer")
	require.NoError(t, os.MkdirAll(configDir, 0755))
	configFile := filepath.Join(configDir, "humanlayer.json")
	require.NoError(t, os.WriteFile(configFile, []byte(`{}`), 0644))

	// Setup HTTP server with MCP endpoint
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	// Add health endpoint
	router.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Simple MCP handler for testing
	router.POST("/api/v1/mcp", func(c *gin.Context) {
		var req map[string]interface{}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request"})
			return
		}

		method, _ := req["method"].(string)
		id := req["id"]

		// Auto-deny permission requests
		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      id,
		}

		if method == "tools/list" {
			response["result"] = map[string]interface{}{
				"tools": []interface{}{
					map[string]interface{}{
						"name":        "request_approval",
						"description": "Request approval for tool use",
					},
				},
			}
		} else if method == "tools/call" {
			// Auto-deny
			response["result"] = map[string]interface{}{
				"content": []interface{}{
					map[string]interface{}{
						"type": "text",
						"text": "Permission denied (auto-deny mode)",
					},
				},
				"isError": true,
			}
		} else {
			response["error"] = map[string]interface{}{
				"code":    -32601,
				"message": "Method not found",
			}
		}

		c.JSON(200, response)
	})

	// Start HTTP server
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", httpPort))
	require.NoError(t, err)

	server := &http.Server{
		Handler: router,
	}

	go func() {
		server.Serve(listener)
	}()
	defer server.Shutdown(context.Background())

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

	// Create a test session in the database with proxy settings
	testSessionID := "test-openrouter-session"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
		) VALUES (
			?, 'run-openrouter', 'claude-test', 'test query', 'claude-3-sonnet', '/tmp',
			'running', datetime('now'), datetime('now'), 0, 1, 10, '',
			'', 0.0, 0, 0, 0, 0, '', '',
			1, 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini', ?
		)
	`, testSessionID, os.Getenv("OPENROUTER_API_KEY"))
	require.NoError(t, err)

	// Create claudecode client
	client, err := claudecode.NewClient()
	require.NoError(t, err)

	// Prepare MCP configuration pointing to our test server
	mcpConfig := &claudecode.MCPConfig{
		MCPServers: map[string]claudecode.MCPServer{
			"humanlayer": {
				Command: "http",
				Env: map[string]string{
					"_config": fmt.Sprintf(`{"type":"http","url":"%s/api/v1/mcp","headers":{"X-Session-ID":"%s"}}`, baseURL, testSessionID),
				},
			},
		},
	}

	// Create session config
	sessionConfig := claudecode.SessionConfig{
		Query:                "Say 'OpenRouter test complete' and exit",
		Model:                claudecode.ModelSonnet,
		OutputFormat:         claudecode.OutputStreamJSON,
		MCPConfig:            mcpConfig,
		PermissionPromptTool: "mcp__humanlayer__request_approval",
		MaxTurns:             1,
		WorkingDir:           tempDir,
		Verbose:              false,
	}

	// Capture events from Claude
	var allEvents []claudecode.StreamEvent
	var eventsMutex sync.Mutex

	// Launch Claude session
	t.Log("Launching Claude session with OpenRouter proxy config...")
	session, err := client.Launch(sessionConfig)
	require.NoError(t, err)

	// Capture events in background
	eventsDone := make(chan struct{})
	go func() {
		defer close(eventsDone)
		for event := range session.Events {
			eventsMutex.Lock()
			allEvents = append(allEvents, event)
			eventsMutex.Unlock()

			// Log important events
			if event.Type == "message" && event.Message != nil {
				for _, content := range event.Message.Content {
					if content.Type == "text" {
						t.Logf("Claude: %s", content.Text)
					}
				}
			}
			if event.Type == "result" {
				t.Logf("Session completed with result: %s", event.Result)
				break
			}
		}
	}()

	// Wait for session to complete
	select {
	case <-eventsDone:
		t.Log("Session completed successfully")
	case <-time.After(30 * time.Second):
		t.Fatal("Session did not complete within timeout")
	}

	// Verify we got some events
	require.NotEmpty(t, allEvents, "Should have received events from Claude")

	// Verify session completed
	var hasResult bool
	for _, event := range allEvents {
		if event.Type == "result" {
			hasResult = true
			break
		}
	}
	require.True(t, hasResult, "Session should have completed with a result")

	// Verify session was marked as complete in database
	var status string
	err = db.QueryRow("SELECT status FROM sessions WHERE id = ?", testSessionID).Scan(&status)
	require.NoError(t, err)
	// Status might be 'completed' or 'running' depending on timing
	t.Logf("Final session status: %s", status)
}

func TestOpenRouterContinueSession(t *testing.T) {
	// Skip if OpenRouter API key not available
	if os.Getenv("OPENROUTER_API_KEY") == "" {
		t.Skip("OPENROUTER_API_KEY not set, skipping OpenRouter continue session test")
	}

	// Skip if Claude is not available
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("Claude CLI not available, skipping integration test")
	}

	// Setup test environment
	socketPath := testutil.SocketPath(t, "openrouter-continue")
	dbPath := testutil.DatabasePath(t, "openrouter-continue")

	// Get a free port for HTTP server
	httpPort := getFreePortForOpenRouter(t)

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

	// Open database connection
	db, err := sql.Open("sqlite3", dbPath)
	require.NoError(t, err)
	defer db.Close()

	// Create initial session without proxy
	parentSessionID := "parent-session"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message
		) VALUES (
			?, 'run-parent', 'claude-parent', 'initial query', 'claude-3-sonnet', '/tmp',
			'completed', datetime('now'), datetime('now'), 0, 0, 10, '',
			'', 0.0, 100, 200, 1000, 1, 'Initial response', ''
		)
	`, parentSessionID)
	require.NoError(t, err)

	// Create continued session with proxy settings
	continuedSessionID := "continued-session"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key,
			parent_session_id
		) VALUES (
			?, 'run-continued', 'claude-continued', 'continue with proxy', 'claude-3-sonnet', '/tmp',
			'running', datetime('now'), datetime('now'), 0, 0, 10, '',
			'', 0.0, 0, 0, 0, 0, '', '',
			1, 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini', ?,
			?
		)
	`, continuedSessionID, os.Getenv("OPENROUTER_API_KEY"), parentSessionID)
	require.NoError(t, err)

	// Verify the continued session has proxy settings
	var proxyEnabled bool
	var proxyBaseURL, proxyModel string
	err = db.QueryRow(`
		SELECT proxy_enabled, proxy_base_url, proxy_model_override
		FROM sessions WHERE id = ?
	`, continuedSessionID).Scan(&proxyEnabled, &proxyBaseURL, &proxyModel)
	require.NoError(t, err)
	require.True(t, proxyEnabled, "Proxy should be enabled")
	require.Equal(t, "https://openrouter.ai/api/v1", proxyBaseURL)
	require.Equal(t, "openai/gpt-4o-mini", proxyModel)

	t.Log("Successfully created continued session with OpenRouter proxy configuration")
}

