//go:build integration

package daemon_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// HeaderCaptureServer captures all HTTP request headers for analysis
type HeaderCaptureServer struct {
	mu       sync.Mutex
	requests []RequestCapture
}

type RequestCapture struct {
	Method    string
	Path      string
	Headers   map[string][]string
	Body      []byte
	Timestamp time.Time
}

func (s *HeaderCaptureServer) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Capture request
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))

		capture := RequestCapture{
			Method:    r.Method,
			Path:      r.URL.Path,
			Headers:   r.Header.Clone(),
			Body:      body,
			Timestamp: time.Now(),
		}

		s.mu.Lock()
		s.requests = append(s.requests, capture)
		s.mu.Unlock()

		// Log headers
		fmt.Printf("\n[%s %s]\n", r.Method, r.URL.Path)
		fmt.Println("Headers:")
		for k, v := range r.Header {
			fmt.Printf("  %s: %s\n", k, strings.Join(v, ", "))
		}

		// Parse JSON-RPC request
		var req map[string]interface{}
		json.Unmarshal(body, &req)

		method, _ := req["method"].(string)
		id := req["id"]

		// Create response
		response := map[string]interface{}{
			"jsonrpc": "2.0",
			"id":      id,
		}

		// Handle MCP methods
		switch method {
		case "initialize":
			response["result"] = map[string]interface{}{
				"protocolVersion": "2025-03-26",
				"serverInfo": map[string]interface{}{
					"name":    "test-server",
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
						"name":        "test_tool",
						"description": "A test tool",
						"inputSchema": map[string]interface{}{
							"type":       "object",
							"properties": map[string]interface{}{},
						},
					},
				},
			}
		case "tools/call":
			response["result"] = map[string]interface{}{
				"content": []interface{}{
					map[string]interface{}{
						"type": "text",
						"text": "Test response",
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
	}
}

func (s *HeaderCaptureServer) GetRequests() []RequestCapture {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]RequestCapture{}, s.requests...)
}

func TestMCPHeaderTransmission(t *testing.T) {
	// Skip if Claude CLI is not available
	if _, err := exec.LookPath("claude"); err != nil {
		t.Skip("Claude CLI not available")
	}

	// Create header capture server
	captureServer := &HeaderCaptureServer{}

	// Start HTTP server
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Any("/mcp", gin.WrapF(captureServer.Handler()))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	port := listener.Addr().(*net.TCPAddr).Port
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	server := &http.Server{Handler: router}
	go server.Serve(listener)
	defer server.Shutdown(context.Background())

	// Create MCP config file with custom headers
	tempDir := t.TempDir()
	mcpConfigPath := fmt.Sprintf("%s/mcp-config.json", tempDir)

	testSessionID := "test-session-123"
	mcpConfig := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"test": map[string]interface{}{
				"type": "http",
				"url":  fmt.Sprintf("%s/mcp", baseURL),
				"headers": map[string]string{
					"X-Session-ID":    testSessionID,
					"X-Custom-Header": "custom-value",
					"Authorization":   "Bearer test-token",
				},
			},
		},
	}

	configBytes, _ := json.MarshalIndent(mcpConfig, "", "  ")
	err = os.WriteFile(mcpConfigPath, configBytes, 0644)
	require.NoError(t, err)

	t.Logf("MCP Config:\n%s", string(configBytes))

	// Launch Claude with MCP config
	cmd := exec.Command("claude",
		"--print", "test",
		"--mcp-config", mcpConfigPath,
		"--max-turns", "1",
		"--model", "sonnet",
		"--output-format", "json",
	)
	cmd.Dir = tempDir

	output, err := cmd.CombinedOutput()
	t.Logf("Claude output:\n%s", string(output))

	// Allow some time for any async operations
	time.Sleep(500 * time.Millisecond)

	// Analyze captured requests
	requests := captureServer.GetRequests()
	t.Logf("\n=== Captured %d MCP Requests ===", len(requests))

	sessionIDFound := false
	customHeaderFound := false
	authHeaderFound := false

	for i, req := range requests {
		t.Logf("\nRequest #%d: %s %s", i+1, req.Method, req.Path)

		// Check for our custom headers
		if sessionIDs, ok := req.Headers["X-Session-Id"]; ok && len(sessionIDs) > 0 {
			sessionIDFound = true
			sessionID := sessionIDs[0]
			t.Logf("  ✓ X-Session-ID: %s", sessionID)
			if sessionID != testSessionID {
				t.Errorf("  ✗ Session ID mismatch: got %s, want %s", sessionID, testSessionID)
			}
		}

		if customs, ok := req.Headers["X-Custom-Header"]; ok && len(customs) > 0 {
			customHeaderFound = true
			t.Logf("  ✓ X-Custom-Header: %s", customs[0])
		}

		if auths, ok := req.Headers["Authorization"]; ok && len(auths) > 0 {
			authHeaderFound = true
			t.Logf("  ✓ Authorization: %s", auths[0])
		}

		// Log all headers for debugging
		t.Log("  All headers:")
		for k, v := range req.Headers {
			t.Logf("    %s: %s", k, strings.Join(v, ", "))
		}
	}

	// Verdict
	t.Log("\n=== VERDICT ===")
	if sessionIDFound && customHeaderFound && authHeaderFound {
		t.Log("✓ All custom headers are transmitted correctly")
		t.Log("✓ Session ID correlation via headers WILL work")
	} else {
		t.Log("✗ Custom headers are NOT being transmitted")
		if !sessionIDFound {
			t.Error("X-Session-ID header not found in MCP requests")
		}
		if !customHeaderFound {
			t.Error("X-Custom-Header not found in MCP requests")
		}
		if !authHeaderFound {
			t.Error("Authorization header not found in MCP requests")
		}

		t.Log("\n=== RECOMMENDATIONS ===")
		t.Log("1. Embed session ID in the MCP server URL path")
		t.Log("2. Use unique MCP server instances per session")
		t.Log("3. Implement session correlation via MCP protocol messages")
	}
}

func TestMCPSessionCorrelationAlternatives(t *testing.T) {
	t.Log("\n=== Alternative Session Correlation Methods ===")

	t.Log("\n1. URL Path Embedding:")
	t.Log("   - Change MCP endpoint to: /api/v1/mcp/:session_id")
	t.Log("   - Extract session ID from URL path in handler")
	t.Log("   - Pro: Simple, reliable, no header dependency")
	t.Log("   - Con: Requires URL generation per session")

	t.Log("\n2. MCP Protocol Session:")
	t.Log("   - Use MCP's initialize response to establish session")
	t.Log("   - Store mapping: mcp_session_id -> humanlayer_session_id")
	t.Log("   - Pro: Protocol-native solution")
	t.Log("   - Con: Requires stateful MCP server")

	t.Log("\n3. Token-based Correlation:")
	t.Log("   - Generate unique token per session")
	t.Log("   - Pass token in MCP server name or URL")
	t.Log("   - Pro: Secure, unique per session")
	t.Log("   - Con: Token management complexity")

	t.Log("\n4. Process-based Correlation:")
	t.Log("   - Track Claude process ID")
	t.Log("   - Map process to session at launch")
	t.Log("   - Pro: OS-level tracking")
	t.Log("   - Con: Complex, platform-specific")
}
