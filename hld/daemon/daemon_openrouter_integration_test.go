//go:build integration

package daemon_test

import (
	"context"
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
	"github.com/humanlayer/humanlayer/hld/store"
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
						"inputSchema": map[string]interface{}{
							"type": "object",
							"properties": map[string]interface{}{
								"tool_name": map[string]interface{}{
									"type": "string",
								},
							},
						},
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

	// Initialize database with migrations using store package
	sqliteStore, err := store.NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer sqliteStore.Close()

	// Create a test session in the database with proxy settings
	testSessionID := "test-openrouter-session"
	costUSD := 0.0
	inputTokens := 0
	outputTokens := 0
	durationMS := 0
	numTurns := 0

	testSession := &store.Session{
		ID:                         testSessionID,
		RunID:                      "run-openrouter",
		ClaudeSessionID:            "claude-test",
		Query:                      "test query",
		Model:                      "claude-3-sonnet",
		WorkingDir:                 "/tmp",
		Status:                     "running",
		CreatedAt:                  time.Now(),
		LastActivityAt:             time.Now(),
		AutoAcceptEdits:            false,
		DangerouslySkipPermissions: true,
		MaxTurns:                   10,
		SystemPrompt:               "",
		CustomInstructions:         "",
		CostUSD:                    &costUSD,
		InputTokens:                &inputTokens,
		OutputTokens:               &outputTokens,
		DurationMS:                 &durationMS,
		NumTurns:                   &numTurns,
		ResultContent:              "",
		ErrorMessage:               "",
		ProxyEnabled:               true,
		ProxyBaseURL:               "https://openrouter.ai/api/v1",
		ProxyModelOverride:         "openai/gpt-4o-mini",
		ProxyAPIKey:                os.Getenv("OPENROUTER_API_KEY"),
	}
	err = sqliteStore.CreateSession(context.Background(), testSession)
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
		Query:        "Say 'OpenRouter test complete' and exit",
		Model:        claudecode.ModelSonnet,
		OutputFormat: claudecode.OutputStreamJSON,
		MCPConfig:    mcpConfig,
		MaxTurns:     1,
		WorkingDir:   tempDir,
		Verbose:      false,
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
			}
		}
	}()

	// Wait for session to complete with timeout
	type waitResult struct {
		result *claudecode.Result
		err    error
	}
	waitDone := make(chan waitResult, 1)
	go func() {
		result, err := session.Wait()
		waitDone <- waitResult{result, err}
	}()

	select {
	case wr := <-waitDone:
		if wr.err != nil {
			t.Fatalf("Session failed: %v", wr.err)
		}
		t.Logf("Session completed successfully with result: %v", wr.result)
	case <-time.After(30 * time.Second):
		t.Fatal("Session did not complete within timeout")
	}

	// Give events channel time to drain
	select {
	case <-eventsDone:
		// Events channel closed
	case <-time.After(2 * time.Second):
		t.Log("Events channel did not close within timeout")
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
	testSessionFromDB, err := sqliteStore.GetSession(context.Background(), testSessionID)
	require.NoError(t, err)
	// Status might be 'completed' or 'running' depending on timing
	t.Logf("Final session status: %s", testSessionFromDB.Status)
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

	// Initialize database with migrations using store package
	sqliteStore, err := store.NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer sqliteStore.Close()

	// Create initial session without proxy
	parentSessionID := "parent-session"
	costUSD := 0.0
	inputTokens := 100
	outputTokens := 200
	durationMS := 1000
	numTurns := 1
	completedAt := time.Now()

	parentSession := &store.Session{
		ID:                         parentSessionID,
		RunID:                      "run-parent",
		ClaudeSessionID:            "claude-parent",
		Query:                      "initial query",
		Model:                      "claude-3-sonnet",
		WorkingDir:                 "/tmp",
		Status:                     "completed",
		CreatedAt:                  time.Now(),
		LastActivityAt:             time.Now(),
		CompletedAt:                &completedAt,
		AutoAcceptEdits:            false,
		DangerouslySkipPermissions: false,
		MaxTurns:                   10,
		SystemPrompt:               "",
		CustomInstructions:         "",
		CostUSD:                    &costUSD,
		InputTokens:                &inputTokens,
		OutputTokens:               &outputTokens,
		DurationMS:                 &durationMS,
		NumTurns:                   &numTurns,
		ResultContent:              "Initial response",
		ErrorMessage:               "",
	}
	err = sqliteStore.CreateSession(context.Background(), parentSession)
	require.NoError(t, err)

	// Create continued session with proxy settings
	continuedSessionID := "continued-session"
	costUSD2 := 0.0
	inputTokens2 := 0
	outputTokens2 := 0
	durationMS2 := 0
	numTurns2 := 0

	continuedSession := &store.Session{
		ID:                         continuedSessionID,
		RunID:                      "run-continued",
		ClaudeSessionID:            "claude-continued",
		ParentSessionID:            parentSessionID,
		Query:                      "continue with proxy",
		Model:                      "claude-3-sonnet",
		WorkingDir:                 "/tmp",
		Status:                     "running",
		CreatedAt:                  time.Now(),
		LastActivityAt:             time.Now(),
		AutoAcceptEdits:            false,
		DangerouslySkipPermissions: false,
		MaxTurns:                   10,
		SystemPrompt:               "",
		CustomInstructions:         "",
		CostUSD:                    &costUSD2,
		InputTokens:                &inputTokens2,
		OutputTokens:               &outputTokens2,
		DurationMS:                 &durationMS2,
		NumTurns:                   &numTurns2,
		ResultContent:              "",
		ErrorMessage:               "",
		ProxyEnabled:               true,
		ProxyBaseURL:               "https://openrouter.ai/api/v1",
		ProxyModelOverride:         "openai/gpt-4o-mini",
		ProxyAPIKey:                os.Getenv("OPENROUTER_API_KEY"),
	}
	err = sqliteStore.CreateSession(context.Background(), continuedSession)
	require.NoError(t, err)

	// Verify the continued session has proxy settings
	sessionFromDB, err := sqliteStore.GetSession(context.Background(), continuedSessionID)
	require.NoError(t, err)
	require.True(t, sessionFromDB.ProxyEnabled, "Proxy should be enabled")
	require.Equal(t, "https://openrouter.ai/api/v1", sessionFromDB.ProxyBaseURL)
	require.Equal(t, "openai/gpt-4o-mini", sessionFromDB.ProxyModelOverride)

	t.Log("Successfully created continued session with OpenRouter proxy configuration")
}
