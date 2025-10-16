package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/mapper"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/version"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/sahilm/fuzzy"
)

type SessionHandlers struct {
	manager         session.SessionManager
	store           store.ConversationStore
	approvalManager approval.Manager
	mapper          *mapper.Mapper
	version         string
	config          *config.Config
	sessionManager  session.SessionManager // Add reference to session manager for Claude status checks
}

func NewSessionHandlers(manager session.SessionManager, store store.ConversationStore, approvalManager approval.Manager) *SessionHandlers {
	return &SessionHandlers{
		manager:         manager,
		sessionManager:  manager,
		store:           store,
		approvalManager: approvalManager,
		mapper:          &mapper.Mapper{},
		version:         version.GetVersion(), // TODO(4): Add support for full point releases
	}
}

func NewSessionHandlersWithConfig(manager session.SessionManager, store store.ConversationStore, approvalManager approval.Manager, cfg *config.Config) *SessionHandlers {
	return &SessionHandlers{
		manager:         manager,
		sessionManager:  manager,
		store:           store,
		approvalManager: approvalManager,
		mapper:          &mapper.Mapper{},
		version:         version.GetVersion(),
		config:          cfg,
	}
}

// expandTilde expands ~ to the user's home directory
func expandTilde(path string) string {
	if len(path) > 0 && path[0] == '~' {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		if len(path) == 1 {
			return home
		}
		if path[1] == filepath.Separator {
			return filepath.Join(home, path[2:])
		}
		return filepath.Join(home, path[1:])
	}
	return path
}

// CreateSession implements POST /sessions
func (h *SessionHandlers) CreateSession(ctx context.Context, req api.CreateSessionRequestObject) (api.CreateSessionResponseObject, error) {
	// Build launch config with embedded Claude config
	config := session.LaunchSessionConfig{
		SessionConfig: claudecode.SessionConfig{
			Query:        req.Body.Query,
			MCPConfig:    h.mapper.MCPConfigFromAPI(req.Body.McpConfig),
			OutputFormat: claudecode.OutputStreamJSON, // Always use streaming JSON for monitoring
		},
	}

	// Handle proxy configuration
	// Note: OpenAPI generates ProxyBaseUrl/ProxyApiKey (following JSON conventions)
	// but we map to ProxyBaseURL/ProxyAPIKey (following Go conventions for acronyms)
	if req.Body.ProxyEnabled != nil && *req.Body.ProxyEnabled {
		config.ProxyEnabled = true
		if req.Body.ProxyBaseUrl != nil {
			config.ProxyBaseURL = *req.Body.ProxyBaseUrl // Intentional: ProxyBaseUrl -> ProxyBaseURL
		}
		if req.Body.ProxyModelOverride != nil {
			config.ProxyModelOverride = *req.Body.ProxyModelOverride
		}
		if req.Body.ProxyApiKey != nil {
			config.ProxyAPIKey = *req.Body.ProxyApiKey // Intentional: ProxyApiKey -> ProxyAPIKey
		}
	}

	// Handle optional fields
	if req.Body.Title != nil {
		config.Title = *req.Body.Title
	}
	if req.Body.PermissionPromptTool != nil {
		config.PermissionPromptTool = *req.Body.PermissionPromptTool
	}
	if req.Body.WorkingDir != nil {
		config.WorkingDir = *req.Body.WorkingDir
	}
	if req.Body.MaxTurns != nil {
		config.MaxTurns = *req.Body.MaxTurns
	}
	if req.Body.SystemPrompt != nil {
		config.SystemPrompt = *req.Body.SystemPrompt
	}
	if req.Body.AppendSystemPrompt != nil {
		config.AppendSystemPrompt = *req.Body.AppendSystemPrompt
	}
	if req.Body.AllowedTools != nil {
		config.AllowedTools = *req.Body.AllowedTools
	}
	if req.Body.DisallowedTools != nil {
		config.DisallowedTools = *req.Body.DisallowedTools
	}
	if req.Body.AdditionalDirectories != nil {
		config.AdditionalDirectories = *req.Body.AdditionalDirectories
	}
	if req.Body.CustomInstructions != nil {
		config.CustomInstructions = *req.Body.CustomInstructions
	}
	if req.Body.Verbose != nil {
		config.Verbose = *req.Body.Verbose
	}
	if req.Body.AutoAcceptEdits != nil {
		config.AutoAcceptEdits = *req.Body.AutoAcceptEdits
	}
	if req.Body.DangerouslySkipPermissions != nil {
		config.DangerouslySkipPermissions = *req.Body.DangerouslySkipPermissions
		if req.Body.DangerouslySkipPermissionsTimeout != nil {
			config.DangerouslySkipPermissionsTimeout = req.Body.DangerouslySkipPermissionsTimeout
		}
	}

	// Parse model if provided
	if req.Body.Model != nil && *req.Body.Model != "" {
		switch *req.Body.Model {
		case api.Opus:
			config.Model = claudecode.ModelOpus
		case api.Sonnet:
			config.Model = claudecode.ModelSonnet
		case api.Haiku:
			config.Model = claudecode.ModelHaiku
		default:
			// Let Claude decide the default
		}
	}

	// Check for draft flag in request
	isDraft := req.Body.Draft != nil && *req.Body.Draft

	session, err := h.manager.LaunchSession(ctx, config, isDraft)
	if err != nil {
		slog.Error("Failed to launch session",
			"error", fmt.Sprintf("%v", err),
			"query", config.Query,
			"working_dir", config.WorkingDir,
			"operation", "CreateSession",
		)
		return api.CreateSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-1001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.CreateSessionResponse{}
	resp.Data.SessionId = session.ID
	resp.Data.RunId = session.RunID
	return api.CreateSession201JSONResponse(resp), nil
}

// ListSessions implements GET /sessions
func (h *SessionHandlers) ListSessions(ctx context.Context, req api.ListSessionsRequestObject) (api.ListSessionsResponseObject, error) {
	// NEW: leavesOnly parameter (renamed from leafOnly, default true)
	leavesOnly := true
	if req.Params.LeavesOnly != nil {
		leavesOnly = *req.Params.LeavesOnly
	}

	// NEW: filter parameter logic
	var filterType string
	if req.Params.Filter != nil {
		filterType = string(*req.Params.Filter)
	}
	// When filter is nil, return ALL sessions (no filtering)

	// Get all sessions from manager
	sessionInfos := h.manager.ListSessions()

	// Determine which sessions to use for counting
	var sessionsForCounting []session.Info

	if leavesOnly {
		// Build parent-to-children map
		childrenMap := make(map[string][]string)
		for _, s := range sessionInfos {
			if s.ParentSessionID != "" {
				childrenMap[s.ParentSessionID] = append(childrenMap[s.ParentSessionID], s.ID)
			}
		}

		// When leavesOnly, only count leaf sessions
		for _, s := range sessionInfos {
			if len(childrenMap[s.ID]) == 0 {
				// This is a leaf session
				sessionsForCounting = append(sessionsForCounting, s)
			}
		}
	} else {
		// When not leavesOnly, count all sessions
		sessionsForCounting = sessionInfos
	}

	// Calculate counts based on the appropriate set of sessions
	var normalCount, archivedCount, draftCount int
	for _, s := range sessionsForCounting {
		if s.Archived {
			archivedCount++
		} else if s.Status == session.StatusDraft {
			draftCount++
		} else if s.Status != session.StatusDiscarded {
			normalCount++
		}
	}

	// Apply filters for the returned list
	var filtered []session.Info

	for _, s := range sessionsForCounting {
		// Apply filter logic
		if !shouldIncludeSession(s, filterType) {
			continue
		}

		filtered = append(filtered, s)
	}

	// Sort by last activity (newest first)
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].LastActivityAt.After(filtered[j].LastActivityAt)
	})

	// Convert to API sessions
	sessions := make([]api.Session, len(filtered))
	for i, info := range filtered {
		// Convert Info to store.Session for mapper
		storeSession := store.Session{
			ID:                                  info.ID,
			RunID:                               info.RunID,
			ClaudeSessionID:                     info.ClaudeSessionID,
			ParentSessionID:                     info.ParentSessionID,
			Status:                              string(info.Status),
			Query:                               info.Query,
			Summary:                             info.Summary,
			Title:                               info.Title,
			Model:                               info.Model,
			WorkingDir:                          info.WorkingDir,
			CreatedAt:                           info.StartTime,
			LastActivityAt:                      info.LastActivityAt,
			CompletedAt:                         info.EndTime,
			ErrorMessage:                        info.Error,
			AutoAcceptEdits:                     info.AutoAcceptEdits,
			DangerouslySkipPermissions:          info.DangerouslySkipPermissions,
			DangerouslySkipPermissionsExpiresAt: info.DangerouslySkipPermissionsExpiresAt,
			Archived:                            info.Archived,
		}

		// Copy result data if available
		if info.Result != nil {
			storeSession.CostUSD = &info.Result.CostUSD
			storeSession.DurationMS = &info.Result.DurationMS
		}

		sessions[i] = h.mapper.SessionToAPI(storeSession)
	}

	resp := api.SessionsResponse{
		Data: sessions,
		Counts: &struct {
			Archived *int `json:"archived,omitempty"`
			Draft    *int `json:"draft,omitempty"`
			Normal   *int `json:"normal,omitempty"`
		}{
			Normal:   &normalCount,
			Archived: &archivedCount,
			Draft:    &draftCount,
		},
	}
	return api.ListSessions200JSONResponse(resp), nil
}

// shouldIncludeSession helper function for filter logic
func shouldIncludeSession(s session.Info, filterType string) bool {
	switch filterType {
	case "normal":
		return !s.Archived && s.Status != session.StatusDraft && s.Status != session.StatusDiscarded
	case "archived":
		return s.Archived
	case "draft":
		return s.Status == session.StatusDraft && !s.Archived
	case "":
		// No filter specified - include ALL sessions
		return true
	default:
		// Unknown filter - include all (graceful degradation)
		return true
	}
}

// GetSession retrieves details for a specific session
func (h *SessionHandlers) GetSession(ctx context.Context, req api.GetSessionRequestObject) (api.GetSessionResponseObject, error) {
	session, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.GetSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get session",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "GetSession",
		)
		return api.GetSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.SessionResponse{
		Data: h.mapper.SessionToAPI(*session),
	}
	return api.GetSession200JSONResponse(resp), nil
}

// UpdateSession updates session settings (auto-accept, archived status)
func (h *SessionHandlers) UpdateSession(ctx context.Context, req api.UpdateSessionRequestObject) (api.UpdateSessionResponseObject, error) {
	// Debug log incoming request
	// slog.Debug("UpdateSession called", "sessionId", req.Id, "body", req.Body)

	update := store.SessionUpdate{}

	// Update auto-accept if specified
	if req.Body.AutoAcceptEdits != nil {
		update.AutoAcceptEdits = req.Body.AutoAcceptEdits
	}

	// Update archived status if specified
	if req.Body.Archived != nil {
		update.Archived = req.Body.Archived
	}

	// Update title if specified
	if req.Body.Title != nil {
		update.Title = req.Body.Title
	}

	// Update dangerously skip permissions if specified
	if req.Body.DangerouslySkipPermissions != nil {
		update.DangerouslySkipPermissions = req.Body.DangerouslySkipPermissions
	}

	// Update dangerously skip permissions timeout if specified
	if req.Body.DangerouslySkipPermissionsTimeoutMs != nil {
		timeoutMs := *req.Body.DangerouslySkipPermissionsTimeoutMs
		if timeoutMs > 0 {
			// Store the timeout duration so we can recalculate the timer later (e.g., when launching a draft)
			update.DangerouslySkipPermissionsTimeoutMs = &timeoutMs

			// Convert milliseconds to time.Time
			expiresAt := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
			expiresAtPtr := &expiresAt
			update.DangerouslySkipPermissionsExpiresAt = &expiresAtPtr
		} else {
			// Clear the expiration and timeout if timeout is 0
			var nilTime *time.Time
			var nilTimeout int64 = 0
			update.DangerouslySkipPermissionsExpiresAt = &nilTime
			update.DangerouslySkipPermissionsTimeoutMs = &nilTimeout
		}
	}

	// Update model if specified
	if req.Body.Model != nil {
		update.Model = req.Body.Model
	}
	if req.Body.ModelId != nil {
		update.ModelID = req.Body.ModelId
	}

	// Update proxy configuration if specified
	// Note: OpenAPI generates ProxyBaseUrl/ProxyApiKey (following JSON conventions)
	// but we map to ProxyBaseURL/ProxyAPIKey (following Go conventions for acronyms)
	if req.Body.ProxyEnabled != nil {
		update.ProxyEnabled = req.Body.ProxyEnabled
	}
	if req.Body.ProxyBaseUrl != nil {
		update.ProxyBaseURL = req.Body.ProxyBaseUrl // Intentional: ProxyBaseUrl -> ProxyBaseURL
	}
	if req.Body.ProxyModelOverride != nil {
		update.ProxyModelOverride = req.Body.ProxyModelOverride
	}
	if req.Body.ProxyApiKey != nil {
		update.ProxyAPIKey = req.Body.ProxyApiKey // Intentional: ProxyApiKey -> ProxyAPIKey
	}

	// Update additional directories if specified
	if req.Body.AdditionalDirectories != nil {
		// Convert to JSON string for storage
		dirJSON, err := json.Marshal(req.Body.AdditionalDirectories)
		if err == nil {
			dirStr := string(dirJSON)
			update.AdditionalDirectories = &dirStr
			slog.Info("Updating additional directories",
				"sessionId", req.Id,
				"directories", req.Body.AdditionalDirectories,
				"dirStr", dirStr)
		} else {
			slog.Error("Failed to marshal additional directories",
				"error", err,
				"directories", req.Body.AdditionalDirectories)
		}
	}

	// Update working directory if specified
	if req.Body.WorkingDir != nil {
		update.WorkingDir = req.Body.WorkingDir
		slog.Info("Updating working directory",
			"sessionId", req.Id,
			"workingDir", *req.Body.WorkingDir)
	}

	// Update editor state if specified
	if req.Body.EditorState != nil {
		update.EditorState = req.Body.EditorState
		// slog.Debug("Updating editor state",
		// 	"sessionId", req.Id,
		// 	"editorStateLength", len(*req.Body.EditorState))
	}

	err := h.manager.UpdateSessionSettings(ctx, string(req.Id), update)
	if err != nil {
		// Log the actual error for debugging
		slog.Error("UpdateSession error", "error", err, "sessionId", req.Id, "update", update)
		if errors.Is(err, sql.ErrNoRows) {
			return api.UpdateSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to update session settings",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "UpdateSession",
		)
		return api.UpdateSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Fetch updated session
	session, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		slog.Error("Failed to fetch updated session",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "UpdateSession",
		)
		return api.UpdateSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.SessionResponse{
		Data: h.mapper.SessionToAPI(*session),
	}
	return api.UpdateSession200JSONResponse(resp), nil
}

// DeleteDraftSession deletes a draft session
func (h *SessionHandlers) DeleteDraftSession(ctx context.Context, req api.DeleteDraftSessionRequestObject) (api.DeleteDraftSessionResponseObject, error) {
	// Get the session and verify it's a draft
	sess, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.DeleteDraftSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-4007",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get session for deletion",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "DeleteDraftSession",
		)
		return api.DeleteDraftSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4008",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Check if session is in draft state
	if sess.Status != store.SessionStatusDraft {
		return api.DeleteDraftSession400JSONResponse{
			Error: api.ErrorDetail{
				Code:    "HLD-4002",
				Message: "Can only delete draft sessions",
			},
		}, nil
	}

	// Mark session as discarded (effectively removing it from the active list)
	// We don't actually delete from the database, just mark as discarded
	discardedStatus := string(store.SessionStatusDiscarded)
	deletedMessage := "Draft session discarded"
	update := store.SessionUpdate{
		Status:       &discardedStatus,
		ErrorMessage: &deletedMessage,
	}

	err = h.store.UpdateSession(ctx, string(req.Id), update)
	if err != nil {
		slog.Error("Failed to mark draft session as discarded",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "DeleteDraftSession",
		)
		return api.DeleteDraftSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4009",
					Message: fmt.Sprintf("Failed to delete draft session: %v", err),
				},
			},
		}, nil
	}

	// Return 204 No Content on successful deletion
	return api.DeleteDraftSession204Response{}, nil
}

// LaunchDraftSession launches a draft session
func (h *SessionHandlers) LaunchDraftSession(ctx context.Context, req api.LaunchDraftSessionRequestObject) (api.LaunchDraftSessionResponseObject, error) {
	// Get the session and verify it's a draft
	sess, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.LaunchDraftSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-4003",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get draft session for launch",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "LaunchDraftSession",
		)
		return api.LaunchDraftSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4004",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Check if session is in draft state
	if sess.Status != store.SessionStatusDraft {
		return api.LaunchDraftSession400JSONResponse{
			Error: api.ErrorDetail{
				Code:    "HLD-4001",
				Message: "Session is not in draft state",
			},
		}, nil
	}

	// If bypass permissions is enabled with a stored timeout duration, recalculate the expiration
	// time from now, so the timer starts when the draft is launched rather than when it was set
	if sess.DangerouslySkipPermissions && sess.DangerouslySkipPermissionsTimeoutMs != nil && *sess.DangerouslySkipPermissionsTimeoutMs > 0 {
		timeoutMs := *sess.DangerouslySkipPermissionsTimeoutMs

		// Recalculate expiration from now
		expiresAt := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
		expiresAtPtr := &expiresAt

		// Update the session with the new expiration time
		update := store.SessionUpdate{
			DangerouslySkipPermissionsExpiresAt: &expiresAtPtr,
		}

		err = h.store.UpdateSession(ctx, string(req.Id), update)
		if err != nil {
			slog.Error("failed to update bypass permissions timer on draft launch",
				"session_id", req.Id,
				"error", err)
			// Don't fail the launch if timer update fails, but log it
		} else {
			slog.Info("recalculated bypass permissions timer on draft launch",
				"session_id", req.Id,
				"timeout_ms", timeoutMs)
		}
	}

	// Launch the draft session
	err = h.manager.LaunchDraftSession(ctx, string(req.Id), req.Body.Prompt)
	if err != nil {
		slog.Error("Failed to launch draft session",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "LaunchDraftSession")
		return api.LaunchDraftSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4005",
					Message: fmt.Sprintf("Failed to launch draft session: %v", err),
				},
			},
		}, nil
	}

	// Fetch updated session to return
	updatedSession, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		slog.Error("Failed to get updated session after launch",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "LaunchDraftSession",
		)
		return api.LaunchDraftSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4006",
					Message: "Failed to get updated session after launch",
				},
			},
		}, nil
	}

	resp := api.SessionResponse{
		Data: h.mapper.SessionToAPI(*updatedSession),
	}
	return api.LaunchDraftSession200JSONResponse(resp), nil
}

// ContinueSession creates a new session that continues from an existing one
func (h *SessionHandlers) ContinueSession(ctx context.Context, req api.ContinueSessionRequestObject) (api.ContinueSessionResponseObject, error) {
	parentSession, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.ContinueSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get parent session for continuation",
			"error", fmt.Sprintf("%v", err),
			"parent_session_id", req.Id,
			"operation", "ContinueSession",
		)
		return api.ContinueSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Check if parent session is in draft state
	if parentSession.Status == store.SessionStatusDraft {
		return api.ContinueSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4003",
					Message: "Cannot continue from draft session",
				},
			},
		}, nil
	}

	// Build continue config
	continueConfig := session.ContinueSessionConfig{
		ParentSessionID: string(req.Id),
		Query:           req.Body.Query,
	}

	// Handle optional fields
	if req.Body.SystemPrompt != nil {
		continueConfig.SystemPrompt = *req.Body.SystemPrompt
	}
	if req.Body.AppendSystemPrompt != nil {
		continueConfig.AppendSystemPrompt = *req.Body.AppendSystemPrompt
	}
	if req.Body.PermissionPromptTool != nil {
		continueConfig.PermissionPromptTool = *req.Body.PermissionPromptTool
	}
	if req.Body.AllowedTools != nil {
		continueConfig.AllowedTools = *req.Body.AllowedTools
	}
	if req.Body.DisallowedTools != nil {
		continueConfig.DisallowedTools = *req.Body.DisallowedTools
	}
	if req.Body.CustomInstructions != nil {
		continueConfig.CustomInstructions = *req.Body.CustomInstructions
	}
	if req.Body.MaxTurns != nil {
		continueConfig.MaxTurns = *req.Body.MaxTurns
	}

	// Handle MCP config if provided
	if req.Body.McpConfig != nil {
		continueConfig.MCPConfig = h.mapper.MCPConfigFromAPI(req.Body.McpConfig)
	}

	result, err := h.manager.ContinueSession(ctx, continueConfig)
	if err != nil {
		slog.Error("Failed to continue session",
			"error", fmt.Sprintf("%v", err),
			"parent_session_id", req.Id,
			"query", req.Body.Query,
			"operation", "ContinueSession",
		)
		return api.ContinueSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Get the created session to get the claude session ID
	newSession, err := h.store.GetSession(ctx, result.ID)
	if err != nil {
		slog.Error("Failed to get created session details",
			"error", fmt.Sprintf("%v", err),
			"parent_session_id", req.Id,
			"new_session_id", result.ID,
			"operation", "ContinueSession",
		)
		return api.ContinueSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: "Failed to get created session details",
				},
			},
		}, nil
	}

	resp := api.ContinueSessionResponse{}
	resp.Data.SessionId = result.ID
	resp.Data.RunId = result.RunID
	resp.Data.ClaudeSessionId = newSession.ClaudeSessionID
	resp.Data.ParentSessionId = string(req.Id)
	return api.ContinueSession201JSONResponse(resp), nil
}

// InterruptSession sends an interrupt signal to a running session
func (h *SessionHandlers) InterruptSession(ctx context.Context, req api.InterruptSessionRequestObject) (api.InterruptSessionResponseObject, error) {
	session, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.InterruptSession404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get session for interrupt",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "InterruptSession",
		)
		return api.InterruptSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	if session.Status != "running" {
		return api.InterruptSession400JSONResponse{
			Error: api.ErrorDetail{
				Code:    "HLD-3001",
				Message: fmt.Sprintf("Cannot interrupt session in status: %s", session.Status),
			},
		}, nil
	}

	err = h.manager.InterruptSession(ctx, string(req.Id))
	if err != nil {
		slog.Error("Failed to interrupt session",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "InterruptSession",
		)
		return api.InterruptSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	resp := api.InterruptSessionResponse{}
	resp.Data.Success = true
	resp.Data.SessionId = string(req.Id)
	resp.Data.Status = api.InterruptSessionResponseDataStatusInterrupting
	return api.InterruptSession200JSONResponse(resp), nil
}

// GetSessionMessages retrieves conversation history for a session
func (h *SessionHandlers) GetSessionMessages(ctx context.Context, req api.GetSessionMessagesRequestObject) (api.GetSessionMessagesResponseObject, error) {
	events, err := h.store.GetSessionConversation(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.GetSessionMessages404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to get session conversation",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "GetSessionMessages",
		)
		return api.GetSessionMessages500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	// Convert to API events
	apiEvents := make([]api.ConversationEvent, len(events))
	for i, event := range events {
		apiEvents[i] = h.mapper.ConversationEventToAPI(*event)
	}

	return api.GetSessionMessages200JSONResponse{
		Data: apiEvents,
	}, nil
}

// GetSessionSnapshots retrieves file snapshots for a session
func (h *SessionHandlers) GetSessionSnapshots(ctx context.Context, req api.GetSessionSnapshotsRequestObject) (api.GetSessionSnapshotsResponseObject, error) {
	// Verify session exists
	_, err := h.store.GetSession(ctx, string(req.Id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return api.GetSessionSnapshots404JSONResponse{
				NotFoundJSONResponse: api.NotFoundJSONResponse{
					Error: api.ErrorDetail{
						Code:    "HLD-1002",
						Message: "Session not found",
					},
				},
			}, nil
		}
		slog.Error("Failed to verify session exists for snapshots",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "GetSessionSnapshots",
		)
		return api.GetSessionSnapshots500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	snapshots, err := h.store.GetFileSnapshots(ctx, string(req.Id))
	if err != nil {
		slog.Error("Failed to get file snapshots",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Id,
			"operation", "GetSessionSnapshots",
		)
		return api.GetSessionSnapshots500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	return api.GetSessionSnapshots200JSONResponse{
		Data: h.mapper.SnapshotsToAPI(snapshots),
	}, nil
}

// BulkArchiveSessions archives or unarchives multiple sessions
func (h *SessionHandlers) BulkArchiveSessions(ctx context.Context, req api.BulkArchiveSessionsRequestObject) (api.BulkArchiveSessionsResponseObject, error) {
	if len(req.Body.SessionIds) == 0 {
		return api.BulkArchiveSessions400JSONResponse{
			BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-3001",
					Message: "session_ids must not be empty",
				},
			},
		}, nil
	}

	var failedSessions []string
	for _, sessionID := range req.Body.SessionIds {
		update := store.SessionUpdate{
			Archived: &req.Body.Archived,
		}
		err := h.store.UpdateSession(ctx, sessionID, update)
		if err != nil {
			failedSessions = append(failedSessions, sessionID)
		}
	}

	// Return 207 for partial success
	if len(failedSessions) > 0 {
		return api.BulkArchiveSessions207JSONResponse{
			Data: struct {
				FailedSessions *[]string `json:"failed_sessions,omitempty"`
				Success        bool      `json:"success"`
			}{
				Success:        false,
				FailedSessions: &failedSessions,
			},
		}, nil
	}

	return api.BulkArchiveSessions200JSONResponse{
		Data: struct {
			FailedSessions *[]string `json:"failed_sessions,omitempty"`
			Success        bool      `json:"success"`
		}{
			Success: true,
		},
	}, nil
}

// GetRecentPaths retrieves recently used working directories
func (h *SessionHandlers) GetRecentPaths(ctx context.Context, req api.GetRecentPathsRequestObject) (api.GetRecentPathsResponseObject, error) {
	limit := 20
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}

	paths, err := h.store.GetRecentWorkingDirs(ctx, limit)
	if err != nil {
		slog.Error("Failed to get recent working directories",
			"error", fmt.Sprintf("%v", err),
			"limit", limit,
			"operation", "GetRecentPaths",
		)
		return api.GetRecentPaths500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
				},
			},
		}, nil
	}

	return api.GetRecentPaths200JSONResponse{
		Data: h.mapper.RecentPathsToAPI(paths),
	}, nil
}

// GetHealth returns the health status of the daemon
func (h *SessionHandlers) GetHealth(ctx context.Context, req api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	// Check Claude availability
	claudeAvailable := h.sessionManager.IsClaudeAvailable()
	claudePath := h.sessionManager.GetClaudeBinaryPath()

	// Check Claude version if available
	var claudeVersion *string
	var versionError *string
	if claudeAvailable {
		if version, err := h.sessionManager.GetClaudeVersion(); err != nil {
			versionErrorMsg := err.Error()
			versionError = &versionErrorMsg
			slog.Warn("Failed to get Claude version", "error", err, "path", claudePath)
		} else {
			claudeVersion = &version
			slog.Debug("Claude version retrieved", "version", version, "path", claudePath)
		}
	}

	// Determine overall status
	overallStatus := api.Ok
	if !claudeAvailable {
		overallStatus = api.Degraded
	}

	// Build response
	response := api.GetHealth200JSONResponse{
		Status:  overallStatus,
		Version: h.version,
	}

	// Always add dependencies to show Claude status
	claudeInfo := struct {
		Available    bool    `json:"available"`
		Error        *string `json:"error"`
		Path         *string `json:"path"`
		Version      *string `json:"version"`
		VersionError *string `json:"version_error"`
	}{
		Available:    claudeAvailable,
		Version:      claudeVersion,
		VersionError: versionError,
	}

	if claudePath != "" {
		claudeInfo.Path = &claudePath
	}

	if !claudeAvailable {
		errorMsg := "Claude binary not found in PATH or common locations"
		claudeInfo.Error = &errorMsg
	}

	response.Dependencies = &struct {
		Claude *struct {
			Available    bool    `json:"available"`
			Error        *string `json:"error"`
			Path         *string `json:"path"`
			Version      *string `json:"version"`
			VersionError *string `json:"version_error"`
		} `json:"claude,omitempty"`
	}{
		Claude: &claudeInfo,
	}

	return response, nil
}

// GetConfig retrieves the current daemon configuration
func (h *SessionHandlers) GetConfig(ctx context.Context, req api.GetConfigRequestObject) (api.GetConfigResponseObject, error) {
	detectedPath := h.sessionManager.GetClaudeBinaryPath()
	return api.GetConfig200JSONResponse{
		ClaudePath:         h.sessionManager.GetClaudePath(),
		ClaudeDetectedPath: &detectedPath,
		ClaudeAvailable:    h.sessionManager.IsClaudeAvailable(),
	}, nil
}

// UpdateConfig updates daemon runtime configuration
func (h *SessionHandlers) UpdateConfig(ctx context.Context, req api.UpdateConfigRequestObject) (api.UpdateConfigResponseObject, error) {
	if req.Body.ClaudePath != nil {
		// Update session manager's Claude path
		h.sessionManager.UpdateClaudePath(*req.Body.ClaudePath)

		// Persist to config file for next startup
		if err := h.persistClaudePath(*req.Body.ClaudePath); err != nil {
			slog.Error("failed to persist Claude path", "error", err)
			// Continue anyway - at least update in-memory
		}

		// Check if Claude is available at new path
		available := h.sessionManager.IsClaudeAvailable()
		detectedPath := h.sessionManager.GetClaudeBinaryPath()

		return api.UpdateConfig200JSONResponse{
			ClaudePath:         *req.Body.ClaudePath,
			ClaudeDetectedPath: &detectedPath,
			ClaudeAvailable:    available,
		}, nil
	}

	detectedPath := h.sessionManager.GetClaudeBinaryPath()
	return api.UpdateConfig200JSONResponse{
		ClaudePath:         h.sessionManager.GetClaudePath(),
		ClaudeDetectedPath: &detectedPath,
		ClaudeAvailable:    h.sessionManager.IsClaudeAvailable(),
	}, nil
}

// persistClaudePath persists Claude path to config file
func (h *SessionHandlers) persistClaudePath(path string) error {
	if h.config == nil {
		return fmt.Errorf("config not available")
	}

	// Update the config struct
	h.config.ClaudePath = path

	// Save to file
	if err := config.Save(h.config); err != nil {
		slog.Error("failed to persist Claude path to config", "path", path, "error", err)
		return fmt.Errorf("failed to save config: %w", err)
	}

	slog.Info("persisted Claude path to config", "path", path)
	return nil
}

// GetDebugInfo returns debug information about the daemon
func (h *SessionHandlers) GetDebugInfo(ctx context.Context, req api.GetDebugInfoRequestObject) (api.GetDebugInfoResponseObject, error) {
	stats := make(map[string]int64)
	var size int64
	var lastModified *time.Time

	// Get database path from config if available
	dbPath := ""
	if h.config != nil {
		dbPath = h.config.DatabasePath
	}

	// Get file stats if path is available and not in-memory
	if dbPath != "" && dbPath != ":memory:" {
		if fileInfo, err := os.Stat(dbPath); err == nil {
			size = fileInfo.Size()
			modTime := fileInfo.ModTime()
			lastModified = &modTime
		}
	}

	// Get table counts from the store
	if sqliteStore, ok := h.store.(*store.SQLiteStore); ok {
		// Get session count
		if count, err := sqliteStore.GetSessionCount(ctx); err == nil {
			stats["sessions"] = int64(count)
		}

		// Get approval count
		if count, err := sqliteStore.GetApprovalCount(ctx); err == nil {
			stats["approvals"] = int64(count)
		}

		// Get event count
		if count, err := sqliteStore.GetEventCount(ctx); err == nil {
			stats["events"] = int64(count)
		}
	}

	response := api.GetDebugInfo200JSONResponse{
		Path:       dbPath,
		Size:       size,
		TableCount: 5, // We have 5 tables: sessions, conversation_events, approvals, mcp_servers, schema_version
		Stats:      stats,
		CliCommand: config.DefaultCLICommand,
	}

	if lastModified != nil {
		response.LastModified = lastModified
	}

	return response, nil
}

// GetSlashCommands retrieves available slash commands for a session
func (h *SessionHandlers) GetSlashCommands(ctx context.Context, req api.GetSlashCommandsRequestObject) (api.GetSlashCommandsResponseObject, error) {
	// Get session to access working directory
	session, err := h.store.GetSession(ctx, req.Params.SessionId)
	if err != nil {
		slog.Error("Failed to get session for slash commands",
			"error", fmt.Sprintf("%v", err),
			"session_id", req.Params.SessionId,
			"operation", "GetSlashCommands",
		)
		return api.GetSlashCommands400JSONResponse{
			BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: "Invalid session ID",
				},
			},
		}, nil
	}

	// Build command directory paths
	localCommandsDir := filepath.Join(expandTilde(session.WorkingDir), ".claude", "commands")
	homeDir, err := os.UserHomeDir()
	globalCommandsDir := ""
	if err == nil {
		globalCommandsDir = filepath.Join(homeDir, ".claude", "commands")
	}

	// Use a map to track commands and handle deduplication
	// Key is command name, value is the command with source
	commandMap := make(map[string]api.SlashCommand)

	// Helper function to discover commands from a directory
	discoverCommands := func(dir string, source api.SlashCommandSource) error {
		if dir == "" {
			return nil
		}

		return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				// Directory might not exist, that's ok
				return nil
			}

			if !d.IsDir() && strings.HasSuffix(path, ".md") {
				// Convert path to command name with colon convention
				relPath, _ := filepath.Rel(dir, path)
				commandName := strings.TrimSuffix(relPath, ".md")

				// Convert path separators to colons
				commandName = strings.ReplaceAll(commandName, string(filepath.Separator), ":")
				fullCommandName := "/" + commandName

				// Check if command already exists
				if _, exists := commandMap[fullCommandName]; exists {
					// Global commands take precedence
					if source == api.Global {
						commandMap[fullCommandName] = api.SlashCommand{
							Name:   fullCommandName,
							Source: source,
						}
					}
					// If source is "local" and global already exists, do nothing (global wins)
				} else {
					// New command, add it
					commandMap[fullCommandName] = api.SlashCommand{
						Name:   fullCommandName,
						Source: source,
					}
				}
			}

			return nil
		})
	}

	// Discover local commands first
	if err := discoverCommands(localCommandsDir, api.Local); err != nil && !os.IsNotExist(err) {
		slog.Warn("Failed to read local commands directory",
			"error", fmt.Sprintf("%v", err),
			"commands_dir", localCommandsDir,
			"operation", "GetSlashCommands",
		)
	}

	// Then discover global commands (these will override local if duplicates exist)
	if err := discoverCommands(globalCommandsDir, api.Global); err != nil && !os.IsNotExist(err) {
		slog.Warn("Failed to read global commands directory",
			"error", fmt.Sprintf("%v", err),
			"commands_dir", globalCommandsDir,
			"operation", "GetSlashCommands",
		)
	}

	// Extract all commands from map
	var allCommands []api.SlashCommand
	for _, cmd := range commandMap {
		allCommands = append(allCommands, cmd)
	}

	// Initialize results as empty array instead of nil
	results := []api.SlashCommand{}

	// Apply fuzzy search if query provided
	if req.Params.Query != nil && *req.Params.Query != "" && *req.Params.Query != "/" {
		query := strings.TrimPrefix(*req.Params.Query, "/")

		// Create searchable items (without slash prefix)
		type searchItem struct {
			Command api.SlashCommand
			Name    string
		}
		var searchItems []searchItem
		for _, cmd := range allCommands {
			searchItems = append(searchItems, searchItem{
				Command: cmd,
				Name:    strings.TrimPrefix(cmd.Name, "/"),
			})
		}

		// Extract just names for fuzzy search
		var names []string
		for _, item := range searchItems {
			names = append(names, item.Name)
		}

		// Fuzzy search
		matches := fuzzy.Find(query, names)

		// Build results maintaining the original command objects with source
		for _, match := range matches {
			for _, item := range searchItems {
				if item.Name == match.Str {
					results = append(results, item.Command)
					break
				}
			}
		}
	} else {
		// Return all commands if no query
		results = allCommands

		// Sort alphabetically when no query, with local as tiebreaker
		sort.Slice(results, func(i, j int) bool {
			// Sort by name, but local comes before global as tiebreaker
			if results[i].Name == results[j].Name {
				return results[i].Source == api.Local && results[j].Source == api.Global
			}
			return results[i].Name < results[j].Name
		})
	}

	return api.GetSlashCommands200JSONResponse{
		Data: results,
	}, nil
}
