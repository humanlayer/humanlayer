package mcp

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
)

// StubMCPHandler is a minimal MCP handler for Phase 1
type StubMCPHandler struct {
	autoDenyAll bool
}

// NewStubMCPHandler creates a minimal stub handler
func NewStubMCPHandler() *StubMCPHandler {
	return &StubMCPHandler{
		autoDenyAll: os.Getenv("MCP_AUTO_DENY_ALL") == "true",
	}
}

// ServeHTTP handles MCP requests with minimal implementation
func (h *StubMCPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	slog.Info("MCP stub handler called",
		"method", r.Method,
		"path", r.URL.Path,
		"auto_deny", h.autoDenyAll)

	// Read the request body
	var request map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	method, _ := request["method"].(string)
	id := request["id"]

	slog.Info("MCP request", "method", method, "id", id)

	// Basic JSON-RPC response structure
	response := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      id,
	}

	// Handle basic MCP methods with stubs
	switch method {
	case "initialize":
		response["result"] = map[string]interface{}{
			"protocolVersion": "2025-03-26",
			"serverInfo": map[string]interface{}{
				"name":    "humanlayer-daemon-stub",
				"version": "0.0.1",
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
					"description": "Request permission to execute a tool (stub)",
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
		params, _ := request["params"].(map[string]interface{})
		toolName, _ := params["name"].(string)

		if toolName == "request_approval" && h.autoDenyAll {
			// Auto-deny if configured
			response["result"] = map[string]interface{}{
				"content": []interface{}{
					map[string]interface{}{
						"type": "text",
						"text": `{"behavior": "deny", "message": "Auto-denied by stub"}`,
					},
				},
			}
		} else if h.autoDenyAll {
			// Other tools also auto-denied
			response["error"] = map[string]interface{}{
				"code":    -32603,
				"message": "Tool execution denied by stub",
			}
		} else {
			// When not auto-denying, just never reply (hang)
			// This simulates waiting for approval
			select {} // Block forever
		}

	default:
		response["error"] = map[string]interface{}{
			"code":    -32601,
			"message": "Method not found in stub",
		}
	}

	// Send response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
