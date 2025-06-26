package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	claudecode "github.com/humanlayer/humanlayer/claudecode-go"
	_ "github.com/mattn/go-sqlite3"
)

// SQLiteStore implements ConversationStore using SQLite
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore creates a new SQLite-backed store
func NewSQLiteStore(dbPath string) (*SQLiteStore, error) {
	// Ensure directory exists (skip for in-memory databases)
	if dbPath != ":memory:" {
		dbDir := filepath.Dir(dbPath)
		if err := os.MkdirAll(dbDir, 0700); err != nil {
			return nil, fmt.Errorf("failed to create database directory: %w", err)
		}
	}

	// Open database
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Enable foreign keys and WAL mode for better concurrency
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to enable WAL mode: %w", err)
	}

	store := &SQLiteStore{db: db}

	// Initialize schema
	if err := store.initSchema(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	// Apply migrations (this must be called AFTER initSchema for both new and existing databases)
	if err := store.applyMigrations(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to apply migrations: %w", err)
	}

	slog.Info("SQLite store initialized", "path", dbPath)
	return store, nil
}

// initSchema creates the database schema if it doesn't exist
func (s *SQLiteStore) initSchema() error {
	schema := `
	-- Sessions table (metadata and configuration)
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL UNIQUE,
		claude_session_id TEXT,
		parent_session_id TEXT,

		-- Launch configuration
		query TEXT NOT NULL,
		summary TEXT,
		model TEXT,
		working_dir TEXT,
		max_turns INTEGER,
		system_prompt TEXT,
		append_system_prompt TEXT,
		custom_instructions TEXT,
		permission_prompt_tool TEXT,
		allowed_tools TEXT,
		disallowed_tools TEXT,

		-- Runtime status
		status TEXT NOT NULL DEFAULT 'starting',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		completed_at TIMESTAMP,

		-- Results
		cost_usd REAL,
		total_tokens INTEGER,
		duration_ms INTEGER,
		num_turns INTEGER,
		result_content TEXT,
		error_message TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_claude ON sessions(claude_session_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
	CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);

	-- Single conversation events table
	CREATE TABLE IF NOT EXISTS conversation_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		claude_session_id TEXT,
		sequence INTEGER NOT NULL,
		event_type TEXT NOT NULL,

		-- Common fields
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

		-- Message fields
		role TEXT,
		content TEXT,

		-- Tool call fields
		tool_id TEXT,
		tool_name TEXT,
		tool_input_json TEXT,

		-- Tool result fields
		tool_result_for_id TEXT,
		tool_result_content TEXT,

		-- Tool call completion and approval tracking
		is_completed BOOLEAN DEFAULT FALSE,  -- TRUE when tool result received
		approval_status TEXT,        -- NULL, 'pending', 'approved', 'denied'
		approval_id TEXT,           -- HumanLayer approval ID when correlated

		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);
	CREATE INDEX IF NOT EXISTS idx_conversation_claude_session ON conversation_events(claude_session_id, sequence);
	CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation_events(session_id, sequence);
	CREATE INDEX IF NOT EXISTS idx_conversation_approval ON conversation_events(approval_id);
	CREATE INDEX IF NOT EXISTS idx_conversation_pending_approvals
		ON conversation_events(approval_status)
		WHERE approval_status = 'pending';

	-- MCP servers configuration
	CREATE TABLE IF NOT EXISTS mcp_servers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		name TEXT NOT NULL,
		command TEXT NOT NULL,
		args_json TEXT,
		env_json TEXT,

		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);
	CREATE INDEX IF NOT EXISTS idx_mcp_servers_session ON mcp_servers(session_id);

	-- Raw events for debugging
	CREATE TABLE IF NOT EXISTS raw_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		event_json TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);
	CREATE INDEX IF NOT EXISTS idx_raw_events_session ON raw_events(session_id, created_at);

	-- Schema versioning
	CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER PRIMARY KEY,
		applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		description TEXT
	);
	`

	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	// Record initial schema version
	// For new databases, we start at version 3 since the schema includes all fields
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO schema_version (version, description)
		VALUES (1, 'Initial schema with conversation events')
	`)
	if err != nil {
		return err
	}

	// Mark new databases as having all migrations applied
	_, err = s.db.Exec(`
		INSERT OR IGNORE INTO schema_version (version, description)
		VALUES (3, 'Initial schema includes all permission and tool fields')
	`)
	return err
}

// applyMigrations applies any pending database migrations
func (s *SQLiteStore) applyMigrations() error {
	// Get current schema version
	var currentVersion int
	err := s.db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&currentVersion)
	if err != nil {
		return fmt.Errorf("failed to get current schema version: %w", err)
	}

	// Migration 2: Added constraint to ensure only resumable sessions can be parent sessions
	// (This migration already exists in production databases)

	// Migration 3: Add missing permission and tool fields
	if currentVersion < 3 {
		slog.Info("Applying migration 3: Add permission and tool fields")

		_, err := s.db.Exec(`
			-- Add missing columns to sessions table
			ALTER TABLE sessions ADD COLUMN permission_prompt_tool TEXT;
			ALTER TABLE sessions ADD COLUMN append_system_prompt TEXT;
			ALTER TABLE sessions ADD COLUMN allowed_tools TEXT;
			ALTER TABLE sessions ADD COLUMN disallowed_tools TEXT;
		`)
		if err != nil {
			return fmt.Errorf("failed to apply migration 3: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (3, 'Add permission_prompt_tool, append_system_prompt, allowed_tools, disallowed_tools fields')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 3: %w", err)
		}

		slog.Info("Migration 3 applied successfully")
	}

	return nil
}

// Close closes the database connection
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// CreateSession creates a new session
func (s *SQLiteStore) CreateSession(ctx context.Context, session *Session) error {
	query := `
		INSERT INTO sessions (
			id, run_id, claude_session_id, parent_session_id,
			query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := s.db.ExecContext(ctx, query,
		session.ID, session.RunID, session.ClaudeSessionID, session.ParentSessionID,
		session.Query, session.Summary, session.Model, session.WorkingDir, session.MaxTurns,
		session.SystemPrompt, session.AppendSystemPrompt, session.CustomInstructions,
		session.PermissionPromptTool, session.AllowedTools, session.DisallowedTools,
		session.Status, session.CreatedAt, session.LastActivityAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	return nil
}

// UpdateSession updates session fields
func (s *SQLiteStore) UpdateSession(ctx context.Context, sessionID string, updates SessionUpdate) error {
	query := `UPDATE sessions SET`
	args := []interface{}{}
	setParts := []string{}

	if updates.LastActivityAt != nil {
		setParts = append(setParts, "last_activity_at = ?")
		args = append(args, *updates.LastActivityAt)
	}
	if updates.ClaudeSessionID != nil {
		setParts = append(setParts, "claude_session_id = ?")
		args = append(args, *updates.ClaudeSessionID)
	}
	if updates.Status != nil {
		setParts = append(setParts, "status = ?")
		args = append(args, *updates.Status)
	}
	if updates.CompletedAt != nil {
		setParts = append(setParts, "completed_at = ?")
		args = append(args, *updates.CompletedAt)
	}
	if updates.CostUSD != nil {
		setParts = append(setParts, "cost_usd = ?")
		args = append(args, *updates.CostUSD)
	}
	if updates.TotalTokens != nil {
		setParts = append(setParts, "total_tokens = ?")
		args = append(args, *updates.TotalTokens)
	}
	if updates.DurationMS != nil {
		setParts = append(setParts, "duration_ms = ?")
		args = append(args, *updates.DurationMS)
	}
	if updates.NumTurns != nil {
		setParts = append(setParts, "num_turns = ?")
		args = append(args, *updates.NumTurns)
	}
	if updates.ResultContent != nil {
		setParts = append(setParts, "result_content = ?")
		args = append(args, *updates.ResultContent)
	}
	if updates.ErrorMessage != nil {
		setParts = append(setParts, "error_message = ?")
		args = append(args, *updates.ErrorMessage)
	}
	if updates.Summary != nil {
		setParts = append(setParts, "summary = ?")
		args = append(args, *updates.Summary)
	}

	if len(setParts) == 0 {
		return fmt.Errorf("no fields to update")
	}

	query += " " + strings.Join(setParts, ", ")

	query += " WHERE id = ?"
	args = append(args, sessionID)

	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update session: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	return nil
}

// GetSession retrieves a session by ID
func (s *SQLiteStore) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message
		FROM sessions WHERE id = ?
	`

	var session Session
	var claudeSessionID, parentSessionID, summary, model, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
	var permissionPromptTool, allowedTools, disallowedTools sql.NullString
	var completedAt sql.NullTime
	var costUSD sql.NullFloat64
	var totalTokens, durationMS, numTurns sql.NullInt64
	var resultContent, errorMessage sql.NullString

	err := s.db.QueryRowContext(ctx, query, sessionID).Scan(
		&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
		&session.Query, &summary, &model, &workingDir, &session.MaxTurns,
		&systemPrompt, &appendSystemPrompt, &customInstructions,
		&permissionPromptTool, &allowedTools, &disallowedTools,
		&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
		&costUSD, &totalTokens, &durationMS, &numTurns, &resultContent, &errorMessage,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Handle nullable fields
	session.ClaudeSessionID = claudeSessionID.String
	session.ParentSessionID = parentSessionID.String
	session.Summary = summary.String
	session.Model = model.String
	session.WorkingDir = workingDir.String
	session.SystemPrompt = systemPrompt.String
	session.AppendSystemPrompt = appendSystemPrompt.String
	session.CustomInstructions = customInstructions.String
	session.PermissionPromptTool = permissionPromptTool.String
	session.AllowedTools = allowedTools.String
	session.DisallowedTools = disallowedTools.String
	session.ResultContent = resultContent.String
	session.ErrorMessage = errorMessage.String
	if completedAt.Valid {
		session.CompletedAt = &completedAt.Time
	}
	if costUSD.Valid {
		session.CostUSD = &costUSD.Float64
	}
	if totalTokens.Valid {
		tokens := int(totalTokens.Int64)
		session.TotalTokens = &tokens
	}
	if durationMS.Valid {
		duration := int(durationMS.Int64)
		session.DurationMS = &duration
	}
	if numTurns.Valid {
		turns := int(numTurns.Int64)
		session.NumTurns = &turns
	}

	return &session, nil
}

// GetSessionByRunID retrieves a session by its run_id
func (s *SQLiteStore) GetSessionByRunID(ctx context.Context, runID string) (*Session, error) {
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message
		FROM sessions
		WHERE run_id = ?
	`

	var session Session
	var claudeSessionID, parentSessionID, summary, model, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
	var permissionPromptTool, allowedTools, disallowedTools sql.NullString
	var completedAt sql.NullTime
	var costUSD sql.NullFloat64
	var totalTokens, durationMS, numTurns sql.NullInt64
	var resultContent, errorMessage sql.NullString

	err := s.db.QueryRowContext(ctx, query, runID).Scan(
		&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
		&session.Query, &summary, &model, &workingDir, &session.MaxTurns,
		&systemPrompt, &appendSystemPrompt, &customInstructions,
		&permissionPromptTool, &allowedTools, &disallowedTools,
		&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
		&costUSD, &totalTokens, &durationMS, &numTurns, &resultContent, &errorMessage,
	)
	if err == sql.ErrNoRows {
		return nil, nil // No session found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session by run_id: %w", err)
	}

	// Convert nullable fields
	session.ClaudeSessionID = claudeSessionID.String
	session.ParentSessionID = parentSessionID.String
	session.Summary = summary.String
	session.Model = model.String
	session.WorkingDir = workingDir.String
	session.SystemPrompt = systemPrompt.String
	session.AppendSystemPrompt = appendSystemPrompt.String
	session.CustomInstructions = customInstructions.String
	session.PermissionPromptTool = permissionPromptTool.String
	session.AllowedTools = allowedTools.String
	session.DisallowedTools = disallowedTools.String
	session.ResultContent = resultContent.String
	session.ErrorMessage = errorMessage.String
	if completedAt.Valid {
		session.CompletedAt = &completedAt.Time
	}
	if costUSD.Valid {
		session.CostUSD = &costUSD.Float64
	}
	if totalTokens.Valid {
		tokens := int(totalTokens.Int64)
		session.TotalTokens = &tokens
	}
	if durationMS.Valid {
		duration := int(durationMS.Int64)
		session.DurationMS = &duration
	}
	if numTurns.Valid {
		turns := int(numTurns.Int64)
		session.NumTurns = &turns
	}

	return &session, nil
}

// ListSessions retrieves all sessions
func (s *SQLiteStore) ListSessions(ctx context.Context) ([]*Session, error) {
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, model, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, total_tokens, duration_ms, num_turns, result_content, error_message
		FROM sessions
		ORDER BY last_activity_at DESC
	`

	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sessions []*Session
	for rows.Next() {
		var session Session
		var claudeSessionID, parentSessionID, summary, model, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
		var permissionPromptTool, allowedTools, disallowedTools sql.NullString
		var completedAt sql.NullTime
		var costUSD sql.NullFloat64
		var totalTokens, durationMS, numTurns sql.NullInt64
		var resultContent, errorMessage sql.NullString

		err := rows.Scan(
			&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
			&session.Query, &summary, &model, &workingDir, &session.MaxTurns,
			&systemPrompt, &appendSystemPrompt, &customInstructions,
			&permissionPromptTool, &allowedTools, &disallowedTools,
			&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
			&costUSD, &totalTokens, &durationMS, &numTurns, &resultContent, &errorMessage,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}

		// Handle nullable fields
		session.ClaudeSessionID = claudeSessionID.String
		session.ParentSessionID = parentSessionID.String
		session.Summary = summary.String
		session.Model = model.String
		session.WorkingDir = workingDir.String
		session.SystemPrompt = systemPrompt.String
		session.AppendSystemPrompt = appendSystemPrompt.String
		session.CustomInstructions = customInstructions.String
		session.PermissionPromptTool = permissionPromptTool.String
		session.AllowedTools = allowedTools.String
		session.DisallowedTools = disallowedTools.String
		session.ResultContent = resultContent.String
		session.ErrorMessage = errorMessage.String
		if completedAt.Valid {
			session.CompletedAt = &completedAt.Time
		}
		if costUSD.Valid {
			session.CostUSD = &costUSD.Float64
		}
		if totalTokens.Valid {
			tokens := int(totalTokens.Int64)
			session.TotalTokens = &tokens
		}
		if durationMS.Valid {
			duration := int(durationMS.Int64)
			session.DurationMS = &duration
		}
		if numTurns.Valid {
			turns := int(numTurns.Int64)
			session.NumTurns = &turns
		}

		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// AddConversationEvent adds a new conversation event
func (s *SQLiteStore) AddConversationEvent(ctx context.Context, event *ConversationEvent) error {
	// Use a transaction to avoid race conditions with sequence numbers
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Get next sequence number for this claude session within the transaction
	var maxSeq sql.NullInt64
	err = tx.QueryRowContext(ctx,
		"SELECT MAX(sequence) FROM conversation_events WHERE claude_session_id = ?",
		event.ClaudeSessionID,
	).Scan(&maxSeq)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("failed to get max sequence: %w", err)
	}

	event.Sequence = int(maxSeq.Int64) + 1

	query := `
		INSERT INTO conversation_events (
			session_id, claude_session_id, sequence, event_type,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	result, err := tx.ExecContext(ctx, query,
		event.SessionID, event.ClaudeSessionID, event.Sequence, event.EventType,
		event.Role, event.Content,
		event.ToolID, event.ToolName, event.ToolInputJSON,
		event.ToolResultForID, event.ToolResultContent,
		event.IsCompleted, event.ApprovalStatus, event.ApprovalID,
	)
	if err != nil {
		return fmt.Errorf("failed to add conversation event: %w", err)
	}

	id, err := result.LastInsertId()
	if err == nil {
		event.ID = id
	}

	return tx.Commit()
}

// GetConversation retrieves all events for a Claude session
func (s *SQLiteStore) GetConversation(ctx context.Context, claudeSessionID string) ([]*ConversationEvent, error) {
	query := `
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE claude_session_id = ?
		ORDER BY sequence
	`

	rows, err := s.db.QueryContext(ctx, query, claudeSessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var events []*ConversationEvent
	for rows.Next() {
		event := &ConversationEvent{}
		err := rows.Scan(
			&event.ID, &event.SessionID, &event.ClaudeSessionID,
			&event.Sequence, &event.EventType, &event.CreatedAt,
			&event.Role, &event.Content,
			&event.ToolID, &event.ToolName, &event.ToolInputJSON,
			&event.ToolResultForID, &event.ToolResultContent,
			&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, event)
	}

	return events, nil
}

// GetSessionConversation retrieves all events for a session including parent history
func (s *SQLiteStore) GetSessionConversation(ctx context.Context, sessionID string) ([]*ConversationEvent, error) {
	// Walk up the parent chain to get all related claude session IDs
	claudeSessionIDs := []string{}
	currentID := sessionID

	for currentID != "" {
		var claudeSessionID sql.NullString
		var parentID sql.NullString

		err := s.db.QueryRowContext(ctx,
			"SELECT claude_session_id, parent_session_id FROM sessions WHERE id = ?",
			currentID,
		).Scan(&claudeSessionID, &parentID)
		if err != nil {
			if err == sql.ErrNoRows {
				break // Session not found, stop walking
			}
			return nil, fmt.Errorf("failed to get session: %w", err)
		}

		// Add claude session ID if present (in reverse order for chronological events)
		if claudeSessionID.Valid && claudeSessionID.String != "" {
			claudeSessionIDs = append([]string{claudeSessionID.String}, claudeSessionIDs...)
		}

		// Move to parent
		if parentID.Valid {
			currentID = parentID.String
		} else {
			currentID = ""
		}
	}

	if len(claudeSessionIDs) == 0 {
		// No claude sessions yet, return empty
		return []*ConversationEvent{}, nil
	}

	// Get all events for all claude session IDs in chronological order
	placeholders := make([]string, len(claudeSessionIDs))
	args := make([]interface{}, len(claudeSessionIDs))
	for i, id := range claudeSessionIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	// Build query that orders by the position in the claude session ID list first
	// This ensures parent events come before child events
	orderCases := make([]string, len(claudeSessionIDs))
	for i := range claudeSessionIDs {
		orderCases[i] = fmt.Sprintf("WHEN claude_session_id = ? THEN %d", i)
		args = append(args, claudeSessionIDs[i])
	}

	query := fmt.Sprintf(`
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE claude_session_id IN (%s)
		ORDER BY
			CASE %s END,
			sequence
	`, strings.Join(placeholders, ","), strings.Join(orderCases, " "))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to get conversation: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var events []*ConversationEvent
	for rows.Next() {
		event := &ConversationEvent{}
		err := rows.Scan(
			&event.ID, &event.SessionID, &event.ClaudeSessionID,
			&event.Sequence, &event.EventType, &event.CreatedAt,
			&event.Role, &event.Content,
			&event.ToolID, &event.ToolName, &event.ToolInputJSON,
			&event.ToolResultForID, &event.ToolResultContent,
			&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, event)
	}

	return events, nil
}

// GetPendingToolCall finds the most recent uncompleted tool call for a given session and tool name
func (s *SQLiteStore) GetPendingToolCall(ctx context.Context, sessionID string, toolName string) (*ConversationEvent, error) {
	// Find the most recent uncompleted tool call by sequence number (temporal proximity)
	query := `
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE tool_name = ?
		  AND session_id = ?
		  AND event_type = 'tool_call'
		  AND is_completed = FALSE
		ORDER BY sequence DESC  -- Most recent first
		LIMIT 1
	`

	event := &ConversationEvent{}
	err := s.db.QueryRowContext(ctx, query, toolName, sessionID).Scan(
		&event.ID, &event.SessionID, &event.ClaudeSessionID,
		&event.Sequence, &event.EventType, &event.CreatedAt,
		&event.Role, &event.Content,
		&event.ToolID, &event.ToolName, &event.ToolInputJSON,
		&event.ToolResultForID, &event.ToolResultContent,
		&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
	)
	if err == sql.ErrNoRows {
		return nil, nil // No pending tool call found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get pending tool call: %w", err)
	}

	return event, nil
}

// GetUncorrelatedPendingToolCall finds the most recent uncompleted tool call without approval correlation
func (s *SQLiteStore) GetUncorrelatedPendingToolCall(ctx context.Context, sessionID string, toolName string) (*ConversationEvent, error) {
	// Find the most recent uncompleted tool call by sequence number without approval
	query := `
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE tool_name = ?
		  AND session_id = ?
		  AND event_type = 'tool_call'
		  AND is_completed = FALSE
		  AND (approval_status IS NULL OR approval_status = '')
		ORDER BY sequence DESC  -- Most recent first
		LIMIT 1
	`

	event := &ConversationEvent{}
	err := s.db.QueryRowContext(ctx, query, toolName, sessionID).Scan(
		&event.ID, &event.SessionID, &event.ClaudeSessionID,
		&event.Sequence, &event.EventType, &event.CreatedAt,
		&event.Role, &event.Content,
		&event.ToolID, &event.ToolName, &event.ToolInputJSON,
		&event.ToolResultForID, &event.ToolResultContent,
		&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
	)
	if err == sql.ErrNoRows {
		return nil, nil // No pending tool call found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get uncorrelated pending tool call: %w", err)
	}

	return event, nil
}

// GetPendingToolCalls finds all uncompleted tool calls for a given session
func (s *SQLiteStore) GetPendingToolCalls(ctx context.Context, sessionID string) ([]*ConversationEvent, error) {
	query := `
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE session_id = ?
		  AND event_type = 'tool_call'
		  AND is_completed = FALSE
		ORDER BY sequence DESC
	`

	rows, err := s.db.QueryContext(ctx, query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pending tool calls: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var events []*ConversationEvent
	for rows.Next() {
		event := &ConversationEvent{}
		err := rows.Scan(
			&event.ID, &event.SessionID, &event.ClaudeSessionID,
			&event.Sequence, &event.EventType, &event.CreatedAt,
			&event.Role, &event.Content,
			&event.ToolID, &event.ToolName, &event.ToolInputJSON,
			&event.ToolResultForID, &event.ToolResultContent,
			&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan event: %w", err)
		}
		events = append(events, event)
	}

	return events, nil
}

// MarkToolCallCompleted marks a tool call as completed when its result is received
func (s *SQLiteStore) MarkToolCallCompleted(ctx context.Context, toolID string, sessionID string) error {
	query := `
		UPDATE conversation_events
		SET is_completed = TRUE
		WHERE tool_id = ?
		  AND session_id = ?
		  AND event_type = 'tool_call'
	`

	result, err := s.db.ExecContext(ctx, query, toolID, sessionID)
	if err != nil {
		return fmt.Errorf("failed to mark tool call completed: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		slog.Debug("no matching tool call found to mark completed",
			"tool_id", toolID,
			"session_id", sessionID)
	}

	return nil
}

// CorrelateApproval correlates an approval with a tool call
func (s *SQLiteStore) CorrelateApproval(ctx context.Context, sessionID string, toolName string, approvalID string) error {
	// Find the pending tool call
	toolCall, err := s.GetPendingToolCall(ctx, sessionID, toolName)
	if err != nil {
		return fmt.Errorf("failed to find pending tool call: %w", err)
	}
	if toolCall == nil {
		slog.Debug("no matching tool call found for approval",
			"session_id", sessionID,
			"tool_name", toolName,
			"approval_id", approvalID)
		return nil // Not an error - approval might be for a different session
	}

	// Ensure it doesn't already have an approval
	if toolCall.ApprovalStatus != "" {
		slog.Warn("tool call already has approval status",
			"tool_id", toolCall.ToolID,
			"existing_status", toolCall.ApprovalStatus,
			"approval_id", approvalID)
		return nil
	}

	slog.Debug("found tool call to correlate",
		"event_id", toolCall.ID,
		"tool_id", toolCall.ToolID,
		"session_id", sessionID,
		"tool_name", toolName,
		"approval_id", approvalID)

	// Update the found event
	updateQuery := `
		UPDATE conversation_events
		SET approval_status = 'pending', approval_id = ?
		WHERE id = ?
	`

	result, err := s.db.ExecContext(ctx, updateQuery, approvalID, toolCall.ID)
	if err != nil {
		return fmt.Errorf("failed to correlate approval: %w", err)
	}

	rows, _ := result.RowsAffected()
	slog.Info("updated tool call with approval",
		"event_id", toolCall.ID,
		"rows_affected", rows)

	return nil
}

// CorrelateApprovalByToolID correlates an approval with a specific tool call by tool_id
func (s *SQLiteStore) CorrelateApprovalByToolID(ctx context.Context, sessionID string, toolID string, approvalID string) error {
	// Update the tool call directly by tool_id
	updateQuery := `
		UPDATE conversation_events
		SET approval_status = 'pending', approval_id = ?
		WHERE session_id = ?
		  AND tool_id = ?
		  AND event_type = 'tool_call'
		  AND is_completed = FALSE
		  AND (approval_status IS NULL OR approval_status = '')
	`

	result, err := s.db.ExecContext(ctx, updateQuery, approvalID, sessionID, toolID)
	if err != nil {
		return fmt.Errorf("failed to correlate approval by tool_id: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		slog.Debug("no matching tool call found for approval by tool_id",
			"session_id", sessionID,
			"tool_id", toolID,
			"approval_id", approvalID)
		return nil // Not an error
	}

	slog.Info("correlated approval with tool call by tool_id",
		"tool_id", toolID,
		"session_id", sessionID,
		"approval_id", approvalID,
		"rows_affected", rows)

	return nil
}

// UpdateApprovalStatus updates the status of an approval
func (s *SQLiteStore) UpdateApprovalStatus(ctx context.Context, approvalID string, status string) error {
	query := `
		UPDATE conversation_events
		SET approval_status = ?
		WHERE approval_id = ?
	`

	_, err := s.db.ExecContext(ctx, query, status, approvalID)
	if err != nil {
		return fmt.Errorf("failed to update approval status: %w", err)
	}
	return nil
}

// StoreMCPServers stores MCP server configurations
func (s *SQLiteStore) StoreMCPServers(ctx context.Context, sessionID string, servers []MCPServer) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	query := `
		INSERT INTO mcp_servers (session_id, name, command, args_json, env_json)
		VALUES (?, ?, ?, ?, ?)
	`

	for _, server := range servers {
		_, err := tx.ExecContext(ctx, query,
			sessionID, server.Name, server.Command, server.ArgsJSON, server.EnvJSON)
		if err != nil {
			return fmt.Errorf("failed to insert MCP server: %w", err)
		}
	}

	return tx.Commit()
}

// GetMCPServers retrieves MCP servers for a session
func (s *SQLiteStore) GetMCPServers(ctx context.Context, sessionID string) ([]MCPServer, error) {
	query := `
		SELECT id, session_id, name, command, args_json, env_json
		FROM mcp_servers
		WHERE session_id = ?
	`

	rows, err := s.db.QueryContext(ctx, query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get MCP servers: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var servers []MCPServer
	for rows.Next() {
		var server MCPServer
		err := rows.Scan(
			&server.ID, &server.SessionID, &server.Name,
			&server.Command, &server.ArgsJSON, &server.EnvJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan MCP server: %w", err)
		}
		servers = append(servers, server)
	}

	return servers, nil
}

// StoreRawEvent stores a raw event for debugging
func (s *SQLiteStore) StoreRawEvent(ctx context.Context, sessionID string, eventJSON string) error {
	query := `
		INSERT INTO raw_events (session_id, event_json)
		VALUES (?, ?)
	`

	_, err := s.db.ExecContext(ctx, query, sessionID, eventJSON)
	if err != nil {
		return fmt.Errorf("failed to store raw event: %w", err)
	}
	return nil
}

// Helper function to convert MCP config to store format
func MCPServersFromConfig(sessionID string, config map[string]claudecode.MCPServer) ([]MCPServer, error) {
	servers := make([]MCPServer, 0, len(config))
	for name, server := range config {
		argsJSON, err := json.Marshal(server.Args)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal args: %w", err)
		}

		envJSON, err := json.Marshal(server.Env)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal env: %w", err)
		}

		servers = append(servers, MCPServer{
			SessionID: sessionID,
			Name:      name,
			Command:   server.Command,
			ArgsJSON:  string(argsJSON),
			EnvJSON:   string(envJSON),
		})
	}
	return servers, nil
}
