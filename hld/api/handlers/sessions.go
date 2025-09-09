package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"time"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/api"
	"github.com/humanlayer/humanlayer/hld/api/mapper"
	"github.com/humanlayer/humanlayer/hld/approval"
	"github.com/humanlayer/humanlayer/hld/config"
	"github.com/humanlayer/humanlayer/hld/internal/version"
	"github.com/humanlayer/humanlayer/hld/session"
	"github.com/humanlayer/humanlayer/hld/store"
)

type SessionHandlers struct {
	manager         session.SessionManager
	store           store.ConversationStore
	approvalManager approval.Manager
	mapper          *mapper.Mapper
	version         string
	config          *config.Config
}

func NewSessionHandlers(manager session.SessionManager, store store.ConversationStore, approvalManager approval.Manager) *SessionHandlers {
	return &SessionHandlers{
		manager:         manager,
		store:           store,
		approvalManager: approvalManager,
		mapper:          &mapper.Mapper{},
		version:         version.GetVersion(), // TODO(4): Add support for full point releases
	}
}

func NewSessionHandlersWithConfig(manager session.SessionManager, store store.ConversationStore, approvalManager approval.Manager, cfg *config.Config) *SessionHandlers {
	return &SessionHandlers{
		manager:         manager,
		store:           store,
		approvalManager: approvalManager,
		mapper:          &mapper.Mapper{},
		version:         version.GetVersion(),
		config:          cfg,
	}
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

	// Handle provider
	if req.Body.Provider != nil {
		config.Provider = *req.Body.Provider
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
		default:
			// Let Claude decide the default
		}
	}

	session, err := h.manager.LaunchSession(ctx, config)
	if err != nil {
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
	leafOnly := true
	if req.Params.LeafOnly != nil {
		leafOnly = *req.Params.LeafOnly
	}

	includeArchived := false
	if req.Params.IncludeArchived != nil {
		includeArchived = *req.Params.IncludeArchived
	}

	archivedOnly := false
	if req.Params.ArchivedOnly != nil {
		archivedOnly = *req.Params.ArchivedOnly
	}

	// Get all sessions from manager
	sessionInfos := h.manager.ListSessions()

	// Apply filters
	var filtered []session.Info

	if leafOnly {
		// Build parent-to-children map
		childrenMap := make(map[string][]string)
		for _, s := range sessionInfos {
			if s.ParentSessionID != "" {
				childrenMap[s.ParentSessionID] = append(childrenMap[s.ParentSessionID], s.ID)
			}
		}

		// Filter to leaves only
		for _, s := range sessionInfos {
			if len(childrenMap[s.ID]) > 0 {
				continue // Has children, not a leaf
			}

			// Apply archive filter
			if !includeArchived && s.Archived {
				continue
			}
			if archivedOnly && !s.Archived {
				continue
			}

			filtered = append(filtered, s)
		}
	} else {
		// All sessions, apply archive filter
		for _, s := range sessionInfos {
			if !includeArchived && s.Archived {
				continue
			}
			if archivedOnly && !s.Archived {
				continue
			}

			filtered = append(filtered, s)
		}
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
	}
	return api.ListSessions200JSONResponse(resp), nil
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
	slog.Info("UpdateSession called", "sessionId", req.Id, "body", req.Body)

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
			// Convert milliseconds to time.Time
			expiresAt := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
			expiresAtPtr := &expiresAt
			update.DangerouslySkipPermissionsExpiresAt = &expiresAtPtr
		} else {
			// Clear the expiration if timeout is 0
			var nilTime *time.Time
			update.DangerouslySkipPermissionsExpiresAt = &nilTime
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

// ContinueSession creates a new session that continues from an existing one
func (h *SessionHandlers) ContinueSession(ctx context.Context, req api.ContinueSessionRequestObject) (api.ContinueSessionResponseObject, error) {
	_, err := h.store.GetSession(ctx, string(req.Id))
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
		return api.ContinueSession500JSONResponse{
			InternalErrorJSONResponse: api.InternalErrorJSONResponse{
				Error: api.ErrorDetail{
					Code:    "HLD-4001",
					Message: err.Error(),
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
	return api.GetHealth200JSONResponse{
		Status:  api.Ok,
		Version: h.version,
	}, nil
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
