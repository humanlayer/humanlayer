package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// SessionHandlers provides RPC handlers for session management
type SessionHandlers struct {
	manager session.SessionManager
	store   store.ConversationStore
}

// NewSessionHandlers creates new session RPC handlers
func NewSessionHandlers(manager session.SessionManager, store store.ConversationStore) *SessionHandlers {
	return &SessionHandlers{
		manager: manager,
		store:   store,
	}
}

// LaunchSessionRequest is the request for launching a new session
type LaunchSessionRequest struct {
	Query                string                `json:"query"`
	Model                string                `json:"model,omitempty"`
	MCPConfig            *claudecode.MCPConfig `json:"mcp_config,omitempty"`
	PermissionPromptTool string                `json:"permission_prompt_tool,omitempty"`
	WorkingDir           string                `json:"working_dir,omitempty"`
	MaxTurns             int                   `json:"max_turns,omitempty"`
	SystemPrompt         string                `json:"system_prompt,omitempty"`
	AppendSystemPrompt   string                `json:"append_system_prompt,omitempty"`
	AllowedTools         []string              `json:"allowed_tools,omitempty"`
	DisallowedTools      []string              `json:"disallowed_tools,omitempty"`
	CustomInstructions   string                `json:"custom_instructions,omitempty"`
	Verbose              bool                  `json:"verbose,omitempty"`
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
	if req.Query == "" {
		return nil, fmt.Errorf("query is required")
	}

	// Build session config
	config := claudecode.SessionConfig{
		Query:                req.Query,
		MCPConfig:            req.MCPConfig,
		PermissionPromptTool: req.PermissionPromptTool,
		WorkingDir:           req.WorkingDir,
		MaxTurns:             req.MaxTurns,
		SystemPrompt:         req.SystemPrompt,
		AppendSystemPrompt:   req.AppendSystemPrompt,
		AllowedTools:         req.AllowedTools,
		DisallowedTools:      req.DisallowedTools,
		CustomInstructions:   req.CustomInstructions,
		Verbose:              req.Verbose,
		OutputFormat:         claudecode.OutputStreamJSON, // Always use streaming JSON for monitoring
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
	sessions := h.manager.ListSessions()

	return &ListSessionsResponse{
		Sessions: sessions,
	}, nil
}

// HandleGetConversation handles the GetConversation RPC method
func (h *SessionHandlers) HandleGetConversation(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req GetConversationRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate that either SessionID or ClaudeSessionID is provided
	if req.SessionID == "" && req.ClaudeSessionID == "" {
		return nil, fmt.Errorf("either session_id or claude_session_id is required")
	}

	var events []*store.ConversationEvent
	var err error

	if req.ClaudeSessionID != "" {
		// Get conversation by Claude session ID
		events, err = h.store.GetConversation(ctx, req.ClaudeSessionID)
	} else {
		// Get conversation by session ID
		events, err = h.store.GetSessionConversation(ctx, req.SessionID)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}

	// Convert store events to RPC events
	rpcEvents := make([]ConversationEvent, len(events))
	for i, event := range events {
		rpcEvents[i] = ConversationEvent{
			ID:                event.ID,
			SessionID:         event.SessionID,
			ClaudeSessionID:   event.ClaudeSessionID,
			Sequence:          event.Sequence,
			EventType:         event.EventType,
			CreatedAt:         event.CreatedAt.Format(time.RFC3339),
			Role:              event.Role,
			Content:           event.Content,
			ToolID:            event.ToolID,
			ToolName:          event.ToolName,
			ToolInputJSON:     event.ToolInputJSON,
			ToolResultForID:   event.ToolResultForID,
			ToolResultContent: event.ToolResultContent,
			IsCompleted:       event.IsCompleted,
			ApprovalStatus:    event.ApprovalStatus,
			ApprovalID:        event.ApprovalID,
		}
	}

	return &GetConversationResponse{
		Events: rpcEvents,
	}, nil
}

// HandleGetSessionState handles the GetSessionState RPC method
func (h *SessionHandlers) HandleGetSessionState(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req GetSessionStateRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Get session from store
	session, err := h.store.GetSession(ctx, req.SessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Convert to RPC session state
	state := SessionState{
		ID:              session.ID,
		RunID:           session.RunID,
		ClaudeSessionID: session.ClaudeSessionID,
		Status:          session.Status,
		Query:           session.Query,
		Model:           session.Model,
		WorkingDir:      session.WorkingDir,
		CreatedAt:       session.CreatedAt.Format(time.RFC3339),
		LastActivityAt:  session.LastActivityAt.Format(time.RFC3339),
		ErrorMessage:    session.ErrorMessage,
	}

	// Set optional fields
	if session.CompletedAt != nil {
		state.CompletedAt = session.CompletedAt.Format(time.RFC3339)
	}
	if session.CostUSD != nil {
		state.CostUSD = *session.CostUSD
	}
	if session.TotalTokens != nil {
		state.TotalTokens = *session.TotalTokens
	}
	if session.DurationMS != nil {
		state.DurationMS = *session.DurationMS
	}

	return &GetSessionStateResponse{
		Session: state,
	}, nil
}

// Register registers all session handlers with the RPC server
func (h *SessionHandlers) Register(server *Server) {
	server.Register("launchSession", h.HandleLaunchSession)
	server.Register("listSessions", h.HandleListSessions)
	server.Register("getConversation", h.HandleGetConversation)
	server.Register("getSessionState", h.HandleGetSessionState)
}
