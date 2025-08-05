package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// Manager handles the lifecycle of Claude Code sessions
type Manager struct {
	activeProcesses    map[string]ClaudeSession // Maps session ID to active Claude process
	mu                 sync.RWMutex
	client             *claudecode.Client
	eventBus           bus.EventBus
	store              store.ConversationStore
	approvalReconciler ApprovalReconciler
	pendingQueries     sync.Map // map[sessionID]query - stores queries waiting for Claude session ID
	socketPath         string   // Daemon socket path for MCP servers
}

// Compile-time check that Manager implements SessionManager
var _ SessionManager = (*Manager)(nil)

// NewManager creates a new session manager with required store
func NewManager(eventBus bus.EventBus, store store.ConversationStore, socketPath string) (*Manager, error) {
	if store == nil {
		return nil, fmt.Errorf("store is required")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create Claude client: %w", err)
	}

	return &Manager{
		activeProcesses: make(map[string]ClaudeSession),
		client:          client,
		eventBus:        eventBus,
		store:           store,
		socketPath:      socketPath,
	}, nil
}

// SetApprovalReconciler sets the approval reconciler for the session manager
func (m *Manager) SetApprovalReconciler(reconciler ApprovalReconciler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.approvalReconciler = reconciler
}

// LaunchSession starts a new Claude Code session
func (m *Manager) LaunchSession(ctx context.Context, config LaunchSessionConfig) (*Session, error) {
	// Generate unique IDs
	sessionID := uuid.New().String()
	runID := uuid.New().String()

	// Extract the Claude config (without daemon-level settings)
	claudeConfig := config.SessionConfig

	// Add HUMANLAYER_RUN_ID and HUMANLAYER_DAEMON_SOCKET to MCP server environment
	if claudeConfig.MCPConfig != nil {
		slog.Debug("configuring MCP servers", "count", len(claudeConfig.MCPConfig.MCPServers))
		for name, server := range claudeConfig.MCPConfig.MCPServers {
			if server.Env == nil {
				server.Env = make(map[string]string)
			}
			server.Env["HUMANLAYER_RUN_ID"] = runID
			// Add daemon socket path so MCP servers connect to the correct daemon
			if m.socketPath != "" {
				server.Env["HUMANLAYER_DAEMON_SOCKET"] = m.socketPath
			}
			claudeConfig.MCPConfig.MCPServers[name] = server
			slog.Debug("configured MCP server",
				"name", name,
				"command", server.Command,
				"args", server.Args,
				"run_id", runID,
				"socket_path", m.socketPath)
		}
	} else {
		slog.Debug("no MCP config provided")
	}

	// Capture current working directory if not specified
	if claudeConfig.WorkingDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			slog.Warn("failed to get current working directory", "error", err)
		} else {
			claudeConfig.WorkingDir = cwd
			slog.Debug("No working directory provided, falling back to cwd of daemon", "working_dir", cwd)
		}
	}

	// Create session record directly in database
	startTime := time.Now()

	// Store session in database
	dbSession := store.NewSessionFromConfig(sessionID, runID, claudeConfig)
	dbSession.Summary = CalculateSummary(claudeConfig.Query)

	// Handle dangerously skip permissions from config
	if config.DangerouslySkipPermissions {
		dbSession.DangerouslySkipPermissions = true
		// Only set expiry if timeout is provided
		if config.DangerouslySkipPermissionsTimeout != nil && *config.DangerouslySkipPermissionsTimeout > 0 {
			expiresAt := time.Now().Add(time.Duration(*config.DangerouslySkipPermissionsTimeout) * time.Millisecond)
			dbSession.DangerouslySkipPermissionsExpiresAt = &expiresAt
		}
	}

	if err := m.store.CreateSession(ctx, dbSession); err != nil {
		return nil, fmt.Errorf("failed to store session in database: %w", err)
	}

	// Store MCP servers if configured
	if claudeConfig.MCPConfig != nil && len(claudeConfig.MCPConfig.MCPServers) > 0 {
		servers, err := store.MCPServersFromConfig(sessionID, claudeConfig.MCPConfig.MCPServers)
		if err != nil {
			slog.Error("failed to convert MCP servers", "error", err)
		} else if err := m.store.StoreMCPServers(ctx, sessionID, servers); err != nil {
			slog.Error("failed to store MCP servers", "error", err)
		}
	}

	// No longer storing full session in memory

	// Log final configuration before launching
	var mcpServersDetail string
	var mcpServerCount int
	if claudeConfig.MCPConfig != nil {
		mcpServerCount = len(claudeConfig.MCPConfig.MCPServers)
		for name, server := range claudeConfig.MCPConfig.MCPServers {
			mcpServersDetail += fmt.Sprintf("[%s: cmd=%s args=%v env=%v] ", name, server.Command, server.Args, server.Env)
		}
	}
	slog.Info("launching Claude session with configuration",
		"session_id", sessionID,
		"run_id", runID,
		"query", claudeConfig.Query,
		"working_dir", claudeConfig.WorkingDir,
		"permission_prompt_tool", claudeConfig.PermissionPromptTool,
		"mcp_servers", mcpServerCount,
		"mcp_servers_detail", mcpServersDetail)

	// Launch Claude session (without daemon-level settings)
	claudeSession, err := m.client.Launch(claudeConfig)
	if err != nil {
		slog.Error("failed to launch Claude session",
			"session_id", sessionID,
			"error", err,
			"config", fmt.Sprintf("%+v", claudeConfig))
		m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
		return nil, fmt.Errorf("failed to launch Claude session: %w", err)
	}

	// Wrap the session for storage
	wrappedSession := NewClaudeSessionWrapper(claudeSession)

	// Store active Claude process
	m.mu.Lock()
	m.activeProcesses[sessionID] = wrappedSession
	m.mu.Unlock()

	// Update database with running status
	statusRunning := string(StatusRunning)
	now := time.Now()
	update := store.SessionUpdate{
		Status:         &statusRunning,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		slog.Error("failed to update session status to running", "error", err)
		// Continue anyway
	}

	// Publish status change event
	if m.eventBus != nil {
		event := bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"run_id":     runID,
				"old_status": string(StatusStarting),
				"new_status": string(StatusRunning),
			},
		}
		slog.Info("publishing session status changed event",
			"session_id", sessionID,
			"run_id", runID,
			"event_type", event.Type,
			"event_data", event.Data,
		)
		m.eventBus.Publish(event)
	}

	// Store query for injection after Claude session ID is captured
	m.pendingQueries.Store(sessionID, claudeConfig.Query)

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, wrappedSession, startTime, claudeConfig)

	// Reconcile any existing approvals for this run_id
	if m.approvalReconciler != nil {
		go func() {
			// Give the session a moment to start
			time.Sleep(2 * time.Second)
			if err := m.approvalReconciler.ReconcileApprovalsForSession(ctx, runID); err != nil {
				slog.Error("failed to reconcile approvals for session",
					"session_id", sessionID,
					"run_id", runID,
					"error", err)
			}
		}()
	}

	slog.Info("launched Claude session",
		"session_id", sessionID,
		"run_id", runID,
		"query", claudeConfig.Query,
		"permission_prompt_tool", claudeConfig.PermissionPromptTool)

	// Return minimal session info for launch response
	return &Session{
		ID:        sessionID,
		RunID:     runID,
		Status:    StatusRunning,
		StartTime: startTime,
		Config:    claudeConfig,
	}, nil
}

// monitorSession tracks the lifecycle of a Claude session
func (m *Manager) monitorSession(ctx context.Context, sessionID, runID string, claudeSession ClaudeSession, startTime time.Time, config claudecode.SessionConfig) {
	// Get the session ID from the Claude session once available
	var claudeSessionID string

eventLoop:
	for {
		select {
		case <-ctx.Done():
			// Context cancelled, stop processing
			slog.Debug("monitorSession context cancelled, stopping event processing",
				"session_id", sessionID)
			return
		case event, ok := <-claudeSession.GetEvents():
			if !ok {
				// Channel closed, exit loop
				break eventLoop
			}

			// Check context before each database operation
			if ctx.Err() != nil {
				slog.Debug("context cancelled during event processing",
					"session_id", sessionID)
				return
			}

			// Store raw event for debugging
			eventJSON, err := json.Marshal(event)
			if err != nil {
				slog.Error("failed to marshal event", "error", err)
			} else {
				if err := m.store.StoreRawEvent(ctx, sessionID, string(eventJSON)); err != nil {
					slog.Debug("failed to store raw event", "error", err)
				}
			}

			// Capture Claude session ID
			if event.SessionID != "" && claudeSessionID == "" {
				claudeSessionID = event.SessionID
				// Note: Claude session ID captured for resume capability
				slog.Debug("captured Claude session ID",
					"session_id", sessionID,
					"claude_session_id", claudeSessionID)

				// Update database
				update := store.SessionUpdate{
					ClaudeSessionID: &claudeSessionID,
				}
				if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
					slog.Error("failed to update session in database", "error", err)
				}

				// Inject the pending query now that we have Claude session ID
				if queryVal, ok := m.pendingQueries.LoadAndDelete(sessionID); ok {
					if query, ok := queryVal.(string); ok && query != "" {
						if err := m.injectQueryAsFirstEvent(ctx, sessionID, claudeSessionID, query); err != nil {
							slog.Error("failed to inject query as first event",
								"sessionID", sessionID,
								"claudeSessionID", claudeSessionID,
								"error", err)
						}
					}
				}
			}

			// Process and store event
			if err := m.processStreamEvent(ctx, sessionID, claudeSessionID, event); err != nil {
				slog.Error("failed to process stream event", "error", err)
			}
		}
	}

	// Wait for session to complete
	result, err := claudeSession.Wait()

	// Check if context was cancelled before updating database
	if ctx.Err() != nil {
		slog.Debug("context cancelled, skipping final session updates",
			"session_id", sessionID)
		return
	}

	endTime := time.Now()

	// First check if this was an intentional interrupt (regardless of error)
	session, dbErr := m.store.GetSession(ctx, sessionID)
	if dbErr == nil && session != nil && session.Status == string(StatusInterrupting) {
		// This was an interrupted session, mark as interrupted (not failed or completed)
		slog.Debug("session was interrupted, marking as interrupted",
			"session_id", sessionID,
			"status", session.Status)
		interruptedStatus := string(StatusInterrupted)
		now := time.Now()
		update := store.SessionUpdate{
			Status:      &interruptedStatus,
			CompletedAt: &now,
		}
		if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
			slog.Error("failed to update session to interrupted status", "error", err)
		}
		// Publish status change event
		if m.eventBus != nil {
			m.eventBus.Publish(bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": sessionID,
					"run_id":     runID,
					"old_status": string(StatusInterrupting),
					"new_status": string(StatusInterrupted),
				},
			})
		}
	} else if err != nil {
		m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
	} else if result != nil && result.IsError {
		m.updateSessionStatus(ctx, sessionID, StatusFailed, result.Error)
	} else {
		// No longer updating in-memory session

		// Update database with completion status
		statusCompleted := string(StatusCompleted)
		update := store.SessionUpdate{
			Status:      &statusCompleted,
			CompletedAt: &endTime,
		}
		if result != nil {
			if result.CostUSD > 0 {
				update.CostUSD = &result.CostUSD
			}
			duration := int(endTime.Sub(startTime).Milliseconds())
			update.DurationMS = &duration
			if result.NumTurns > 0 {
				update.NumTurns = &result.NumTurns
			}
			if result.Result != "" {
				update.ResultContent = &result.Result
			}
		}
		if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
			slog.Error("failed to update session completion in database", "error", err)
		}

		// Publish status change event
		if m.eventBus != nil {
			event := bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": sessionID,
					"run_id":     runID,
					"old_status": string(StatusRunning),
					"new_status": string(StatusCompleted),
				},
			}
			slog.Info("publishing session completion event",
				"session_id", sessionID,
				"run_id", runID,
				"event_type", event.Type,
				"event_data", event.Data,
			)
			m.eventBus.Publish(event)
		}
	}

	slog.Info("session completed",
		"session_id", sessionID,
		"status", StatusCompleted,
		"duration", endTime.Sub(startTime))

	// Clean up active process
	m.mu.Lock()
	delete(m.activeProcesses, sessionID)
	m.mu.Unlock()

	// Clean up any pending queries that weren't injected
	m.pendingQueries.Delete(sessionID)
}

// updateSessionStatus updates the status of a session in the database
func (m *Manager) updateSessionStatus(ctx context.Context, sessionID string, status Status, errorMsg string) {
	// Update database
	dbStatus := string(status)
	update := store.SessionUpdate{
		Status: &dbStatus,
	}
	if errorMsg != "" {
		update.ErrorMessage = &errorMsg
	}
	if status == StatusCompleted || status == StatusFailed {
		now := time.Now()
		update.CompletedAt = &now

		// Clean up active process if exists
		m.mu.Lock()
		delete(m.activeProcesses, sessionID)
		m.mu.Unlock()

		// Clean up any pending queries
		m.pendingQueries.Delete(sessionID)
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		slog.Error("failed to update session status in database", "error", err)
	}

	// Note: We can't publish status change events without knowing the old status
	// This would require a database read. For now, we'll skip the event.
}

// GetSessionInfo returns session info from the database by ID
func (m *Manager) GetSessionInfo(sessionID string) (*Info, error) {
	ctx := context.Background()
	dbSession, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session not found: %w", err)
	}

	info := &Info{
		ID:              dbSession.ID,
		RunID:           dbSession.RunID,
		ClaudeSessionID: dbSession.ClaudeSessionID,
		ParentSessionID: dbSession.ParentSessionID,
		Status:          Status(dbSession.Status),
		StartTime:       dbSession.CreatedAt,
		LastActivityAt:  dbSession.LastActivityAt,
		Error:           dbSession.ErrorMessage,
		Query:           dbSession.Query,
		Summary:         dbSession.Summary,
		Title:           dbSession.Title,
		Model:           dbSession.Model,
		WorkingDir:      dbSession.WorkingDir,
		AutoAcceptEdits: dbSession.AutoAcceptEdits,
		Archived:        dbSession.Archived,
	}

	if dbSession.CompletedAt != nil {
		info.EndTime = dbSession.CompletedAt
	}

	// Populate Result field if we have result data
	if dbSession.ResultContent != "" || dbSession.NumTurns != nil || dbSession.CostUSD != nil || dbSession.DurationMS != nil {
		result := &claudecode.Result{
			Type:      "result",
			Subtype:   "session_completed",
			Result:    dbSession.ResultContent,
			SessionID: dbSession.ClaudeSessionID, // Use Claude session ID for consistency
		}

		if dbSession.CostUSD != nil {
			result.CostUSD = *dbSession.CostUSD
		}
		if dbSession.NumTurns != nil {
			result.NumTurns = *dbSession.NumTurns
		}
		if dbSession.DurationMS != nil {
			result.DurationMS = *dbSession.DurationMS
		}
		if dbSession.ErrorMessage != "" {
			result.Error = dbSession.ErrorMessage
			result.IsError = true
		}

		info.Result = result
	}

	return info, nil
}

// ListSessions returns all sessions from the database
func (m *Manager) ListSessions() []Info {
	ctx := context.Background()
	dbSessions, err := m.store.ListSessions(ctx)
	if err != nil {
		slog.Error("failed to list sessions from database", "error", err)
		return []Info{}
	}

	// Convert database sessions to Info
	infos := make([]Info, 0, len(dbSessions))
	for _, dbSession := range dbSessions {
		info := Info{
			ID:                                  dbSession.ID,
			RunID:                               dbSession.RunID,
			ClaudeSessionID:                     dbSession.ClaudeSessionID,
			ParentSessionID:                     dbSession.ParentSessionID,
			Status:                              Status(dbSession.Status),
			StartTime:                           dbSession.CreatedAt,
			LastActivityAt:                      dbSession.LastActivityAt,
			Error:                               dbSession.ErrorMessage,
			Query:                               dbSession.Query,
			Summary:                             dbSession.Summary,
			Title:                               dbSession.Title,
			Model:                               dbSession.Model,
			WorkingDir:                          dbSession.WorkingDir,
			AutoAcceptEdits:                     dbSession.AutoAcceptEdits,
			Archived:                            dbSession.Archived,
			DangerouslySkipPermissions:          dbSession.DangerouslySkipPermissions,
			DangerouslySkipPermissionsExpiresAt: dbSession.DangerouslySkipPermissionsExpiresAt,
		}

		// Set end time if completed
		// TODO: Make these two fields match (JsonRPC name and sqlite storage name)
		if dbSession.CompletedAt != nil {
			info.EndTime = dbSession.CompletedAt
		}

		// Populate Result field if we have result data
		if dbSession.ResultContent != "" || dbSession.NumTurns != nil || dbSession.CostUSD != nil || dbSession.DurationMS != nil {
			result := &claudecode.Result{
				Type:      "result",
				Subtype:   "session_completed",
				Result:    dbSession.ResultContent,
				SessionID: dbSession.ClaudeSessionID, // Use Claude session ID for consistency
			}

			if dbSession.CostUSD != nil {
				result.CostUSD = *dbSession.CostUSD
			}
			if dbSession.NumTurns != nil {
				result.NumTurns = *dbSession.NumTurns
			}
			if dbSession.DurationMS != nil {
				result.DurationMS = *dbSession.DurationMS
			}
			if dbSession.ErrorMessage != "" {
				result.Error = dbSession.ErrorMessage
				result.IsError = true
			}

			info.Result = result
		}

		infos = append(infos, info)
	}

	return infos
}

// updateSessionActivity updates the last_activity_at timestamp for a session
func (m *Manager) updateSessionActivity(ctx context.Context, sessionID string) {
	now := time.Now()
	if err := m.store.UpdateSession(ctx, sessionID, store.SessionUpdate{
		LastActivityAt: &now,
	}); err != nil {
		slog.Warn("failed to update session activity timestamp",
			"session_id", sessionID,
			"error", err)
	}
}

// processStreamEvent processes a streaming event and stores it in the database
func (m *Manager) processStreamEvent(ctx context.Context, sessionID string, claudeSessionID string, event claudecode.StreamEvent) error {
	// Skip events without claude session ID
	if claudeSessionID == "" {
		return nil
	}

	switch event.Type {
	case "system":
		// System events (session created, tools available, etc)
		switch event.Subtype {
		case "session_created":
			// Store system event
			convEvent := &store.ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeSystem,
				Role:            "system",
				Content:         fmt.Sprintf("Session created with ID: %s", event.SessionID),
			}
			if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
				return err
			}

			// Publish conversation updated event
			if m.eventBus != nil {
				m.eventBus.Publish(bus.Event{
					Type: bus.EventConversationUpdated,
					Data: map[string]interface{}{
						"session_id":        sessionID,
						"claude_session_id": claudeSessionID,
						"event_type":        "system",
						"subtype":           event.Subtype,
						"content":           fmt.Sprintf("Session created with ID: %s", event.SessionID),
						"content_type":      "system",
					},
				})
			}
		case "init":
			// Check if we need to populate the model
			session, err := m.store.GetSession(ctx, sessionID)
			if err != nil {
				slog.Error("failed to get session for model update", "error", err)
				return nil // Non-fatal, continue processing
			}

			// Only update if model is empty and init event has a model
			if session != nil && session.Model == "" && event.Model != "" {
				// Extract simple model name from API format (case-insensitive)
				var modelName string
				lowerModel := strings.ToLower(event.Model)
				if strings.Contains(lowerModel, "opus") {
					modelName = "opus"
				} else if strings.Contains(lowerModel, "sonnet") {
					modelName = "sonnet"
				}

				// Update session with detected model
				if modelName != "" {
					update := store.SessionUpdate{
						Model: &modelName,
					}
					if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
						slog.Error("failed to update session model from init event",
							"session_id", sessionID,
							"model", modelName,
							"error", err)
					} else {
						slog.Info("populated session model from init event",
							"session_id", sessionID,
							"model", modelName,
							"original", event.Model)
					}
				} else {
					// Log when we detect a model but don't recognize the format
					slog.Debug("unrecognized model format in init event",
						"session_id", sessionID,
						"model", event.Model)
				}
			}
			// Don't store init event in conversation history - we only extract the model
		}
		// Other system events can be added as needed

	case "assistant", "user":
		// Messages contain the actual content
		if event.Message != nil {
			// Process each content block
			for _, content := range event.Message.Content {
				switch content.Type {
				case "text":
					// Text message
					convEvent := &store.ConversationEvent{
						SessionID:       sessionID,
						ClaudeSessionID: claudeSessionID,
						EventType:       store.EventTypeMessage,
						Role:            event.Message.Role,
						Content:         content.Text,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Update session activity timestamp for text messages
					m.updateSessionActivity(ctx, sessionID)

					// Publish conversation updated event
					if m.eventBus != nil {
						m.eventBus.Publish(bus.Event{
							Type: bus.EventConversationUpdated,
							Data: map[string]interface{}{
								"session_id":        sessionID,
								"claude_session_id": claudeSessionID,
								"event_type":        "message",
								"role":              event.Message.Role,
								"content":           content.Text,
								"content_type":      "text",
							},
						})
					}

				case "tool_use":
					// Tool call
					inputJSON, err := json.Marshal(content.Input)
					if err != nil {
						return fmt.Errorf("failed to marshal tool input: %w", err)
					}

					convEvent := &store.ConversationEvent{
						SessionID:       sessionID,
						ClaudeSessionID: claudeSessionID,
						EventType:       store.EventTypeToolCall,
						ToolID:          content.ID,
						ToolName:        content.Name,
						ToolInputJSON:   string(inputJSON),
						ParentToolUseID: event.ParentToolUseID, // Capture from event level
						// We don't know yet if this needs approval - that comes from HumanLayer API
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Update session activity timestamp for tool calls
					m.updateSessionActivity(ctx, sessionID)

					// Publish conversation updated event
					if m.eventBus != nil {
						// Parse tool input for event data
						var toolInput map[string]interface{}
						if err := json.Unmarshal([]byte(string(inputJSON)), &toolInput); err != nil {
							toolInput = nil // Don't include invalid JSON
						}

						m.eventBus.Publish(bus.Event{
							Type: bus.EventConversationUpdated,
							Data: map[string]interface{}{
								"session_id":         sessionID,
								"claude_session_id":  claudeSessionID,
								"event_type":         "tool_call",
								"tool_id":            content.ID,
								"tool_name":          content.Name,
								"tool_input":         toolInput,
								"parent_tool_use_id": event.ParentToolUseID,
								"content_type":       "tool_use",
							},
						})
					}

				case "tool_result":
					// Tool result (in user message)
					convEvent := &store.ConversationEvent{
						SessionID:         sessionID,
						ClaudeSessionID:   claudeSessionID,
						EventType:         store.EventTypeToolResult,
						Role:              "user",
						ToolResultForID:   content.ToolUseID,
						ToolResultContent: content.Content.Value,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Asynchronously capture file snapshot for Read tool results
					if toolCall, err := m.store.GetToolCallByID(ctx, content.ToolUseID); err == nil && toolCall != nil && toolCall.ToolName == "Read" {
						go m.captureFileSnapshot(ctx, sessionID, content.ToolUseID, toolCall.ToolInputJSON, content.Content.Value)
					}

					// Update session activity timestamp for tool results
					m.updateSessionActivity(ctx, sessionID)

					// Publish conversation updated event
					if m.eventBus != nil {
						m.eventBus.Publish(bus.Event{
							Type: bus.EventConversationUpdated,
							Data: map[string]interface{}{
								"session_id":          sessionID,
								"claude_session_id":   claudeSessionID,
								"event_type":          "tool_result",
								"tool_result_for_id":  content.ToolUseID,
								"tool_result_content": content.Content.Value,
								"content_type":        "tool_result",
							},
						})
					}

					// Mark the corresponding tool call as completed
					if err := m.store.MarkToolCallCompleted(ctx, content.ToolUseID, sessionID); err != nil {
						slog.Error("failed to mark tool call as completed",
							"tool_id", content.ToolUseID,
							"session_id", sessionID,
							"error", err)
						// Continue anyway - this is not fatal
					}

				case "thinking":
					// Thinking message
					convEvent := &store.ConversationEvent{
						SessionID:       sessionID,
						ClaudeSessionID: claudeSessionID,
						EventType:       store.EventTypeThinking,
						Role:            event.Message.Role,
						Content:         content.Thinking,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Update session activity timestamp for thinking messages
					m.updateSessionActivity(ctx, sessionID)

					// Publish conversation updated event
					if m.eventBus != nil {
						m.eventBus.Publish(bus.Event{
							Type: bus.EventConversationUpdated,
							Data: map[string]interface{}{
								"session_id":        sessionID,
								"claude_session_id": claudeSessionID,
								"event_type":        "thinking",
								"role":              event.Message.Role,
								"content":           content.Thinking,
								"content_type":      "thinking",
							},
						})
					}
				}
			}
		}

	case "result":
		// Session completion
		status := store.SessionStatusCompleted
		if event.IsError {
			status = store.SessionStatusFailed
		}

		now := time.Now()
		update := store.SessionUpdate{
			Status:         &status,
			CompletedAt:    &now,
			LastActivityAt: &now,
			CostUSD:        &event.CostUSD,
			DurationMS:     &event.DurationMS,
		}
		if event.Error != "" {
			update.ErrorMessage = &event.Error
		}

		return m.store.UpdateSession(ctx, sessionID, update)
	}

	return nil
}

// captureFileSnapshot captures full file content for Read tool results
func (m *Manager) captureFileSnapshot(ctx context.Context, sessionID, toolID, toolInputJSON, toolResultContent string) {
	// Parse tool input to get file path
	var input map[string]interface{}
	if err := json.Unmarshal([]byte(toolInputJSON), &input); err != nil {
		slog.Error("failed to parse Read tool input", "error", err)
		return
	}

	filePath, ok := input["file_path"].(string)
	if !ok {
		slog.Error("Read tool input missing file_path")
		return
	}

	// Read tool returns plain text with line numbers, not JSON
	// Check if this is a partial read by looking for limit/offset in input
	_, hasLimit := input["limit"]
	_, hasOffset := input["offset"]
	isPartialRead := hasLimit || hasOffset

	var content string

	// If it's a full read (no limit/offset), we can use the tool result content directly
	if !isPartialRead {
		// Parse the line-numbered format from Read tool
		content = parseReadToolContent(toolResultContent)
		slog.Debug("using full content from Read tool result", "path", filePath)
	} else {
		// Partial read - need to read full file from filesystem
		// Get session to access working directory
		session, err := m.store.GetSession(ctx, sessionID)
		if err != nil {
			slog.Error("failed to get session for snapshot", "error", err)
			return
		}

		// Construct full path for reading
		var fullPath string
		if filepath.IsAbs(filePath) {
			// Path is already absolute
			fullPath = filePath
		} else {
			// Path is relative, join with working directory
			fullPath = filepath.Join(session.WorkingDir, filePath)

			// Verify the constructed path exists
			if _, err := os.Stat(fullPath); err != nil {
				slog.Error("constructed file path does not exist",
					"working_dir", session.WorkingDir,
					"file_path", filePath,
					"full_path", fullPath,
					"error", err)
				return
			}
		}

		// Read file with size limit (10MB)
		const maxFileSize = 10 * 1024 * 1024
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			slog.Error("failed to stat file for snapshot", "path", fullPath, "error", err)
			return
		}

		if fileInfo.Size() > maxFileSize {
			slog.Warn("file too large for snapshot, using partial content", "path", fullPath, "size", fileInfo.Size())
			// Store partial content from tool result as fallback
			content = parseReadToolContent(toolResultContent)
		} else {
			fileBytes, err := os.ReadFile(fullPath)
			if err != nil {
				slog.Error("failed to read file for snapshot", "path", fullPath, "error", err)
				return
			}
			content = string(fileBytes)
			slog.Debug("read full file content from filesystem", "path", fullPath)
		}
	}

	// Store snapshot with relative path from tool call
	snapshot := &store.FileSnapshot{
		ToolID:    toolID,
		SessionID: sessionID,
		FilePath:  filePath, // Store exactly as provided in tool call
		Content:   content,
	}

	if err := m.store.CreateFileSnapshot(ctx, snapshot); err != nil {
		slog.Error("failed to store file snapshot", "error", err)
	}
}

// parseReadToolContent extracts content from Read tool's line-numbered format
func parseReadToolContent(toolResult string) string {
	lines := strings.Split(toolResult, "\n")
	var contentLines []string

	for _, line := range lines {
		// Find the arrow separator "→"
		if idx := strings.Index(line, "→"); idx > 0 {
			// Extract content after the arrow (UTF-8 aware)
			contentLines = append(contentLines, line[idx+len("→"):])
		}
	}

	return strings.Join(contentLines, "\n")
}

// ContinueSession resumes an existing completed session with a new query and optional config overrides
func (m *Manager) ContinueSession(ctx context.Context, req ContinueSessionConfig) (*Session, error) {
	// Get parent session from database
	parentSession, err := m.store.GetSession(ctx, req.ParentSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get parent session: %w", err)
	}

	// Validate parent session status - allow completed, interrupted, or running sessions
	if parentSession.Status != store.SessionStatusCompleted &&
		parentSession.Status != store.SessionStatusInterrupted &&
		parentSession.Status != store.SessionStatusRunning {
		return nil, fmt.Errorf("cannot continue session with status %s (must be completed, interrupted, or running)", parentSession.Status)
	}

	// Validate parent session has claude_session_id (needed for resume)
	if parentSession.ClaudeSessionID == "" {
		return nil, fmt.Errorf("parent session missing claude_session_id (cannot resume)")
	}

	// Validate parent session has working directory (needed for resume)
	if parentSession.WorkingDir == "" {
		return nil, fmt.Errorf("parent session missing working_dir (cannot resume session without working directory)")
	}

	// If session is running, interrupt it and wait for completion
	if parentSession.Status == store.SessionStatusRunning {
		slog.Info("interrupting running session before resume",
			"parent_session_id", req.ParentSessionID)

		if err := m.InterruptSession(ctx, req.ParentSessionID); err != nil {
			return nil, fmt.Errorf("failed to interrupt running session: %w", err)
		}

		// Wait for the interrupted session to complete gracefully
		m.mu.RLock()
		claudeSession, exists := m.activeProcesses[req.ParentSessionID]
		m.mu.RUnlock()

		if exists {
			_, err := claudeSession.Wait()
			if err != nil {
				slog.Debug("interrupted session exited",
					"parent_session_id", req.ParentSessionID,
					"error", err)
			}
		}

		// Re-fetch parent session to get updated completed status
		parentSession, err = m.store.GetSession(ctx, req.ParentSessionID)
		if err != nil {
			return nil, fmt.Errorf("failed to re-fetch parent session after interrupt: %w", err)
		}

		slog.Info("session interrupted and completed, proceeding with resume",
			"parent_session_id", req.ParentSessionID,
			"final_status", parentSession.Status)
	}

	// Build config for resumed session
	// Start by inheriting ALL configuration from parent session
	config := claudecode.SessionConfig{
		Query:                req.Query,
		SessionID:            parentSession.ClaudeSessionID, // This triggers --resume flag
		OutputFormat:         claudecode.OutputStreamJSON,   // Always use streaming JSON
		Model:                claudecode.Model(parentSession.Model),
		WorkingDir:           parentSession.WorkingDir,
		SystemPrompt:         parentSession.SystemPrompt,
		AppendSystemPrompt:   parentSession.AppendSystemPrompt,
		CustomInstructions:   parentSession.CustomInstructions,
		PermissionPromptTool: parentSession.PermissionPromptTool,
		// MaxTurns intentionally NOT inherited - let it default or be specified
	}

	// Deserialize JSON arrays for tools
	if parentSession.AllowedTools != "" {
		var allowedTools []string
		if err := json.Unmarshal([]byte(parentSession.AllowedTools), &allowedTools); err == nil {
			config.AllowedTools = allowedTools
		}
	}
	if parentSession.DisallowedTools != "" {
		var disallowedTools []string
		if err := json.Unmarshal([]byte(parentSession.DisallowedTools), &disallowedTools); err == nil {
			config.DisallowedTools = disallowedTools
		}
	}

	// Retrieve and inherit MCP configuration from parent session
	mcpServers, err := m.store.GetMCPServers(ctx, req.ParentSessionID)
	if err == nil && len(mcpServers) > 0 {
		config.MCPConfig = &claudecode.MCPConfig{
			MCPServers: make(map[string]claudecode.MCPServer),
		}
		for _, server := range mcpServers {
			var args []string
			var env map[string]string
			if err := json.Unmarshal([]byte(server.ArgsJSON), &args); err != nil {
				slog.Warn("failed to unmarshal MCP server args", "error", err, "server", server.Name)
				args = []string{}
			}
			if err := json.Unmarshal([]byte(server.EnvJSON), &env); err != nil {
				slog.Warn("failed to unmarshal MCP server env", "error", err, "server", server.Name)
				env = map[string]string{}
			}

			config.MCPConfig.MCPServers[server.Name] = claudecode.MCPServer{
				Command: server.Command,
				Args:    args,
				Env:     env,
			}
		}
		slog.Debug("inherited MCP servers from parent session",
			"parent_session_id", req.ParentSessionID,
			"mcp_server_count", len(mcpServers))
	}

	// Apply optional overrides (only if explicitly provided)
	if req.SystemPrompt != "" {
		config.SystemPrompt = req.SystemPrompt
	}
	if req.AppendSystemPrompt != "" {
		config.AppendSystemPrompt = req.AppendSystemPrompt
	}
	if req.MCPConfig != nil {
		config.MCPConfig = req.MCPConfig
	}
	if req.PermissionPromptTool != "" {
		config.PermissionPromptTool = req.PermissionPromptTool
	}
	if len(req.AllowedTools) > 0 {
		config.AllowedTools = req.AllowedTools
	}
	if len(req.DisallowedTools) > 0 {
		config.DisallowedTools = req.DisallowedTools
	}
	if req.CustomInstructions != "" {
		config.CustomInstructions = req.CustomInstructions
	}
	if req.MaxTurns > 0 {
		config.MaxTurns = req.MaxTurns
	}

	// Create new session with parent reference
	sessionID := uuid.New().String()
	runID := uuid.New().String()

	// Store session in database with parent reference
	dbSession := store.NewSessionFromConfig(sessionID, runID, config)
	dbSession.ParentSessionID = req.ParentSessionID
	dbSession.Summary = CalculateSummary(req.Query)
	// Inherit auto-accept setting from parent
	dbSession.AutoAcceptEdits = parentSession.AutoAcceptEdits
	// Inherit dangerously skip permissions from parent
	dbSession.DangerouslySkipPermissions = parentSession.DangerouslySkipPermissions
	dbSession.DangerouslySkipPermissionsExpiresAt = parentSession.DangerouslySkipPermissionsExpiresAt

	// Check if dangerously skip permissions has expired on the parent
	if dbSession.DangerouslySkipPermissions && dbSession.DangerouslySkipPermissionsExpiresAt != nil && time.Now().After(*dbSession.DangerouslySkipPermissionsExpiresAt) {
		dbSession.DangerouslySkipPermissions = false
		dbSession.DangerouslySkipPermissionsExpiresAt = nil
	}

	// Inherit title from parent session
	dbSession.Title = parentSession.Title
	// Explicitly ensure inherited values are stored (in case NewSessionFromConfig didn't capture them)
	if dbSession.Model == "" && parentSession.Model != "" {
		dbSession.Model = parentSession.Model
	}
	if dbSession.WorkingDir == "" && parentSession.WorkingDir != "" {
		dbSession.WorkingDir = parentSession.WorkingDir
	}
	// Note: ClaudeSessionID will be captured from streaming events (will be different from parent)
	if err := m.store.CreateSession(ctx, dbSession); err != nil {
		return nil, fmt.Errorf("failed to store session in database: %w", err)
	}

	// Add run_id and daemon socket to MCP server environments
	if config.MCPConfig != nil {
		for name, server := range config.MCPConfig.MCPServers {
			if server.Env == nil {
				server.Env = make(map[string]string)
			}
			server.Env["HUMANLAYER_RUN_ID"] = runID
			// Add daemon socket path so MCP servers connect to the correct daemon
			if m.socketPath != "" {
				server.Env["HUMANLAYER_DAEMON_SOCKET"] = m.socketPath
			}
			config.MCPConfig.MCPServers[name] = server
		}

		// Store MCP servers configuration
		servers, err := store.MCPServersFromConfig(sessionID, config.MCPConfig.MCPServers)
		if err != nil {
			slog.Error("failed to convert MCP servers", "error", err)
		} else if err := m.store.StoreMCPServers(ctx, sessionID, servers); err != nil {
			slog.Error("failed to store MCP servers", "error", err)
		}
	}

	// Launch resumed Claude session
	claudeSession, err := m.client.Launch(config)
	if err != nil {
		m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
		return nil, fmt.Errorf("failed to launch resumed Claude session: %w", err)
	}

	// Wrap the session for storage
	wrappedSession := NewClaudeSessionWrapper(claudeSession)

	// Store active Claude process
	m.mu.Lock()
	m.activeProcesses[sessionID] = wrappedSession
	m.mu.Unlock()

	// Update database with running status
	statusRunning := string(StatusRunning)
	now := time.Now()
	update := store.SessionUpdate{
		Status:         &statusRunning,
		LastActivityAt: &now,
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		slog.Error("failed to update session status to running", "error", err)
	}

	// Publish status change event
	if m.eventBus != nil {
		m.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id":        sessionID,
				"run_id":            runID,
				"parent_session_id": req.ParentSessionID,
				"old_status":        string(StatusStarting),
				"new_status":        string(StatusRunning),
			},
		})
	}

	// Store query for injection after Claude session ID is captured
	m.pendingQueries.Store(sessionID, req.Query)

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, wrappedSession, time.Now(), config)

	// Reconcile any existing approvals for this run_id (same run_id is reused for continuations)
	if m.approvalReconciler != nil {
		go func() {
			// Give the session a moment to start
			time.Sleep(2 * time.Second)
			if err := m.approvalReconciler.ReconcileApprovalsForSession(ctx, runID); err != nil {
				slog.Error("failed to reconcile approvals for continued session",
					"session_id", sessionID,
					"parent_session_id", req.ParentSessionID,
					"run_id", runID,
					"error", err)
			}
		}()
	}

	slog.Info("continued Claude session",
		"session_id", sessionID,
		"parent_session_id", req.ParentSessionID,
		"run_id", runID,
		"query", req.Query)

	// Return minimal session info
	return &Session{
		ID:        sessionID,
		RunID:     runID,
		Status:    StatusRunning,
		StartTime: time.Now(),
		Config:    config,
	}, nil
}

// InterruptSession interrupts a running session
func (m *Manager) InterruptSession(ctx context.Context, sessionID string) error {
	// Hold lock to ensure session reference remains valid during interrupt
	m.mu.Lock()
	claudeSession, exists := m.activeProcesses[sessionID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("session not found or not active")
	}

	// Keep the session in activeProcesses during interrupt to prevent race conditions
	// It will be cleaned up in the monitorSession goroutine after interrupt completes
	m.mu.Unlock()

	// Interrupt the Claude session
	if err := claudeSession.Interrupt(); err != nil {
		return fmt.Errorf("failed to interrupt Claude session: %w", err)
	}

	// Update database to show session is interrupting after interrupt
	status := string(StatusInterrupting)
	now := time.Now()
	update := store.SessionUpdate{
		Status:         &status,
		LastActivityAt: &now,
		// Don't set CompletedAt or ErrorMessage - session is still shutting down
	}
	if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
		slog.Error("failed to update session status after interrupt",
			"session_id", sessionID,
			"error", err)
		// Continue anyway since the session was interrupted
	}

	// Publish status change event
	if m.eventBus != nil {
		m.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"old_status": string(StatusRunning),
				"new_status": string(StatusInterrupting),
			},
		})
	}

	return nil
}

// injectQueryAsFirstEvent adds the user's query as the first conversation event
func (m *Manager) injectQueryAsFirstEvent(ctx context.Context, sessionID, claudeSessionID, query string) error {
	// Check if we already have a user message as the first event (deduplication)
	events, err := m.store.GetConversation(ctx, claudeSessionID)
	if err == nil && len(events) > 0 && events[0].Role == "user" {
		return nil // Query already injected
	}

	event := &store.ConversationEvent{
		SessionID:       sessionID,
		ClaudeSessionID: claudeSessionID,
		Sequence:        1, // Start at 1, not 0 (matches existing pattern)
		EventType:       store.EventTypeMessage,
		CreatedAt:       time.Now(),
		Role:            "user",
		Content:         query,
	}
	return m.store.AddConversationEvent(ctx, event)
}

// StopAllSessions gracefully stops all active sessions with a timeout
func (m *Manager) StopAllSessions(timeout time.Duration) error {
	m.mu.RLock()
	// Get snapshot of active sessions and their current status
	activeSessionsToStop := make(map[string]ClaudeSession)
	for id, session := range m.activeProcesses {
		// Get session info to check status
		info, err := m.GetSessionInfo(id)
		if err != nil {
			slog.Warn("failed to get session info during shutdown", "session_id", id, "error", err)
			// If we can't get info, assume it's active and try to stop it
			activeSessionsToStop[id] = session
			continue
		}

		// Only interrupt sessions that are actually running or waiting for input
		if info.Status == StatusRunning || info.Status == StatusWaitingInput || info.Status == StatusStarting {
			activeSessionsToStop[id] = session
		} else {
			slog.Debug("skipping session with non-running status",
				"session_id", id,
				"status", info.Status)
		}
	}
	m.mu.RUnlock()

	if len(activeSessionsToStop) == 0 {
		slog.Info("no active sessions to stop")
		return nil
	}

	slog.Info("stopping active sessions", "count", len(activeSessionsToStop))

	// Interrupt all sessions
	var wg sync.WaitGroup
	errors := make(chan error, len(activeSessionsToStop))

	for sessionID := range activeSessionsToStop {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			slog.Info("sending interrupt to session",
				"session_id", id)
			if err := m.InterruptSession(context.Background(), id); err != nil {
				errors <- fmt.Errorf("session %s: %w", id, err)
			}
		}(sessionID)
	}

	// Wait for interrupts to be sent
	wg.Wait()
	close(errors)

	// Log any errors from interrupt attempts
	for err := range errors {
		slog.Error("failed to interrupt session", "error", err)
	}

	// Wait for sessions to complete with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	startTime := time.Now()
	for {
		select {
		case <-ctx.Done():
			m.mu.RLock()
			remaining := len(m.activeProcesses)
			m.mu.RUnlock()
			if remaining > 0 {
				slog.Warn("timeout waiting for sessions to stop",
					"remaining", remaining,
					"timeout", timeout,
					"elapsed", time.Since(startTime))
				// Force kill remaining sessions
				m.forceKillRemaining()
			}
			return ctx.Err()
		case <-ticker.C:
			m.mu.RLock()
			remaining := len(m.activeProcesses)
			m.mu.RUnlock()
			if remaining == 0 {
				slog.Info("all sessions stopped successfully",
					"elapsed", time.Since(startTime))
				return nil
			}
		}
	}
}

// forceKillRemaining forcefully terminates any remaining sessions
func (m *Manager) forceKillRemaining() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, session := range m.activeProcesses {
		slog.Warn("force killing session", "session_id", id)
		if err := session.Kill(); err != nil {
			slog.Error("failed to force kill session",
				"session_id", id,
				"error", err)
		}
	}
}

// UpdateSessionSettings updates session settings and publishes appropriate events
func (m *Manager) UpdateSessionSettings(ctx context.Context, sessionID string, updates store.SessionUpdate) error {
	// First update the store
	if err := m.store.UpdateSession(ctx, sessionID, updates); err != nil {
		return err
	}

	// If auto-accept edits was updated, publish the settings changed event
	if updates.AutoAcceptEdits != nil {
		if m.eventBus != nil {
			m.eventBus.Publish(bus.Event{
				Type: bus.EventSessionSettingsChanged,
				Data: map[string]interface{}{
					"session_id":        sessionID,
					"auto_accept_edits": *updates.AutoAcceptEdits,
				},
			})
		}
	}

	return nil
}
