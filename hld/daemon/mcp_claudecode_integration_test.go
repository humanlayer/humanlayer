//go:build integration

package daemon_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
)

// MCPRequestLog captures all details of an MCP request
type MCPRequestLog struct {
	Method    string
	Path      string
	Headers   map[string][]string
	Body      json.RawMessage
	Timestamp time.Time
	RequestID int
}

// MCPTestServer wraps the real MCP server and logs all requests
type MCPTestServer struct {
	realHandler   http.Handler
	requests      []MCPRequestLog
	requestsMutex sync.Mutex
	requestCount  int
}

func (s *MCPTestServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Capture request details
	s.requestsMutex.Lock()
	s.requestCount++
	requestID := s.requestCount

	// Read body for logging
	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes)) // Reset body for real handler

	// Log all headers
	headersCopy := make(map[string][]string)
	for k, v := range r.Header {
		headersCopy[k] = v
	}

	log := MCPRequestLog{
		Method:    r.Method,
		Path:      r.URL.Path,
		Headers:   headersCopy,
		Body:      bodyBytes,
		Timestamp: time.Now(),
		RequestID: requestID,
	}
	s.requests = append(s.requests, log)
	s.requestsMutex.Unlock()

	// Log request details to test output
	fmt.Printf("\n[MCP Request #%d] %s %s\n", requestID, r.Method, r.URL.Path)
	fmt.Printf("Headers:\n")
	for k, v := range r.Header {
		fmt.Printf("  %s: %s\n", k, strings.Join(v, ", "))
	}
	if len(bodyBytes) > 0 {
		fmt.Printf("Body: %s\n", string(bodyBytes))
	}
	fmt.Printf("---\n")

	// Forward to real handler
	s.realHandler.ServeHTTP(w, r)
}

func (s *MCPTestServer) GetRequests() []MCPRequestLog {
	s.requestsMutex.Lock()
	defer s.requestsMutex.Unlock()
	return append([]MCPRequestLog{}, s.requests...)
}

func TestMCPClaudeCodeSessionIDCorrelation(t *testing.T) {
	// Skip if Claude is not available
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("Claude CLI not available, skipping integration test")
	}

	// Setup isolated environment
	socketPath := testutil.SocketPath(t, "mcp-claudecode")
	dbPath := testutil.DatabasePath(t, "mcp-claudecode")

	// Get a free port for HTTP server
	httpPort := getFreePort(t)

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

	// Create MCP test server wrapper
	mcpTestServer := &MCPTestServer{
		requests: []MCPRequestLog{},
	}

	// Custom HTTP server setup to wrap MCP handler
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	// Add health endpoint
	router.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Wrap MCP endpoint with test server
	router.Any("/api/v1/mcp", func(c *gin.Context) {
		// First time setup - get real handler from daemon
		if mcpTestServer.realHandler == nil {
			// Get the real MCP handler from daemon
			// We'll create a simple MCP handler that auto-denies
			mcpTestServer.realHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Simple MCP response for testing
				var req map[string]interface{}
				json.NewDecoder(r.Body).Decode(&req)

				method, _ := req["method"].(string)
				id := req["id"]

				response := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      id,
				}

				switch method {
				case "initialize":
					response["result"] = map[string]interface{}{
						"protocolVersion": "2025-03-26",
						"serverInfo": map[string]interface{}{
							"name":    "test-mcp-server",
							"version": "1.0.0",
						},
						"capabilities": map[string]interface{}{
							"tools": map[string]interface{}{},
						},
					}
				case "tools/list":
					response["result"] = map[string]interface{}{
						"tools": []interface{}{
							map[string]interface{}{
								"name":        "request_approval",
								"description": "Request permission to execute a tool",
								"inputSchema": map[string]interface{}{
									"type": "object",
									"properties": map[string]interface{}{
										"tool_name":   map[string]string{"type": "string"},
										"input":       map[string]string{"type": "object"},
										"tool_use_id": map[string]string{"type": "string"},
									},
									"required": []string{"tool_name", "input", "tool_use_id"},
								},
							},
						},
					}
				case "tools/call":
					// Auto-deny
					response["result"] = map[string]interface{}{
						"content": []interface{}{
							map[string]interface{}{
								"type": "text",
								"text": `{"behavior": "deny", "message": "Auto-denied for testing"}`,
							},
						},
					}
				default:
					response["error"] = map[string]interface{}{
						"code":    -32601,
						"message": "Method not found",
					}
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(response)
			})
		}

		mcpTestServer.ServeHTTP(c.Writer, c.Request)
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

	// Run database migrations first
	// Create the sessions table schema
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			claude_session_id TEXT,
			parent_session_id TEXT,
			query TEXT,
			summary TEXT,
			title TEXT,
			model TEXT,
			model_id TEXT,
			working_dir TEXT,
			status TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_activity_at DATETIME,
			completed_at DATETIME,
			auto_accept_edits INTEGER DEFAULT 0,
			dangerously_skip_permissions INTEGER DEFAULT 0,
			dangerously_skip_permissions_expires_at DATETIME,
			max_turns INTEGER,
			system_prompt TEXT,
			append_system_prompt TEXT,
			custom_instructions TEXT,
			permission_prompt_tool TEXT,
			allowed_tools TEXT,
			disallowed_tools TEXT,
			additional_directories TEXT,
			cost_usd REAL,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cache_creation_input_tokens INTEGER DEFAULT 0,
			cache_read_input_tokens INTEGER DEFAULT 0,
			effective_context_tokens INTEGER DEFAULT 0,
			duration_ms INTEGER,
			num_turns INTEGER,
			result_content TEXT,
			error_message TEXT,
			archived INTEGER DEFAULT 0,
			proxy_enabled INTEGER DEFAULT 0,
			proxy_base_url TEXT,
			proxy_model_override TEXT,
			proxy_api_key TEXT
		)
	`)
	require.NoError(t, err)

	// Create a test session in the database
	testSessionID := "test-claudecode-session"
	_, err = db.Exec(`
		INSERT INTO sessions (
			id, run_id, claude_session_id, query, model, working_dir,
			status, created_at, last_activity_at, auto_accept_edits,
			dangerously_skip_permissions, max_turns, system_prompt,
			custom_instructions, cost_usd, input_tokens, output_tokens,
			duration_ms, num_turns, result_content, error_message
		) VALUES (
			?, 'run-claudecode', 'claude-test', 'test query', 'claude-3-sonnet', '/tmp',
			'running', datetime('now'), datetime('now'), 0, 1, 10, '',
			'', 0.0, 0, 0, 0, 0, '', ''
		)
	`, testSessionID)
	require.NoError(t, err)

	// Create claudecode client
	client, err := claudecode.NewClient()
	require.NoError(t, err)

	// Prepare MCP configuration
	// The claudecode client will write this to a temp file and pass it to claude
	// We need to match the format claude expects for HTTP MCP servers
	mcpConfig := &claudecode.MCPConfig{
		MCPServers: map[string]claudecode.MCPServer{
			"humanlayer": {
				Command: "http", // This is just a placeholder
				Env: map[string]string{
					// The actual config will be written as JSON with type/url/headers
					"_config": fmt.Sprintf(`{"type":"http","url":"%s/api/v1/mcp","headers":{"X-Session-ID":"%s"}}`, baseURL, testSessionID),
				},
			},
		},
	}

	// Create session config
	sessionConfig := claudecode.SessionConfig{
		Query:                "Say 'test complete' and exit",
		Model:                claudecode.ModelSonnet,
		OutputFormat:         claudecode.OutputStreamJSON,
		MCPConfig:            mcpConfig,
		PermissionPromptTool: "mcp__humanlayer__request_approval",
		MaxTurns:             1,
		WorkingDir:           tempDir,
		Verbose:              true,
	}

	// Capture events from Claude
	var allEvents []claudecode.StreamEvent
	var eventsMutex sync.Mutex

	// Launch Claude session
	t.Log("Launching Claude session with MCP config...")
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

			// Log significant events
			switch event.Type {
			case "system":
				if event.Subtype == "init" {
					t.Logf("Claude session initialized: ID=%s, Model=%s", event.SessionID, event.Model)
				}
			case "mcp_servers":
				for _, server := range event.MCPServers {
					t.Logf("MCP Server %s: %s", server.Name, server.Status)
				}
			case "result":
				t.Logf("Session completed: ID=%s, Error=%v", event.SessionID, event.IsError)
			}
		}
	}()

	// Wait for session to complete (with timeout)
	done := make(chan struct{})
	go func() {
		defer close(done)
		result, err := session.Wait()
		if err != nil {
			t.Logf("Session error: %v", err)
		} else if result != nil {
			t.Logf("Session result: %s", result.Result)
		}
	}()

	select {
	case <-done:
		// Session completed
	case <-time.After(30 * time.Second):
		t.Log("Session timeout, interrupting...")
		session.Interrupt()
		<-done
	}

	// Wait for events to be processed
	<-eventsDone

	// Analyze captured MCP requests
	requests := mcpTestServer.GetRequests()
	t.Logf("\n=== MCP Request Analysis ===")
	t.Logf("Total MCP requests: %d", len(requests))

	// Check for session ID in headers
	sessionIDFound := false
	var sessionIDHeaders []string

	for i, req := range requests {
		t.Logf("\nRequest #%d: %s", i+1, req.Method)

		// Check various possible session ID headers
		possibleHeaders := []string{
			"X-Session-ID",
			"X-Session-Id",
			"Session-ID",
			"Session-Id",
			"Mcp-Session-Id",
			"MCP-Session-ID",
		}

		for _, header := range possibleHeaders {
			if values, ok := req.Headers[header]; ok && len(values) > 0 {
				sessionIDFound = true
				sessionIDHeaders = append(sessionIDHeaders, fmt.Sprintf("%s: %s", header, values[0]))
				t.Logf("  ✓ Found session ID header: %s = %s", header, values[0])
			}
		}

		// Check if session ID is in the request body
		if len(req.Body) > 0 {
			var body map[string]interface{}
			if err := json.Unmarshal(req.Body, &body); err == nil {
				if sessionID, ok := body["session_id"].(string); ok && sessionID != "" {
					t.Logf("  ✓ Found session_id in body: %s", sessionID)
				}
				if params, ok := body["params"].(map[string]interface{}); ok {
					if sessionID, ok := params["session_id"].(string); ok && sessionID != "" {
						t.Logf("  ✓ Found session_id in params: %s", sessionID)
					}
				}
			}
		}
	}

	// Analyze Claude events for session information
	t.Logf("\n=== Claude Event Analysis ===")
	t.Logf("Total events captured: %d", len(allEvents))

	var claudeSessionID string
	for _, event := range allEvents {
		if event.SessionID != "" && claudeSessionID == "" {
			claudeSessionID = event.SessionID
			t.Logf("Claude session ID from events: %s", claudeSessionID)
		}
	}

	// Final verdict
	t.Logf("\n=== VERDICT ===")
	if sessionIDFound {
		t.Logf("✓ Session ID IS sent in MCP request headers")
		t.Logf("  Headers found: %s", strings.Join(sessionIDHeaders, ", "))
		t.Logf("  Current implementation should work correctly")
	} else {
		t.Logf("✗ Session ID is NOT sent in MCP request headers")
		t.Logf("  Claude session ID: %s", claudeSessionID)
		t.Logf("  Need to implement alternative correlation mechanism")
		t.Logf("  Possible solutions:")
		t.Logf("    1. Use MCP session initialization to establish mapping")
		t.Logf("    2. Pass session ID in MCP server URL path")
		t.Logf("    3. Use a unique MCP server per session")
	}

	// Assert findings
	if !sessionIDFound {
		t.Error("Session ID is not being sent in MCP request headers - implementation needs revision")

		// Provide detailed recommendations
		t.Log("\nRECOMMENDED CHANGES:")
		t.Log("1. Remove reliance on Session-ID header in MCP server")
		t.Log("2. Consider embedding session ID in MCP server URL:")
		t.Log("   - Change URL to: /api/v1/mcp/{session_id}")
		t.Log("   - Extract session ID from URL path in handler")
		t.Log("3. Or use MCP session correlation:")
		t.Log("   - Track MCP session ID from initialize method")
		t.Log("   - Map MCP session to HumanLayer session")
	}

	// Additional diagnostics
	t.Logf("\n=== Additional Diagnostics ===")
	if len(requests) > 0 {
		t.Log("First request headers:")
		for k, v := range requests[0].Headers {
			t.Logf("  %s: %s", k, strings.Join(v, ", "))
		}
	}
}
