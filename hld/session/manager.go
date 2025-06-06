package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/google/uuid"
)

// Manager handles the lifecycle of Claude Code sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	client   *claudecode.Client
	eventBus bus.EventBus
	store    store.ConversationStore
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
		sessions: make(map[string]*Session),
		client:   client,
		eventBus: eventBus,
		store:    store,
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

	// Create session record
	session := &Session{
		ID:        sessionID,
		RunID:     runID,
		Status:    StatusStarting,
		StartTime: time.Now(),
		Config:    config,
	}

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

	// Store session in memory
	m.mu.Lock()
	m.sessions[sessionID] = session
	m.mu.Unlock()

	// Launch Claude session
	claudeSession, err := m.client.Launch(config)
	if err != nil {
		m.updateSessionStatus(sessionID, StatusFailed, err.Error())
		return nil, fmt.Errorf("failed to launch Claude session: %w", err)
	}

	// Update session with Claude reference and status
	m.mu.Lock()
	session.claude = claudeSession
	oldStatus := session.Status
	session.Status = StatusRunning
	m.mu.Unlock()

	// Publish status change event
	if m.eventBus != nil && oldStatus != StatusRunning {
		m.eventBus.Publish(bus.Event{
			Type: bus.EventSessionStatusChanged,
			Data: map[string]interface{}{
				"session_id": sessionID,
				"run_id":     runID,
				"old_status": string(oldStatus),
				"new_status": string(StatusRunning),
			},
		})
	}

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, session)

	slog.Info("launched Claude session",
		"session_id", sessionID,
		"run_id", runID,
		"prompt", config.Prompt,
		"permission_prompt_tool", config.PermissionPromptTool)

	return session, nil
}

// monitorSession tracks the lifecycle of a Claude session
func (m *Manager) monitorSession(ctx context.Context, session *Session) {
	// Get the session ID from the Claude session once available
	var claudeSessionID string
	for event := range session.claude.Events {
		// Store raw event for debugging
		eventJSON, err := json.Marshal(event)
		if err != nil {
			slog.Error("failed to marshal event", "error", err)
		} else {
			if err := m.store.StoreRawEvent(ctx, session.ID, string(eventJSON)); err != nil {
				slog.Debug("failed to store raw event", "error", err)
			}
		}

		// Capture Claude session ID
		if event.SessionID != "" && claudeSessionID == "" {
			claudeSessionID = event.SessionID
			// Update our session with Claude's session ID for resume capability
			m.mu.Lock()
			session.Config.SessionID = claudeSessionID
			m.mu.Unlock()
			slog.Debug("captured Claude session ID",
				"session_id", session.ID,
				"claude_session_id", claudeSessionID)

			// Update database
			update := store.SessionUpdate{
				ClaudeSessionID: &claudeSessionID,
			}
			if err := m.store.UpdateSession(ctx, session.ID, update); err != nil {
				slog.Error("failed to update session in database", "error", err)
			}
		}

		// Process and store event
		if err := m.processStreamEvent(ctx, session, claudeSessionID, event); err != nil {
			slog.Error("failed to process stream event", "error", err)
		}
	}

	// Wait for session to complete
	result, err := session.claude.Wait()

	endTime := time.Now()
	if err != nil {
		m.updateSessionStatus(session.ID, StatusFailed, err.Error())
	} else if result != nil && result.IsError {
		m.updateSessionStatus(session.ID, StatusFailed, result.Error)
	} else {
		m.mu.Lock()
		session.Status = StatusCompleted
		session.EndTime = &endTime
		session.Result = result
		m.mu.Unlock()

		// Publish status change event
		if m.eventBus != nil {
			m.eventBus.Publish(bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": session.ID,
					"run_id":     session.RunID,
					"old_status": string(StatusRunning),
					"new_status": string(StatusCompleted),
				},
			})
		}
	}

	slog.Info("session completed",
		"session_id", session.ID,
		"status", session.Status,
		"duration", endTime.Sub(session.StartTime))
}

// updateSessionStatus updates the status of a session
func (m *Manager) updateSessionStatus(sessionID string, status Status, errorMsg string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if session, ok := m.sessions[sessionID]; ok {
		oldStatus := session.Status
		session.Status = status
		if errorMsg != "" {
			session.Error = errorMsg
		}
		if status == StatusCompleted || status == StatusFailed {
			now := time.Now()
			session.EndTime = &now
		}

		// Update database
		ctx := context.Background()
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
		}
		if err := m.store.UpdateSession(ctx, sessionID, update); err != nil {
			slog.Error("failed to update session status in database", "error", err)
		}

		// Publish event if status changed
		if m.eventBus != nil && oldStatus != status {
			m.eventBus.Publish(bus.Event{
				Type: bus.EventSessionStatusChanged,
				Data: map[string]interface{}{
					"session_id": sessionID,
					"run_id":     session.RunID,
					"old_status": string(oldStatus),
					"new_status": string(status),
					"error":      errorMsg,
				},
			})
		}
	}
}

// GetSession returns a session by ID
func (m *Manager) GetSession(sessionID string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	return session, nil
}

// ListSessions returns all sessions
func (m *Manager) ListSessions() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessions := make([]*Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}

	return sessions
}

// GetSessionInfo returns a JSON-safe view of a session
func (m *Manager) GetSessionInfo(sessionID string) (*Info, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	// Create a copy while holding the lock
	return &Info{
		ID:        session.ID,
		RunID:     session.RunID,
		Status:    session.Status,
		StartTime: session.StartTime,
		EndTime:   session.EndTime,
		Error:     session.Error,
		Prompt:    session.Config.Prompt,
		Model:     string(session.Config.Model),
		Result:    session.Result,
	}, nil
}

// ListSessionInfo returns JSON-safe views of all sessions
func (m *Manager) ListSessionInfo() []Info {
	m.mu.RLock()
	defer m.mu.RUnlock()

	infos := make([]Info, 0, len(m.sessions))

	for _, session := range m.sessions {
		info := Info{
			ID:        session.ID,
			RunID:     session.RunID,
			Status:    session.Status,
			StartTime: session.StartTime,
			EndTime:   session.EndTime,
			Error:     session.Error,
			Prompt:    session.Config.Prompt,
			Model:     string(session.Config.Model),
			Result:    session.Result,
		}
		infos = append(infos, info)
	}

	return infos
}

// processStreamEvent processes a streaming event and stores it in the database
func (m *Manager) processStreamEvent(ctx context.Context, session *Session, claudeSessionID string, event claudecode.StreamEvent) error {
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
				SessionID:       session.ID,
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
						SessionID:       session.ID,
						ClaudeSessionID: claudeSessionID,
						EventType:       store.EventTypeMessage,
						Role:            event.Message.Role,
						Content:         content.Text,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

				case "tool_use":
					// Tool call
					inputJSON, err := json.Marshal(content.Input)
					if err != nil {
						return fmt.Errorf("failed to marshal tool input: %w", err)
					}

					convEvent := &store.ConversationEvent{
						SessionID:       session.ID,
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

				case "tool_result":
					// Tool result (in user message)
					convEvent := &store.ConversationEvent{
						SessionID:         session.ID,
						ClaudeSessionID:   claudeSessionID,
						EventType:         store.EventTypeToolResult,
						Role:              "user",
						ToolResultForID:   content.ToolUseID,
						ToolResultContent: content.Content,
					}
					if err := m.store.AddConversationEvent(ctx, convEvent); err != nil {
						return err
					}

					// Mark the corresponding tool call as completed
					if err := m.store.MarkToolCallCompleted(ctx, content.ToolUseID, session.ID); err != nil {
						slog.Error("failed to mark tool call as completed",
							"tool_id", content.ToolUseID,
							"session_id", session.ID,
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

		update := store.SessionUpdate{
			Status:      &status,
			CompletedAt: &[]time.Time{time.Now()}[0],
			CostUSD:     &event.CostUSD,
			DurationMS:  &event.DurationMS,
		}
		if event.Error != "" {
			update.ErrorMessage = &event.Error
		}

		return m.store.UpdateSession(ctx, session.ID, update)
	}

	return nil
}
