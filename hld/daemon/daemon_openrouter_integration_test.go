//go:build integration

package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenRouterToolsAPI(t *testing.T) {
	if os.Getenv("OPENROUTER_API_KEY") == "" {
		t.Skip("OPENROUTER_API_KEY not set")
	}

	// Start daemon with test configuration
	daemon, cleanup := setupTestDaemon(t)
	defer cleanup()

	// Create a session with proxy enabled for OpenRouter
	ctx := context.Background()
	createReq := rpc.CreateSessionRequest{
		Query:              "Test OpenRouter tools API",
		ProxyEnabled:       true,
		ProxyBaseURL:       "https://openrouter.ai/api",
		ProxyModelOverride: "openai/gpt-4o-mini",
		ProxyAPIKey:        os.Getenv("OPENROUTER_API_KEY"),
	}

	createResp, err := daemon.rpcHandler.CreateSession(ctx, createReq)
	require.NoError(t, err)
	require.NotNil(t, createResp)
	sessionID := createResp.SessionID

	// Wait for session to be ready
	time.Sleep(2 * time.Second)

	// Send a request with tools through the proxy
	anthropicReq := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "What's 2+2? Use the calculator tool to compute it.",
			},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "calculator",
				"description": "A simple calculator that can add two numbers",
				"input_schema": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"a": map[string]interface{}{
							"type":        "number",
							"description": "First number",
						},
						"b": map[string]interface{}{
							"type":        "number",
							"description": "Second number",
						},
					},
					"required": []string{"a", "b"},
				},
			},
		},
		"max_tokens": 200,
	}

	// Marshal request to JSON
	reqBody, err := json.Marshal(anthropicReq)
	require.NoError(t, err)

	// Send request through proxy endpoint
	proxyURL := fmt.Sprintf("http://localhost:%d/api/v1/anthropic_proxy/%s", daemon.httpPort, sessionID)

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", proxyURL, bytes.NewReader(reqBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", "test-key") // Anthropic API key (will be replaced by proxy)

	// Send request
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	// Check response status
	assert.NotEqual(t, 400, resp.StatusCode, "Should not get 400 error about deprecated functions")

	if resp.StatusCode == 200 {
		// Parse response
		var response map[string]interface{}
		err = json.NewDecoder(resp.Body).Decode(&response)
		require.NoError(t, err)

		// Verify response has content
		assert.NotNil(t, response["content"], "Response should have content")

		// Check if tool was called (optional - depends on model behavior)
		if content, ok := response["content"].([]interface{}); ok {
			for _, item := range content {
				if block, ok := item.(map[string]interface{}); ok {
					if block["type"] == "tool_use" {
						t.Logf("Tool was called: %v", block["name"])
					}
				}
			}
		}
	} else {
		// Log error for debugging
		body, _ := io.ReadAll(resp.Body)
		t.Logf("Response status: %d, body: %s", resp.StatusCode, string(body))
	}
}

func TestOpenRouterToolChoice(t *testing.T) {
	if os.Getenv("OPENROUTER_API_KEY") == "" {
		t.Skip("OPENROUTER_API_KEY not set")
	}

	// Start daemon with test configuration
	daemon, cleanup := setupTestDaemon(t)
	defer cleanup()

	// Create a session with proxy enabled
	ctx := context.Background()
	createReq := rpc.CreateSessionRequest{
		Query:              "Test OpenRouter tool choice",
		ProxyEnabled:       true,
		ProxyBaseURL:       "https://openrouter.ai/api",
		ProxyModelOverride: "openai/gpt-4o-mini",
		ProxyAPIKey:        os.Getenv("OPENROUTER_API_KEY"),
	}

	createResp, err := daemon.rpcHandler.CreateSession(ctx, createReq)
	require.NoError(t, err)
	sessionID := createResp.SessionID

	// Test with specific tool choice
	anthropicReq := map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "Hello",
			},
		},
		"tools": []interface{}{
			map[string]interface{}{
				"name":        "get_time",
				"description": "Get current time",
				"input_schema": map[string]interface{}{
					"type":       "object",
					"properties": map[string]interface{}{},
				},
			},
		},
		"tool_choice": map[string]interface{}{
			"type": "tool",
			"name": "get_time",
		},
		"max_tokens": 100,
	}

	// Marshal and send request
	reqBody, err := json.Marshal(anthropicReq)
	require.NoError(t, err)

	proxyURL := fmt.Sprintf("http://localhost:%d/api/v1/anthropic_proxy/%s", daemon.httpPort, sessionID)
	req, err := http.NewRequestWithContext(ctx, "POST", proxyURL, bytes.NewReader(reqBody))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", "test-key")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	// Should not get deprecated functions error
	assert.NotEqual(t, 400, resp.StatusCode, "Should not get 400 error about deprecated functions")
}
