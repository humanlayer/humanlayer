package rpc

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

// SessionHandlers provides RPC handlers for session management
type SessionHandlers struct {
	manager         session.SessionManager
	store           store.ConversationStore
	eventBus        bus.EventBus
	approvalManager approval.Manager
}

// NewSessionHandlers creates new session RPC handlers
func NewSessionHandlers(manager session.SessionManager, store store.ConversationStore, approvalManager approval.Manager) *SessionHandlers {
	return &SessionHandlers{
		manager:         manager,
		store:           store,
		approvalManager: approvalManager,
	}
}

// SetEventBus sets the event bus for the handlers
func (h *SessionHandlers) SetEventBus(eventBus bus.EventBus) {
	h.eventBus = eventBus
}

// LaunchSessionRequest is the request for launching a new session
type LaunchSessionRequest struct {
	Query                             string                `json:"query"`
	Model                             string                `json:"model,omitempty"`
	MCPConfig                         *claudecode.MCPConfig `json:"mcp_config,omitempty"`
	PermissionPromptTool              string                `json:"permission_prompt_tool,omitempty"`
	WorkingDir                        string                `json:"working_dir,omitempty"`
	MaxTurns                          int                   `json:"max_turns,omitempty"`
	SystemPrompt                      string                `json:"system_prompt,omitempty"`
	AppendSystemPrompt                string                `json:"append_system_prompt,omitempty"`
	AllowedTools                      []string              `json:"allowed_tools,omitempty"`
	DisallowedTools                   []string              `json:"disallowed_tools,omitempty"`
	CustomInstructions                string                `json:"custom_instructions,omitempty"`
	Verbose                           bool                  `json:"verbose,omitempty"`
	DangerouslySkipPermissions        bool                  `json:"dangerously_skip_permissions,omitempty"`
	DangerouslySkipPermissionsTimeout *int64                `json:"dangerously_skip_permissions_timeout,omitempty"`
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

	// Build session config with daemon-level settings
	config := session.LaunchSessionConfig{
		SessionConfig: claudecode.SessionConfig{
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
		},
		// Daemon-level settings (not passed to Claude Code)
		DangerouslySkipPermissions:        req.DangerouslySkipPermissions,
		DangerouslySkipPermissionsTimeout: req.DangerouslySkipPermissionsTimeout,
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

// GetSessionLeavesRequest is the request for getting session leaves
// TODO(3): This is gross, we should lean an alternate approach to handling filters.
type GetSessionLeavesRequest struct {
	IncludeArchived bool `json:"include_archived,omitempty"` // Include archived sessions (default false)
	ArchivedOnly    bool `json:"archived_only,omitempty"`    // Show only archived sessions
}

// GetSessionLeavesResponse is the response for getting session leaves
type GetSessionLeavesResponse struct {
	Sessions []session.Info `json:"sessions"`
}

// HandleGetSessionLeaves handles the GetSessionLeaves RPC method
func (h *SessionHandlers) HandleGetSessionLeaves(ctx context.Context, params json.RawMessage) (interface{}, error) {
	// Parse request
	var req GetSessionLeavesRequest
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, fmt.Errorf("invalid request: %w", err)
		}
	}

	// Get all sessions from manager
	sessionInfos := h.manager.ListSessions()

	// Convert to match the expected type for processing
	sessions := sessionInfos

	// Build parent-to-children map
	childrenMap := make(map[string][]string)
	for _, s := range sessions {
		if s.ParentSessionID != "" {
			childrenMap[s.ParentSessionID] = append(childrenMap[s.ParentSessionID], s.ID)
		}
	}

	// Identify leaf sessions (sessions with no children) and apply archive filter
	leaves := make([]session.Info, 0) // Initialize to empty slice, not nil
	for _, s := range sessions {
		children := childrenMap[s.ID]

		// Include only if session has no children (is a leaf node)
		if len(children) > 0 {
			continue
		}

		// Apply archive filter
		if !req.IncludeArchived && s.Archived {
			continue // Skip archived sessions unless explicitly requested
		}
		if req.ArchivedOnly && !s.Archived {
			continue // Skip non-archived sessions when only archived requested
		}

		// Already have session.Info, just append
		leaves = append(leaves, s)
	}

	// Sort by last activity (newest first)
	sort.Slice(leaves, func(i, j int) bool {
		return leaves[i].LastActivityAt.After(leaves[j].LastActivityAt)
	})

	return &GetSessionLeavesResponse{
		Sessions: leaves,
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
		// Get conversation by session ID - always returns full history including parents
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
			ParentToolUseID:   event.ParentToolUseID,
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

// HandleGetSessionSnapshots retrieves all file snapshots for a session
func (h *SessionHandlers) HandleGetSessionSnapshots(ctx context.Context, params json.RawMessage) (interface{}, error) {
	slog.Info("HandleGetSessionSnapshots called", "params", string(params))

	// Parse request
	var req GetSessionSnapshotsRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	slog.Info("parsed request", "session_id", req.SessionID)

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Verify session exists
	_, err := h.store.GetSession(ctx, req.SessionID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("session not found")
		}
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Get snapshots from store
	snapshots, err := h.store.GetFileSnapshots(ctx, req.SessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get snapshots: %w", err)
	}

	// TODO(3): Sort snapshots explicitly (e.g., by CreatedAt) rather than relying on store's return order
	// Convert to response format
	response := &GetSessionSnapshotsResponse{
		Snapshots: make([]FileSnapshotInfo, 0, len(snapshots)),
	}

	for _, snapshot := range snapshots {
		response.Snapshots = append(response.Snapshots, FileSnapshotInfo{
			ToolID:    snapshot.ToolID,
			FilePath:  snapshot.FilePath,
			Content:   snapshot.Content,
			CreatedAt: snapshot.CreatedAt.Format(time.RFC3339),
		})
	}

	slog.Info("returning snapshots", "count", len(response.Snapshots))
	return response, nil
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
		ID:                         session.ID,
		RunID:                      session.RunID,
		ClaudeSessionID:            session.ClaudeSessionID,
		ParentSessionID:            session.ParentSessionID,
		Status:                     session.Status,
		Query:                      session.Query,
		Summary:                    session.Summary,
		Title:                      session.Title,
		Model:                      session.Model,
		WorkingDir:                 session.WorkingDir,
		CreatedAt:                  session.CreatedAt.Format(time.RFC3339),
		LastActivityAt:             session.LastActivityAt.Format(time.RFC3339),
		ErrorMessage:               session.ErrorMessage,
		AutoAcceptEdits:            session.AutoAcceptEdits,
		DangerouslySkipPermissions: session.DangerouslySkipPermissions,
		Archived:                   session.Archived,
	}

	// Set optional fields
	if session.DangerouslySkipPermissionsExpiresAt != nil {
		state.DangerouslySkipPermissionsExpiresAt = session.DangerouslySkipPermissionsExpiresAt.Format(time.RFC3339)
	}
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

// HandleContinueSession handles the ContinueSession RPC method
func (h *SessionHandlers) HandleContinueSession(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req ContinueSessionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	if req.Query == "" {
		return nil, fmt.Errorf("query is required")
	}

	// Build session config for manager
	config := session.ContinueSessionConfig{
		ParentSessionID:      req.SessionID,
		Query:                req.Query,
		SystemPrompt:         req.SystemPrompt,
		AppendSystemPrompt:   req.AppendSystemPrompt,
		PermissionPromptTool: req.PermissionPromptTool,
		AllowedTools:         req.AllowedTools,
		DisallowedTools:      req.DisallowedTools,
		CustomInstructions:   req.CustomInstructions,
		MaxTurns:             req.MaxTurns,
	}

	// Parse MCP config if provided as JSON string
	if req.MCPConfig != "" {
		var mcpConfig claudecode.MCPConfig
		if err := json.Unmarshal([]byte(req.MCPConfig), &mcpConfig); err != nil {
			return nil, fmt.Errorf("invalid mcp_config JSON: %w", err)
		}
		config.MCPConfig = &mcpConfig
	}

	// Continue session
	session, err := h.manager.ContinueSession(ctx, config)
	if err != nil {
		return nil, err
	}

	return &ContinueSessionResponse{
		SessionID:       session.ID,
		RunID:           session.RunID,
		ClaudeSessionID: "", // Will be populated when events stream in
		ParentSessionID: req.SessionID,
	}, nil
}

// HandleInterruptSession handles the InterruptSession RPC method
func (h *SessionHandlers) HandleInterruptSession(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req InterruptSessionRequest
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

	// Validate session is running
	if session.Status != store.SessionStatusRunning {
		return nil, fmt.Errorf("cannot interrupt session with status %s (must be running)", session.Status)
	}

	// Interrupt session
	if err := h.manager.InterruptSession(ctx, req.SessionID); err != nil {
		return nil, fmt.Errorf("failed to interrupt session: %w", err)
	}

	return &InterruptSessionResponse{
		Success:   true,
		SessionID: req.SessionID,
		Status:    "interrupting",
	}, nil
}

// HandleUpdateSessionSettings handles the UpdateSessionSettings RPC method
func (h *SessionHandlers) HandleUpdateSessionSettings(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req UpdateSessionSettingsRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Get current session to verify it exists
	session, err := h.store.GetSession(ctx, req.SessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if session == nil {
		return nil, fmt.Errorf("session not found")
	}

	// Update session settings
	update := store.SessionUpdate{
		AutoAcceptEdits:            req.AutoAcceptEdits,
		DangerouslySkipPermissions: req.DangerouslySkipPermissions,
	}

	// Handle timeout if dangerously skip permissions is being enabled
	if req.DangerouslySkipPermissions != nil && *req.DangerouslySkipPermissions {
		// Only set expiry if timeout is provided
		if req.DangerouslySkipPermissionsTimeoutMs != nil && *req.DangerouslySkipPermissionsTimeoutMs > 0 {
			expiresAt := time.Now().Add(time.Duration(*req.DangerouslySkipPermissionsTimeoutMs) * time.Millisecond)
			expiresAtPtr := &expiresAt
			update.DangerouslySkipPermissionsExpiresAt = &expiresAtPtr
		}
	} else if req.DangerouslySkipPermissions != nil && !*req.DangerouslySkipPermissions {
		// Disabling dangerously skip permissions - clear expiry
		var nilTime *time.Time
		update.DangerouslySkipPermissionsExpiresAt = &nilTime
	}

	if err := h.store.UpdateSession(ctx, req.SessionID, update); err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}

	// Update retroactive approval logic
	// Change the condition to handle both modes:
	if h.approvalManager != nil {
		shouldAutoApprove := false
		autoApproveComment := ""

		// Check which mode is being enabled
		if req.DangerouslySkipPermissions != nil && *req.DangerouslySkipPermissions {
			shouldAutoApprove = true
			autoApproveComment = "Auto-accepted (bypassing permissions)"
		} else if req.AutoAcceptEdits != nil && *req.AutoAcceptEdits {
			shouldAutoApprove = true
			autoApproveComment = "Auto-accepted (auto-accept mode enabled)"
		}

		if shouldAutoApprove {
			pendingApprovals, err := h.store.GetPendingApprovals(ctx, req.SessionID)
			if err == nil && len(pendingApprovals) > 0 {
				for _, approval := range pendingApprovals {
					// For dangerously skip permissions, approve ALL tools
					// For edit mode, only approve edit tools
					if req.DangerouslySkipPermissions != nil && *req.DangerouslySkipPermissions {
						err := h.approvalManager.ApproveToolCall(ctx, approval.ID, autoApproveComment)
						if err != nil {
							slog.Error("failed to auto-approve pending approval", "approval_id", approval.ID, "error", err)
						}
					} else if req.AutoAcceptEdits != nil && *req.AutoAcceptEdits && isEditTool(approval.ToolName) {
						err := h.approvalManager.ApproveToolCall(ctx, approval.ID, autoApproveComment)
						if err != nil {
							slog.Error("failed to auto-approve pending approval", "approval_id", approval.ID, "error", err)
						}
					}
				}
			}
		}
	}

	// Update event publishing
	if h.eventBus != nil {
		eventData := map[string]interface{}{
			"session_id": req.SessionID,
			"event_type": "settings_updated",
		}

		if req.AutoAcceptEdits != nil {
			eventData["auto_accept_edits"] = *req.AutoAcceptEdits
		}
		if req.DangerouslySkipPermissions != nil {
			eventData["dangerously_skip_permissions"] = *req.DangerouslySkipPermissions
			if *req.DangerouslySkipPermissions && req.DangerouslySkipPermissionsTimeoutMs != nil {
				eventData["dangerously_skip_permissions_timeout_ms"] = *req.DangerouslySkipPermissionsTimeoutMs
			}
		}

		h.eventBus.Publish(bus.Event{
			Type: bus.EventSessionSettingsChanged,
			Data: eventData,
		})
	}

	return UpdateSessionSettingsResponse{Success: true}, nil
}

// HandleGetRecentPaths handles the GetRecentPaths RPC method
func (h *SessionHandlers) HandleGetRecentPaths(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req GetRecentPathsRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}

	paths, err := h.store.GetRecentWorkingDirs(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("get recent paths: %w", err)
	}

	// Convert store.RecentPath to RPC RecentPath with ISO 8601 timestamps
	rpcPaths := make([]RecentPath, len(paths))
	for i, p := range paths {
		rpcPaths[i] = RecentPath{
			Path:       p.Path,
			LastUsed:   p.LastUsed.Format(time.RFC3339),
			UsageCount: p.UsageCount,
		}
	}

	return &GetRecentPathsResponse{Paths: rpcPaths}, nil
}

// HandleUpdateSessionTitle handles the UpdateSessionTitle RPC method
func (h *SessionHandlers) HandleUpdateSessionTitle(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req UpdateSessionTitleRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Update session title
	update := store.SessionUpdate{
		Title: &req.Title,
	}

	if err := h.store.UpdateSession(ctx, req.SessionID, update); err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}

	// Publish event for UI updates
	if h.eventBus != nil {
		h.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": req.SessionID,
				"title":      req.Title,
			},
		})
	}

	return &UpdateSessionTitleResponse{
		Success: true,
	}, nil
}

// isEditTool checks if a tool name is one of the edit tools
func isEditTool(toolName string) bool {
	return toolName == "Edit" || toolName == "Write" || toolName == "MultiEdit"
}

// ArchiveSessionRequest is the request for archiving/unarchiving a session
type ArchiveSessionRequest struct {
	SessionID string `json:"session_id"` // The session to archive/unarchive
	Archived  bool   `json:"archived"`   // Whether to archive (true) or unarchive (false)
}

// ArchiveSessionResponse is the response for archiving/unarchiving a session
type ArchiveSessionResponse struct {
	Success bool `json:"success"`
}

// HandleArchiveSession handles the ArchiveSession RPC method
func (h *SessionHandlers) HandleArchiveSession(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req ArchiveSessionRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if req.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}

	// Update session in store
	err := h.store.UpdateSession(ctx, req.SessionID, store.SessionUpdate{
		Archived: &req.Archived,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to archive session: %w", err)
	}

	// TODO: Notify subscribers via event bus

	return &ArchiveSessionResponse{Success: true}, nil
}

// BulkArchiveSessionsRequest is the request for bulk archiving/unarchiving sessions
type BulkArchiveSessionsRequest struct {
	SessionIDs []string `json:"session_ids"` // The sessions to archive/unarchive
	Archived   bool     `json:"archived"`    // Whether to archive (true) or unarchive (false)
}

// BulkArchiveSessionsResponse is the response for bulk archiving/unarchiving sessions
type BulkArchiveSessionsResponse struct {
	Success        bool     `json:"success"`
	FailedSessions []string `json:"failed_sessions,omitempty"` // Sessions that failed to archive
}

// HandleBulkArchiveSessions handles the BulkArchiveSessions RPC method
func (h *SessionHandlers) HandleBulkArchiveSessions(ctx context.Context, params json.RawMessage) (interface{}, error) {
	var req BulkArchiveSessionsRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, fmt.Errorf("invalid request: %w", err)
	}

	// Validate required fields
	if len(req.SessionIDs) == 0 {
		return nil, fmt.Errorf("session_ids is required and cannot be empty")
	}

	var failedSessions []string

	// Update each session
	for _, sessionID := range req.SessionIDs {
		err := h.store.UpdateSession(ctx, sessionID, store.SessionUpdate{
			Archived: &req.Archived,
		})
		if err != nil {
			// Log the error but continue processing other sessions
			failedSessions = append(failedSessions, sessionID)
		}
	}

	// TODO: Notify subscribers via event bus for successful updates

	return &BulkArchiveSessionsResponse{
		Success:        len(failedSessions) == 0,
		FailedSessions: failedSessions,
	}, nil
}

// Register registers all session handlers with the RPC server
func (h *SessionHandlers) Register(server *Server) {
	server.Register("launchSession", h.HandleLaunchSession)
	server.Register("listSessions", h.HandleListSessions)
	server.Register("getSessionLeaves", h.HandleGetSessionLeaves)
	server.Register("getConversation", h.HandleGetConversation)
	server.Register("getSessionState", h.HandleGetSessionState)
	server.Register("continueSession", h.HandleContinueSession)
	server.Register("interruptSession", h.HandleInterruptSession)
	server.Register("getSessionSnapshots", h.HandleGetSessionSnapshots)
	server.Register("updateSessionSettings", h.HandleUpdateSessionSettings)
	server.Register("updateSessionTitle", h.HandleUpdateSessionTitle)
	server.Register("getRecentPaths", h.HandleGetRecentPaths)
	server.Register("archiveSession", h.HandleArchiveSession)
	server.Register("bulkArchiveSessions", h.HandleBulkArchiveSessions)
}
