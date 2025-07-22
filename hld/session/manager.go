package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	"github.com/humanlayer/humanlayer/hld/bus"
	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
	"github.com/humanlayer/humanlayer/hld/store"
)

// Manager handles the lifecycle of Claude Code sessions
type Manager struct {
	activeProcesses    map[string]*claudecode.Session // Maps session ID to active Claude process
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
		return nil, hlderrors.NewValidationError("store", "store is required")
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
func (m *Manager) LaunchSession(ctx context.Context, config claudecode.SessionConfig) (*Session, error) {
	// Generate unique IDs
	sessionID := uuid.New().String()
	runID := uuid.New().String()

	// Add HUMANLAYER_RUN_ID and HUMANLAYER_DAEMON_SOCKET to MCP server environment
	if config.MCPConfig != nil {
		slog.Debug("configuring MCP servers", "count", len(config.MCPConfig.MCPServers))
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
	if config.WorkingDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			slog.Warn("failed to get current working directory", "error", err)
		} else {
			config.WorkingDir = cwd
			slog.Debug("No working directory provided, falling back to cwd of daemon", "working_dir", cwd)
		}
	}

	// Create session record directly in database
	startTime := time.Now()

	// Store session in database
	dbSession := store.NewSessionFromConfig(sessionID, runID, config)
	dbSession.Summary = CalculateSummary(config.Query)
	if err := m.store.CreateSession(ctx, dbSession); err != nil {
		return nil, hlderrors.NewSessionError("create_session", sessionID, err)
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

	// Log final configuration before launching
	var mcpServersDetail string
	var mcpServersCount int
	if config.MCPConfig != nil {
		mcpServersCount = len(config.MCPConfig.MCPServers)
		for name, server := range config.MCPConfig.MCPServers {
			mcpServersDetail += fmt.Sprintf("[%s: cmd=%s args=%v env=%v] ", name, server.Command, server.Args, server.Env)
		}
	}
	slog.Info("launching Claude session with configuration",
		"session_id", sessionID,
		"run_id", runID,
		"query", config.Query,
		"working_dir", config.WorkingDir,
		"permission_prompt_tool", config.PermissionPromptTool,
		"mcp_servers", mcpServersCount,
		"mcp_servers_detail", mcpServersDetail)

	// Launch Claude session
	claudeSession, err := m.client.Launch(config)
	if err != nil {
		slog.Error("failed to launch Claude session",
			"session_id", sessionID,
			"error", err,
			"config", fmt.Sprintf("%+v", config))
		m.updateSessionStatus(ctx, sessionID, StatusFailed, err.Error())
		return nil, hlderrors.NewSessionError("launch_session", sessionID, err)
	}

	// Store active Claude process
	m.mu.Lock()
	m.activeProcesses[sessionID] = claudeSession
	m.mu.Unlock()

	// Transition to running status
	lifecycleManager := NewLifecycleManager(m.store, m.eventBus, m.activeProcesses, &m.mu, &m.pendingQueries)
	if err := lifecycleManager.TransitionToRunning(ctx, sessionID, runID); err != nil {
		slog.Error("failed to transition to running status", "error", err)
		// Continue anyway
	}

	// Store query for injection after Claude session ID is captured
	queryInjector := NewQueryInjector(m.store, &m.pendingQueries)
	queryInjector.StorePendingQuery(sessionID, config.Query)

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, claudeSession, startTime, config)

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
	// Create component instances
	eventProcessor := NewEventProcessor(m.store, m.eventBus)
	lifecycleManager := NewLifecycleManager(m.store, m.eventBus, m.activeProcesses, &m.mu, &m.pendingQueries)
	queryInjector := NewQueryInjector(m.store, &m.pendingQueries)

	// Get the session ID from the Claude session once available
	var claudeSessionID string

	// Process events from Claude session
eventLoop:
	for {
		select {
		case <-ctx.Done():
			// Context cancelled, stop processing
			slog.Debug("monitorSession context cancelled, stopping event processing",
				"session_id", sessionID)
			return
		case event, ok := <-claudeSession.Events:
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
				if err := queryInjector.InjectPendingQuery(ctx, sessionID, claudeSessionID); err != nil {
					slog.Error("failed to inject pending query",
						"sessionID", sessionID,
						"claudeSessionID", claudeSessionID,
						"error", err)
				}
			}

			// Process and store event
			if err := eventProcessor.ProcessStreamEvent(ctx, sessionID, claudeSessionID, event); err != nil {
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

	// Handle session completion or error
	if err != nil {
		if err := lifecycleManager.HandleSessionError(ctx, sessionID, err); err != nil {
			slog.Error("failed to handle session error", "error", err)
		}
	} else if result != nil && result.IsError {
		if err := lifecycleManager.HandleSessionResultError(ctx, sessionID, result); err != nil {
			slog.Error("failed to handle session result error", "error", err)
		}
	} else {
		if err := lifecycleManager.CompleteSession(ctx, sessionID, runID, result, startTime); err != nil {
			slog.Error("failed to complete session", "error", err)
		}
	}
}

// updateSessionStatus is now handled by LifecycleManager
// This method is kept for backward compatibility
func (m *Manager) updateSessionStatus(ctx context.Context, sessionID string, status Status, errorMsg string) {
	lifecycleManager := NewLifecycleManager(m.store, m.eventBus, m.activeProcesses, &m.mu, &m.pendingQueries)
	if err := lifecycleManager.UpdateSessionStatus(ctx, sessionID, status, errorMsg); err != nil {
		slog.Error("failed to update session status", "error", err)
	}
}

// GetSessionInfo returns session info from the database by ID
func (m *Manager) GetSessionInfo(sessionID string) (*Info, error) {
	ctx := context.Background()
	dbSession, err := m.store.GetSession(ctx, sessionID)
	if err != nil {
		if hlderrors.IsNotFound(err) {
			return nil, hlderrors.ErrSessionNotFound
		}
		return nil, hlderrors.NewSessionError("get_session", sessionID, err)
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

// ContinueSession resumes an existing completed session with a new query and optional config overrides
func (m *Manager) ContinueSession(ctx context.Context, req ContinueSessionConfig) (*Session, error) {
	// Get parent session from database
	parentSession, err := m.store.GetSession(ctx, req.ParentSessionID)
	if err != nil {
		if hlderrors.IsNotFound(err) {
			return nil, hlderrors.ErrSessionNotFound
		}
		return nil, hlderrors.NewSessionError("get_parent_session", req.ParentSessionID, err)
	}

	// Validate parent session status - allow completed or running sessions
	if parentSession.Status != store.SessionStatusCompleted && parentSession.Status != store.SessionStatusRunning {
		return nil, &hlderrors.SessionError{
			SessionID: req.ParentSessionID,
			Operation: "continue_session",
			State:     parentSession.Status,
			Err:       hlderrors.ErrInvalidSessionState,
		}
	}

	// Validate parent session has claude_session_id (needed for resume)
	if parentSession.ClaudeSessionID == "" {
		return nil, hlderrors.NewValidationError("claude_session_id", "parent session missing claude_session_id (cannot resume)")
	}

	// Validate parent session has working directory (needed for resume)
	if parentSession.WorkingDir == "" {
		return nil, hlderrors.NewValidationError("working_dir", "parent session missing working_dir (cannot resume session without working directory)")
	}

	// If session is running, interrupt it and wait for completion
	if parentSession.Status == store.SessionStatusRunning {
		slog.Info("interrupting running session before resume",
			"parent_session_id", req.ParentSessionID)

		if err := m.InterruptSession(ctx, req.ParentSessionID); err != nil {
			return nil, hlderrors.NewSessionError("interrupt_session", req.ParentSessionID, err)
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
			return nil, hlderrors.NewSessionError("get_parent_session_after_interrupt", req.ParentSessionID, err)
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
		return nil, hlderrors.NewSessionError("create_continuation_session", sessionID, err)
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
		return nil, hlderrors.NewSessionError("launch_resumed_session", sessionID, err)
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

	// Store query for injection after Claude session ID is captured
	m.pendingQueries.Store(sessionID, req.Query)

	// Monitor session lifecycle in background
	go m.monitorSession(ctx, sessionID, runID, claudeSession, time.Now(), config)

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
		return hlderrors.ErrSessionNotActive
	}

	// Keep the session in activeProcesses during interrupt to prevent race conditions
	// It will be cleaned up in the monitorSession goroutine after interrupt completes
	m.mu.Unlock()

	// Interrupt the Claude session
	if err := claudeSession.Interrupt(); err != nil {
		return hlderrors.NewSessionError("interrupt_claude_session", sessionID, err)
	}

	// Transition to completing status
	lifecycleManager := NewLifecycleManager(m.store, m.eventBus, m.activeProcesses, &m.mu, &m.pendingQueries)
	if err := lifecycleManager.TransitionToCompleting(ctx, sessionID); err != nil {
		slog.Error("failed to transition to completing status after interrupt",
			"session_id", sessionID,
			"error", err)
		// Continue anyway since the session was interrupted
	}

	return nil
}
