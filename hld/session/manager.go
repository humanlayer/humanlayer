package session

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/google/uuid"
)

// Manager handles the lifecycle of Claude Code sessions
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	client   *claudecode.Client
	eventBus bus.EventBus
}

// Compile-time check that Manager implements SessionManager
var _ SessionManager = (*Manager)(nil)

// NewManager creates a new session manager
func NewManager(eventBus bus.EventBus) (*Manager, error) {
	client, err := claudecode.NewClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create Claude client: %w", err)
	}

	return &Manager{
		sessions: make(map[string]*Session),
		client:   client,
		eventBus: eventBus,
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

	// Store session
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
		if event.SessionID != "" && claudeSessionID == "" {
			claudeSessionID = event.SessionID
			// Update our session with Claude's session ID for resume capability
			m.mu.Lock()
			session.Config.SessionID = claudeSessionID
			m.mu.Unlock()
			slog.Debug("captured Claude session ID",
				"session_id", session.ID,
				"claude_session_id", claudeSessionID)
		}
		// Could store events for later retrieval if needed
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
		m.mu.Unlock()
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
		}
		infos = append(infos, info)
	}

	return infos
}
