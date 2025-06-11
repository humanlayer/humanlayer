package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

// Manager handles the lifecycle of Claude Code sessions
type Manager struct {
	activeProcesses map[string]*claudecode.Session // Maps session ID to active Claude process
	mu              sync.RWMutex
	client          *claudecode.Client
	eventBus        bus.EventBus
	store           store.ConversationStore
}

// Compile-time check that Manager implements SessionManager
var _ SessionManager = (*Manager)(nil)

// NewManager creates a new session manager with required store
func NewManager(eventBus bus.EventBus, store store.ConversationStore) (*Manager, error) {
	if store == nil {
		return nil, fmt.Errorf("store is required")
	}

	client, err := claudecode.NewClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create Claude client: %w", err)
	}

	return &Manager{
		activeProcesses: make(map[string]*claudecode.Session),
		client:          client,
		eventBus:        eventBus,
		store:           store,
	}, nil
}

// LaunchSession starts a new Claude Code session
func (m *Manager) LaunchSession(ctx context.Context, config claudecode.SessionConfig) (*Session, error) {
	// Generate unique IDs
	sessionID := uuid.New().String()
	runID := uuid.New().String()

	// Add HUMANLAYER_RUN_ID to MCP server environment
	if config.MCPConfig != nil {
		slog.Debug("configuring MCP servers", "count", len(config.MCPConfig.MCPServers))
		for name, server := range config.MCPConfig.MCPServers {
			if server.Env == nil {
				server.Env = make(map[string]string)
			}
			server.Env["HUMANLAYER_RUN_ID"] = runID
			config.MCPConfig.MCPServers[name] = server
			slog.Debug("configured MCP server",
				"name", name,
				"command", server.Command,
				"args", server.Args,
				"run_id", runID)
		}
	} else {
		slog.Debug("no MCP config provided")
	}

	// Create session record directly in database
	startTime := time.Now()

	// Store session in database
	dbSession := store.NewSessionFromConfig(sessionID, runID, config)
	if err := m.store.CreateSession(ctx, dbSession); err != nil {
		return nil, fmt.Errorf("failed to store session in database: %w", err)
	}

	// Store MCP servers if configured
	if config.MCPConfig != nil && len(config.MCPConfig.MCPServers) > 0 {
		servers, err := store.MCPServersFromConfig(sessionID, config.MCPConfig.MCPServers)
		if err != nil {
			slog.Error("failed to convert MCP servers", "error", err)
		} else if err := m.store.StoreMCPServers(ctx, sessionID, servers); err != nil {
			slog.Error("failed to store MCP servers", "error", err)
		}
	}

	// No longer storing full session in memory

	// Launch Claude session
	claudeSession, err := m.client.Launch(config)
	if err != nil {
		m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
		return nil, fmt.Errorf("failed to launch Claude session: %w", err)
	}

	// Store active Claude process
	m.mu.Lock()
	m.activeProcesses[sessionID] = claudeSession
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
		m.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"run_id":     runID,
				"old_status": string(StatusStarting),
				"new_status": string(StatusRunning),
			},
		})
	}

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, claudeSession, startTime, config)

	slog.Info("launched Claude session",
		"session_id", sessionID,
		"run_id", runID,
		"query", config.Query,
		"permission_prompt_tool", config.PermissionPromptTool)

	// Return minimal session info for launch response
	return &Session{
		ID:        sessionID,
		RunID:     runID,
		Status:    StatusRunning,
		StartTime: startTime,
		Config:    config,
	}, nil
}

// monitorSession tracks the lifecycle of a Claude session
func (m *Manager) monitorSession(ctx context.Context, sessionID, runID string, claudeSession *claudecode.Session, startTime time.Time, config claudecode.SessionConfig) {
	// Get the session ID from the Claude session once available
	var claudeSessionID string
	for event := range claudeSession.Events {
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
		}

		// Process and store event
		if err := m.processStreamEvent(ctx, sessionID, claudeSessionID, event); err != nil {
			slog.Error("failed to process stream event", "error", err)
		}
	}

	// Wait for session to complete
	result, err := claudeSession.Wait()

	endTime := time.Now()
	if err != nil {
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
			m.eventBus.Publish(bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": sessionID,
					"run_id":     runID,
					"old_status": string(StatusRunning),
					"new_status": string(StatusCompleted),
				},
			})
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
		Status:          Status(dbSession.Status),
		StartTime:       dbSession.CreatedAt,
		LastActivityAt:  dbSession.LastActivityAt,
		Error:           dbSession.ErrorMessage,
		Query:           dbSession.Query,
		Model:           dbSession.Model,
		WorkingDir:      dbSession.WorkingDir,
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
			result.TotalCost = *dbSession.CostUSD // Both fields should have same value
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
			ID:              dbSession.ID,
			RunID:           dbSession.RunID,
			ClaudeSessionID: dbSession.ClaudeSessionID,
			ParentSessionID: dbSession.ParentSessionID,
			Status:          Status(dbSession.Status),
			StartTime:       dbSession.CreatedAt,
			LastActivityAt:  dbSession.LastActivityAt,
			Error:           dbSession.ErrorMessage,
			Query:           dbSession.Query,
			Model:           dbSession.Model,
			WorkingDir:      dbSession.WorkingDir,
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
				result.TotalCost = *dbSession.CostUSD // Both fields should have same value
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
		if event.Subtype == "session_created" {
			// Store system event
			convEvent := &store.ConversationEvent{
				SessionID:       sessionID,
				ClaudeSessionID: claudeSessionID,
				EventType:       store.EventTypeSystem,
				Role:            "system",
				Content:         fmt.Sprintf("Session created with ID: %s", event.SessionID),
			}
			return m.store.AddConversationEvent(ctx, convEvent)
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
						// We don't know yet if this needs approval - that comes from HumanLayer API
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Update session activity timestamp for tool calls
					m.updateSessionActivity(ctx, sessionID)

				case "tool_result":
					// Tool result (in user message)
					convEvent := &store.ConversationEvent{
						SessionID:         sessionID,
						ClaudeSessionID:   claudeSessionID,
						EventType:         store.EventTypeToolResult,
						Role:              "user",
						ToolResultForID:   content.ToolUseID,
						ToolResultContent: content.Content,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Update session activity timestamp for tool results
					m.updateSessionActivity(ctx, sessionID)

					// Mark the corresponding tool call as completed
					if err := m.store.MarkToolCallCompleted(ctx, content.ToolUseID, sessionID); err != nil {
						slog.Error("failed to mark tool call as completed",
							"tool_id", content.ToolUseID,
							"session_id", sessionID,
							"error", err)
						// Continue anyway - this is not fatal
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

// ContinueSession resumes an existing completed session with a new query and optional config overrides
func (m *Manager) ContinueSession(ctx context.Context, req ContinueSessionConfig) (*Session, error) {
	// Get parent session from database
	parentSession, err := m.store.GetSession(ctx, req.ParentSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get parent session: %w", err)
	}

	// Validate parent session status
	if parentSession.Status != store.SessionStatusCompleted {
		return nil, fmt.Errorf("cannot continue session with status %s (must be completed)", parentSession.Status)
	}

	// Validate parent session has claude_session_id
	if parentSession.ClaudeSessionID == "" {
		return nil, fmt.Errorf("parent session missing claude_session_id (cannot resume)")
	}

	// Build config for resumed session
	// Start with minimal required fields
	config := claudecode.SessionConfig{
		Query:        req.Query,
		SessionID:    parentSession.ClaudeSessionID, // This triggers --resume flag
		OutputFormat: claudecode.OutputStreamJSON,   // Always use streaming JSON
		// Inherit Model and WorkingDir from parent session for database storage
		Model:      claudecode.Model(parentSession.Model),
		WorkingDir: parentSession.WorkingDir,
	}

	// Apply optional overrides
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

	// Add run_id to MCP server environments
	if config.MCPConfig != nil {
		for name, server := range config.MCPConfig.MCPServers {
			if server.Env == nil {
				server.Env = make(map[string]string)
			}
			server.Env["HUMANLAYER_RUN_ID"] = runID
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

	// Store active Claude process
	m.mu.Lock()
	m.activeProcesses[sessionID] = claudeSession
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

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, claudeSession, time.Now(), config)

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
