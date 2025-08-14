package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// contextKey is the type for context keys
type contextKey string

const (
	// sessionIDKey is the context key for session ID
	sessionIDKey contextKey = "session_id"
)

// ApprovalDecision represents the outcome of an approval request
type ApprovalDecision struct {
	Approved bool
	Comment  string
}

// MCPServer wraps the mark3labs MCP server
type MCPServer struct {
	mcpServer        *server.MCPServer
	httpServer       *server.StreamableHTTPServer
	approvalManager  approval.Manager
	eventBus         bus.EventBus
	autoDenyAll      bool
	pendingApprovals sync.Map // map[string]chan ApprovalDecision
}

// NewMCPServer creates the full MCP server implementation
func NewMCPServer(approvalManager approval.Manager, eventBus bus.EventBus) *MCPServer {
	autoDeny := os.Getenv("MCP_AUTO_DENY_ALL") == "true"

	s := &MCPServer{
		approvalManager: approvalManager,
		eventBus:        eventBus,
		autoDenyAll:     autoDeny,
	}

	// Create MCP server
	s.mcpServer = server.NewMCPServer(
		"humanlayer-daemon",
		"1.0.0",
		server.WithToolCapabilities(true),
	)

	// Add request_approval tool
	s.mcpServer.AddTool(
		mcp.NewTool("request_approval",
			mcp.WithDescription("Request permission to execute a tool"),
			mcp.WithString("tool_name",
				mcp.Description("The name of the tool requesting permission"),
				mcp.Required(),
			),
			mcp.WithObject("input",
				mcp.Description("The input to the tool"),
				mcp.Required(),
			),
			mcp.WithString("tool_use_id",
				mcp.Description("Unique identifier for this tool use"),
				mcp.Required(),
			),
		),
		s.handleRequestApproval,
	)

	// Create HTTP server (stateless for now)
	s.httpServer = server.NewStreamableHTTPServer(
		s.mcpServer,
		server.WithStateLess(true),
	)

	// Don't start goroutine here - wait for Start() to be called
	return s
}

// Start initializes the MCP server's background processes
func (s *MCPServer) Start(ctx context.Context) {
	if s.eventBus != nil {
		go s.listenForApprovalDecisions(ctx)
	}
}

func (s *MCPServer) handleRequestApproval(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	toolName := request.GetString("tool_name", "")
	input := request.GetArguments()["input"]
	toolUseID := request.GetString("tool_use_id", "")

	slog.Info("MCP approval requested",
		"tool_name", toolName,
		"tool_use_id", toolUseID,
		"auto_deny", s.autoDenyAll)

	// Auto-deny takes precedence
	if s.autoDenyAll {
		slog.Info("Auto-denying approval", "tool_use_id", toolUseID)

		responseData := map[string]interface{}{
			"behavior": "deny",
			"message":  "Auto-denied for testing",
		}
		responseJSON, _ := json.Marshal(responseData)

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				mcp.TextContent{
					Type: "text",
					Text: string(responseJSON),
				},
			},
		}, nil
	}

	// Get session_id from context
	sessionID, _ := ctx.Value(sessionIDKey).(string)
	if sessionID == "" {
		return nil, fmt.Errorf("missing session_id in context")
	}

	// Marshal input to JSON
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	// Create approval with tool_use_id
	approval, err := s.approvalManager.CreateApprovalWithToolUseID(ctx, sessionID, toolName, inputJSON, toolUseID)
	if err != nil {
		slog.Error("Failed to create approval", "error", err)
		return nil, fmt.Errorf("failed to create approval: %w", err)
	}

	slog.Info("Created approval", "approval_id", approval.ID, "status", approval.Status)

	// Check if the approval was auto-approved
	if approval.Status == "approved" {
		// Return allow behavior for auto-approved
		responseData := map[string]interface{}{
			"behavior":     "allow",
			"updatedInput": input,
		}
		responseJSON, _ := json.Marshal(responseData)

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				mcp.TextContent{
					Type: "text",
					Text: string(responseJSON),
				},
			},
		}, nil
	}

	// Register for event-driven approval resolution
	decisionChan := make(chan ApprovalDecision, 1)
	s.pendingApprovals.Store(toolUseID, decisionChan)
	defer s.pendingApprovals.Delete(toolUseID)

	// Wait for approval decision
	select {
	case decision := <-decisionChan:
		responseData := map[string]interface{}{
			"behavior": "deny",
			"message":  decision.Comment,
		}
		if decision.Approved {
			responseData = map[string]interface{}{
				"behavior":     "allow",
				"updatedInput": input,
			}
		}
		responseJSON, _ := json.Marshal(responseData)

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				mcp.TextContent{
					Type: "text",
					Text: string(responseJSON),
				},
			},
		}, nil

	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("approval timeout")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *MCPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract session_id from header and add to context
	sessionID := r.Header.Get("X-Session-ID")
	if sessionID == "" {
		// Try to extract from MCP session if available
		mcpSessionID := r.Header.Get("Mcp-Session-Id")
		if mcpSessionID != "" {
			sessionID = mcpSessionID
		}
	}

	// Add session_id to context for future use
	ctx := context.WithValue(r.Context(), sessionIDKey, sessionID)
	r = r.WithContext(ctx)

	s.httpServer.ServeHTTP(w, r)
}

// listenForApprovalDecisions listens for approval resolution events and notifies waiting handlers
func (s *MCPServer) listenForApprovalDecisions(ctx context.Context) {
	sub := s.eventBus.Subscribe(ctx, bus.EventFilter{
		Types: []bus.EventType{bus.EventApprovalResolved},
	})

	for {
		select {
		case <-ctx.Done():
			slog.Info("MCP approval listener shutting down")
			return
		case event, ok := <-sub.Channel:
			if !ok {
				slog.Info("MCP approval listener channel closed")
				return
			}
			toolUseID, _ := event.Data["tool_use_id"].(string)
			approved, _ := event.Data["approved"].(bool)
			comment, _ := event.Data["response_text"].(string)

			if toolUseID == "" {
				continue
			}

			// Find pending approval channel
			if ch, ok := s.pendingApprovals.Load(toolUseID); ok {
				select {
				case ch.(chan ApprovalDecision) <- ApprovalDecision{
					Approved: approved,
					Comment:  comment,
				}:
					slog.Info("Sent approval decision", "tool_use_id", toolUseID, "approved", approved)
				default:
					slog.Warn("Channel full or closed", "tool_use_id", toolUseID)
				}
			}
		}
	}
}
