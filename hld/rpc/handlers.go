package rpc

import (
	"context"
	"encoding/json"
	"fmt"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/session"
)

// SessionHandlers provides RPC handlers for session management
type SessionHandlers struct {
	manager *session.Manager
}

// NewSessionHandlers creates new session RPC handlers
func NewSessionHandlers(manager *session.Manager) *SessionHandlers {
	return &SessionHandlers{
		manager: manager,
	}
}

// LaunchSessionRequest is the request for launching a new session
type LaunchSessionRequest struct {
	Prompt             string                    `json:"prompt"`
	Model              string                    `json:"model,omitempty"`
	MCPConfig          *claudecode.MCPConfig     `json:"mcp_config,omitempty"`
	WorkingDir         string                    `json:"working_dir,omitempty"`
	MaxTurns           int                       `json:"max_turns,omitempty"`
	SystemPrompt       string                    `json:"system_prompt,omitempty"`
	AppendSystemPrompt string                    `json:"append_system_prompt,omitempty"`
	AllowedTools       []string                  `json:"allowed_tools,omitempty"`
	DisallowedTools    []string                  `json:"disallowed_tools,omitempty"`
	CustomInstructions string                    `json:"custom_instructions,omitempty"`
	Verbose            bool                      `json:"verbose,omitempty"`
}

// LaunchSessionResponse is the response for launching a new session
type LaunchSessionResponse struct {
	SessionID string `json:"session_id"`
	RunID     string `json:"run_id"`
}

// HandleLaunchSession handles the LaunchSession RPC method
func (h *SessionHandlers) HandleLaunchSession(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req LaunchSessionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.Prompt == "" {
		return nil, fmt.Errorf("prompt is required")
	}

	// Build session config
	config := claudecode.SessionConfig{
		Prompt:             req.Prompt,
		MCPConfig:          req.MCPConfig,
		WorkingDir:         req.WorkingDir,
		MaxTurns:           req.MaxTurns,
		SystemPrompt:       req.SystemPrompt,
		AppendSystemPrompt: req.AppendSystemPrompt,
		AllowedTools:       req.AllowedTools,
		DisallowedTools:    req.DisallowedTools,
		CustomInstructions: req.CustomInstructions,
		Verbose:            req.Verbose,
		OutputFormat:       claudecode.OutputStreamJSON, // Always use streaming JSON for monitoring
	}

	// Parse model if provided
	if req.Model != "" {
		switch req.Model {
		case "opus":
			config.Model = claudecode.ModelOpus
		case "sonnet":
			config.Model = claudecode.ModelSonnet
		default:
			// Let Claude decide the default
		}
	}

	// Launch session
	session, err := h.manager.LaunchSession(ctx, config)
	if err != nil {
		return nil, err
	}

	return &LaunchSessionResponse{
		SessionID: session.ID,
		RunID:     session.RunID,
	}, nil
}

// ListSessionsRequest is the request for listing sessions
type ListSessionsRequest struct {
	// Could add filters here in the future
}

// ListSessionsResponse is the response for listing sessions
type ListSessionsResponse struct {
	Sessions []session.Info `json:"sessions"`
}

// HandleListSessions handles the ListSessions RPC method
func (h *SessionHandlers) HandleListSessions(ctx context.Context, params json.RawMessage) (interface{}, error) {
	// Parse request (even though it's empty for now)
	var req ListSessionsRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, fmt.Errorf("invalid request: %w", err)
		}
	}

	// Get all sessions
	sessions := h.manager.ListSessionInfo()

	return &ListSessionsResponse{
		Sessions: sessions,
	}, nil
}

// Register registers all session handlers with the RPC server
func (h *SessionHandlers) Register(server *Server) {
	server.Register("launchSession", h.HandleLaunchSession)
	server.Register("listSessions", h.HandleListSessions)
}