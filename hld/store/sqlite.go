package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

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
		duration_ms INTEGER,
		num_turns INTEGER,
		result_content TEXT,
		error_message TEXT,

		-- Session settings
		auto_accept_edits BOOLEAN DEFAULT 0,
		dangerously_skip_permissions BOOLEAN DEFAULT 0,
		dangerously_skip_permissions_expires_at TIMESTAMP,

		-- Archival
		archived BOOLEAN DEFAULT FALSE
	);
	CREATE INDEX IF NOT EXISTS idx_sessions_claude ON sessions(claude_session_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
	CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

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

	-- Approvals table for local approvals
	CREATE TABLE IF NOT EXISTS approvals (
		id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		responded_at DATETIME,

		-- Tool approval fields
		tool_name TEXT NOT NULL,
		tool_input TEXT NOT NULL, -- JSON

		-- Response fields
		comment TEXT, -- For denial reasons or approval notes

		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);
	CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status = 'pending';
	CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);
	CREATE INDEX IF NOT EXISTS idx_approvals_run_id ON approvals(run_id);
	`

	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("failed to create schema: %w", err)
	}

	// Record initial schema version for new databases only
	// Migration system will handle upgrading existing databases
	_, err := s.db.Exec(`
		INSERT OR IGNORE INTO schema_version (version, description)
		VALUES (1, 'Initial schema with conversation events')
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

		// Check if columns already exist (they might be in the schema for new databases)
		var columnCount int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name IN ('permission_prompt_tool', 'append_system_prompt', 'allowed_tools', 'disallowed_tools')
		`).Scan(&columnCount)
		if err != nil {
			return fmt.Errorf("failed to check existing columns: %w", err)
		}

		// Only add columns if they don't exist
		if columnCount < 4 {
			// SQLite requires separate ALTER TABLE statements
			alterations := []struct {
				column string
				sql    string
			}{
				{"permission_prompt_tool", "ALTER TABLE sessions ADD COLUMN permission_prompt_tool TEXT"},
				{"append_system_prompt", "ALTER TABLE sessions ADD COLUMN append_system_prompt TEXT"},
				{"allowed_tools", "ALTER TABLE sessions ADD COLUMN allowed_tools TEXT"},
				{"disallowed_tools", "ALTER TABLE sessions ADD COLUMN disallowed_tools TEXT"},
			}

			for _, alt := range alterations {
				// Check if this specific column exists
				var exists int
				err = s.db.QueryRow(`
					SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?
				`, alt.column).Scan(&exists)
				if err != nil {
					return fmt.Errorf("failed to check column %s: %w", alt.column, err)
				}

				if exists == 0 {
					_, err := s.db.Exec(alt.sql)
					if err != nil {
						return fmt.Errorf("failed to add column %s: %w", alt.column, err)
					}
				}
			}
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

	// Migration 4: Add approvals table for local approvals
	if currentVersion < 4 {
		slog.Info("Applying migration 4: Add approvals table for local approvals")

		// Create the approvals table
		_, err = s.db.Exec(`
			CREATE TABLE IF NOT EXISTS approvals (
				id TEXT PRIMARY KEY,
				run_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
				created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				responded_at DATETIME,

				-- Tool approval fields
				tool_name TEXT NOT NULL,
				tool_input TEXT NOT NULL, -- JSON

				-- Response fields
				comment TEXT, -- For denial reasons or approval notes

				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);
			CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status) WHERE status = 'pending';
			CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);
			CREATE INDEX IF NOT EXISTS idx_approvals_run_id ON approvals(run_id);
		`)
		if err != nil {
			return fmt.Errorf("failed to create approvals table: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (4, 'Add approvals table for local approvals')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 4: %w", err)
		}

		slog.Info("Migration 4 applied successfully")
	}

	// Migration 5: Add index on parent_session_id for efficient tree queries
	if currentVersion < 5 {
		slog.Info("Applying migration 5: Add index on parent_session_id")

		// Create index on parent_session_id for efficient child queries
		_, err = s.db.Exec(`
			CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)
		`)
		if err != nil {
			return fmt.Errorf("failed to create parent_session_id index: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (5, 'Add index on parent_session_id for efficient tree queries')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 5: %w", err)
		}

		slog.Info("Migration 5 applied successfully")
	}

	// Migration 6: Add parent_tool_use_id for sub-task tracking
	if currentVersion < 6 {
		slog.Info("Applying migration 6: Add parent_tool_use_id for sub-task tracking")

		// Check if column already exists (it might be in the schema for new databases)
		var columnExists int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('conversation_events')
			WHERE name = 'parent_tool_use_id'
		`).Scan(&columnExists)
		if err != nil {
			return fmt.Errorf("failed to check parent_tool_use_id column: %w", err)
		}

		// Only add column if it doesn't exist
		if columnExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE conversation_events
				ADD COLUMN parent_tool_use_id TEXT
			`)
			if err != nil {
				return fmt.Errorf("failed to add parent_tool_use_id column: %w", err)
			}
		}

		// Create index for efficient parent queries
		_, err = s.db.Exec(`
			CREATE INDEX IF NOT EXISTS idx_conversation_parent_tool
			ON conversation_events(parent_tool_use_id)
			WHERE parent_tool_use_id IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("failed to create parent_tool_use_id index: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (6, 'Add parent_tool_use_id for sub-task tracking')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 6: %w", err)
		}

		slog.Info("Migration 6 applied successfully")
	}

	// Migration 7: Add file_snapshots table for Read operation tracking
	if currentVersion < 7 {
		slog.Info("Applying migration 7: Add file_snapshots table")

		_, err = s.db.Exec(`
			CREATE TABLE IF NOT EXISTS file_snapshots (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tool_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				file_path TEXT NOT NULL, -- Relative path from tool call
				content TEXT NOT NULL,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);
			CREATE INDEX IF NOT EXISTS idx_snapshots_session_path
				ON file_snapshots(session_id, file_path);
			CREATE INDEX IF NOT EXISTS idx_snapshots_tool
				ON file_snapshots(tool_id);
		`)
		if err != nil {
			return fmt.Errorf("failed to create file_snapshots table: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (7, 'Add file_snapshots table for Read operation tracking')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 7: %w", err)
		}

		slog.Info("Migration 7 applied successfully")
	}

	// Migration 8: Add auto_accept_edits for session-level edit auto-approval
	if currentVersion < 8 {
		slog.Info("Applying migration 8: Add auto_accept_edits column")

		// Check if column already exists (it might be in the schema for new databases)
		var columnExists int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name = 'auto_accept_edits'
		`).Scan(&columnExists)
		if err != nil {
			return fmt.Errorf("failed to check auto_accept_edits column: %w", err)
		}

		// Only add column if it doesn't exist
		if columnExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN auto_accept_edits BOOLEAN DEFAULT 0
			`)
			if err != nil {
				return fmt.Errorf("failed to add auto_accept_edits column: %w", err)
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (8, 'Add auto_accept_edits for session-level edit auto-approval')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 8: %w", err)
		}

		slog.Info("Migration 8 applied successfully")
	}

	// Migration 9: Add archived field to sessions table
	if currentVersion < 9 {
		slog.Info("Applying migration 9: Add archived field to sessions table")

		// Check if column already exists
		var columnExists int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name = 'archived'
		`).Scan(&columnExists)
		if err != nil {
			return fmt.Errorf("failed to check archived column: %w", err)
		}

		// Only add column if it doesn't exist
		if columnExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN archived BOOLEAN DEFAULT FALSE
			`)
			if err != nil {
				return fmt.Errorf("failed to add archived column: %w", err)
			}
		}

		// Add index for efficient filtering
		_, err = s.db.Exec(`
			CREATE INDEX IF NOT EXISTS idx_sessions_archived
			ON sessions(archived)
		`)
		if err != nil {
			return fmt.Errorf("failed to create archived index: %w", err)
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (9, 'Add archived field to sessions table for hiding old sessions')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 9: %w", err)
		}

		slog.Info("Migration 9 applied successfully")
	}

	// Migration 10: Add title column to sessions table
	if currentVersion < 10 {
		slog.Info("Applying migration 10: Add title column to sessions table")

		// Check if column already exists for idempotency
		var columnExists int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name = 'title'
		`).Scan(&columnExists)
		if err != nil {
			return fmt.Errorf("checking for title column: %w", err)
		}

		if columnExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN title TEXT DEFAULT ''
			`)
			if err != nil {
				return fmt.Errorf("adding title column: %w", err)
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (10, 'Add title column to sessions table')
		`)
		if err != nil {
			return fmt.Errorf("recording migration 10: %w", err)
		}

		slog.Info("Migration 10 applied successfully")
	}

	// Migration 11: Add dangerously skip permissions with timeout support
	if currentVersion < 11 {
		slog.Info("Applying migration 11: Add dangerously skip permissions columns")

		// Check if columns already exist
		var skipPermissionsExists, expiryExists int
		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name = 'dangerously_skip_permissions'
		`).Scan(&skipPermissionsExists)
		if err != nil {
			return fmt.Errorf("failed to check dangerously_skip_permissions column: %w", err)
		}

		err = s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions')
			WHERE name = 'dangerously_skip_permissions_expires_at'
		`).Scan(&expiryExists)
		if err != nil {
			return fmt.Errorf("failed to check dangerously_skip_permissions_expires_at column: %w", err)
		}

		// Add columns if they don't exist
		if skipPermissionsExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN dangerously_skip_permissions BOOLEAN DEFAULT 0
			`)
			if err != nil {
				return fmt.Errorf("failed to add dangerously_skip_permissions column: %w", err)
			}
		}

		if expiryExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN dangerously_skip_permissions_expires_at TIMESTAMP
			`)
			if err != nil {
				return fmt.Errorf("failed to add dangerously_skip_permissions_expires_at column: %w", err)
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (11, 'Add dangerously skip permissions with timeout support')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 11: %w", err)
		}

		slog.Info("Migration 11 applied successfully")
	}

	// Migration 12: Add model_id column for storing full model identifier
	if currentVersion < 12 {
		slog.Info("Applying migration 12: Add model_id column")

		// Check if model_id column exists
		var modelIdExists int
		err := s.db.QueryRow(`
			SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'model_id'
		`).Scan(&modelIdExists)
		if err != nil {
			return fmt.Errorf("failed to check for model_id column: %w", err)
		}

		if modelIdExists == 0 {
			_, err = s.db.Exec(`
				ALTER TABLE sessions
				ADD COLUMN model_id TEXT
			`)
			if err != nil {
				return fmt.Errorf("failed to add model_id column: %w", err)
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (12, 'Add model_id column for full model identifier')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 12: %w", err)
		}

		slog.Info("Migration 12 applied successfully")
	}

	// Migration 13: Add detailed token tracking fields
	if currentVersion < 13 {
		slog.Info("Applying migration 13: Add detailed token tracking fields")

		// Check if columns already exist
		columnChecks := []string{
			"input_tokens",
			"output_tokens",
			"cache_creation_input_tokens",
			"cache_read_input_tokens",
			"effective_context_tokens",
		}

		for _, column := range columnChecks {
			var columnExists int
			err = s.db.QueryRow(`
				SELECT COUNT(*) FROM pragma_table_info('sessions')
				WHERE name = ?
			`, column).Scan(&columnExists)
			if err != nil {
				return fmt.Errorf("failed to check %s column: %w", column, err)
			}

			// Only add column if it doesn't exist
			if columnExists == 0 {
				_, err = s.db.Exec(fmt.Sprintf(`
					ALTER TABLE sessions
					ADD COLUMN %s INTEGER
				`, column))
				if err != nil {
					return fmt.Errorf("failed to add %s column: %w", column, err)
				}
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (13, 'Add detailed token tracking fields (input, output, cache, effective context)')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 13: %w", err)
		}

		slog.Info("Migration 13 applied successfully")
	}

	// Migration 14: Add proxy configuration columns for model customization
	if currentVersion < 14 {
		slog.Info("Applying migration 14: Add proxy configuration columns")

		// Check if columns already exist for idempotency
		columnsToAdd := []struct {
			name         string
			sqlType      string
			defaultValue string
		}{
			{"proxy_enabled", "BOOLEAN", "0"},
			{"proxy_base_url", "TEXT", "''"},
			{"proxy_model_override", "TEXT", "''"},
			{"proxy_api_key", "TEXT", "''"},
		}

		for _, col := range columnsToAdd {
			var columnExists int
			err = s.db.QueryRow(`
				SELECT COUNT(*) FROM pragma_table_info('sessions')
				WHERE name = ?
			`, col.name).Scan(&columnExists)
			if err != nil {
				return fmt.Errorf("failed to check column %s: %w", col.name, err)
			}

			if columnExists == 0 {
				_, err = s.db.Exec(fmt.Sprintf(`
					ALTER TABLE sessions
					ADD COLUMN %s %s DEFAULT %s
				`, col.name, col.sqlType, col.defaultValue))
				if err != nil {
					return fmt.Errorf("failed to add column %s: %w", col.name, err)
				}
			}
		}

		// Record migration
		_, err = s.db.Exec(`
			INSERT INTO schema_version (version, description)
			VALUES (14, 'Add proxy configuration columns for model customization')
		`)
		if err != nil {
			return fmt.Errorf("failed to record migration 14: %w", err)
		}

		slog.Info("Migration 14 applied successfully")
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
			query, summary, title, model, model_id, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, auto_accept_edits, archived, dangerously_skip_permissions, dangerously_skip_permissions_expires_at,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := s.db.ExecContext(ctx, query,
		session.ID, session.RunID, session.ClaudeSessionID, session.ParentSessionID,
		session.Query, session.Summary, session.Title, session.Model, session.ModelID, session.WorkingDir, session.MaxTurns,
		session.SystemPrompt, session.AppendSystemPrompt, session.CustomInstructions,
		session.PermissionPromptTool, session.AllowedTools, session.DisallowedTools,
		session.Status, session.CreatedAt, session.LastActivityAt, session.AutoAcceptEdits, session.Archived,
		session.DangerouslySkipPermissions, session.DangerouslySkipPermissionsExpiresAt,
		session.ProxyEnabled, session.ProxyBaseURL, session.ProxyModelOverride, session.ProxyAPIKey,
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
	if updates.InputTokens != nil {
		setParts = append(setParts, "input_tokens = ?")
		args = append(args, *updates.InputTokens)
	}
	if updates.OutputTokens != nil {
		setParts = append(setParts, "output_tokens = ?")
		args = append(args, *updates.OutputTokens)
	}
	if updates.CacheCreationInputTokens != nil {
		setParts = append(setParts, "cache_creation_input_tokens = ?")
		args = append(args, *updates.CacheCreationInputTokens)
	}
	if updates.CacheReadInputTokens != nil {
		setParts = append(setParts, "cache_read_input_tokens = ?")
		args = append(args, *updates.CacheReadInputTokens)
	}
	if updates.EffectiveContextTokens != nil {
		setParts = append(setParts, "effective_context_tokens = ?")
		args = append(args, *updates.EffectiveContextTokens)
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
	if updates.Title != nil {
		setParts = append(setParts, "title = ?")
		args = append(args, *updates.Title)
	}
	if updates.AutoAcceptEdits != nil {
		setParts = append(setParts, "auto_accept_edits = ?")
		args = append(args, *updates.AutoAcceptEdits)
	}
	if updates.DangerouslySkipPermissions != nil {
		setParts = append(setParts, "dangerously_skip_permissions = ?")
		args = append(args, *updates.DangerouslySkipPermissions)
	}
	if updates.DangerouslySkipPermissionsExpiresAt != nil {
		setParts = append(setParts, "dangerously_skip_permissions_expires_at = ?")
		if *updates.DangerouslySkipPermissionsExpiresAt != nil {
			args = append(args, **updates.DangerouslySkipPermissionsExpiresAt)
		} else {
			args = append(args, nil)
		}
	}
	if updates.Model != nil {
		setParts = append(setParts, "model = ?")
		args = append(args, *updates.Model)
	}
	if updates.ModelID != nil {
		setParts = append(setParts, "model_id = ?")
		args = append(args, *updates.ModelID)
	}
	if updates.Archived != nil {
		setParts = append(setParts, "archived = ?")
		args = append(args, *updates.Archived)
	}
	// Handle proxy field updates
	if updates.ProxyEnabled != nil {
		setParts = append(setParts, "proxy_enabled = ?")
		args = append(args, *updates.ProxyEnabled)
	}
	if updates.ProxyBaseURL != nil {
		setParts = append(setParts, "proxy_base_url = ?")
		args = append(args, *updates.ProxyBaseURL)
	}
	if updates.ProxyModelOverride != nil {
		setParts = append(setParts, "proxy_model_override = ?")
		args = append(args, *updates.ProxyModelOverride)
	}
	if updates.ProxyAPIKey != nil {
		setParts = append(setParts, "proxy_api_key = ?")
		args = append(args, *updates.ProxyAPIKey)
	}

	if len(setParts) == 0 {
		// No fields to update is OK - this is a no-op
		return nil
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
			query, summary, title, model, model_id, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, effective_context_tokens,
			duration_ms, num_turns, result_content, error_message, auto_accept_edits, archived,
			dangerously_skip_permissions, dangerously_skip_permissions_expires_at,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
		FROM sessions WHERE id = ?
	`

	var session Session
	var claudeSessionID, parentSessionID, summary, title, model, modelID, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
	var permissionPromptTool, allowedTools, disallowedTools sql.NullString
	var completedAt sql.NullTime
	var costUSD sql.NullFloat64
	var inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, effectiveContextTokens sql.NullInt64
	var durationMS, numTurns sql.NullInt64
	var resultContent, errorMessage sql.NullString
	var archived sql.NullBool
	var dangerouslySkipPermissionsExpiresAt sql.NullTime
	var proxyEnabled sql.NullBool
	var proxyBaseURL, proxyModelOverride, proxyAPIKey sql.NullString

	err := s.db.QueryRowContext(ctx, query, sessionID).Scan(
		&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
		&session.Query, &summary, &title, &model, &modelID, &workingDir, &session.MaxTurns,
		&systemPrompt, &appendSystemPrompt, &customInstructions,
		&permissionPromptTool, &allowedTools, &disallowedTools,
		&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
		&costUSD, &inputTokens, &outputTokens, &cacheCreationInputTokens, &cacheReadInputTokens, &effectiveContextTokens,
		&durationMS, &numTurns, &resultContent, &errorMessage, &session.AutoAcceptEdits,
		&archived, &session.DangerouslySkipPermissions, &dangerouslySkipPermissionsExpiresAt,
		&proxyEnabled, &proxyBaseURL, &proxyModelOverride, &proxyAPIKey,
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
	session.Title = title.String
	session.Model = model.String
	session.ModelID = modelID.String
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
	if inputTokens.Valid {
		tokens := int(inputTokens.Int64)
		session.InputTokens = &tokens
	}
	if outputTokens.Valid {
		tokens := int(outputTokens.Int64)
		session.OutputTokens = &tokens
	}
	if cacheCreationInputTokens.Valid {
		tokens := int(cacheCreationInputTokens.Int64)
		session.CacheCreationInputTokens = &tokens
	}
	if cacheReadInputTokens.Valid {
		tokens := int(cacheReadInputTokens.Int64)
		session.CacheReadInputTokens = &tokens
	}
	if effectiveContextTokens.Valid {
		tokens := int(effectiveContextTokens.Int64)
		session.EffectiveContextTokens = &tokens
	}
	if durationMS.Valid {
		duration := int(durationMS.Int64)
		session.DurationMS = &duration
	}
	if numTurns.Valid {
		turns := int(numTurns.Int64)
		session.NumTurns = &turns
	}

	// Handle archived field - default to false if NULL
	session.Archived = archived.Valid && archived.Bool

	// Handle dangerously skip permissions expires at
	if dangerouslySkipPermissionsExpiresAt.Valid {
		session.DangerouslySkipPermissionsExpiresAt = &dangerouslySkipPermissionsExpiresAt.Time
	}

	// Handle proxy fields
	session.ProxyEnabled = proxyEnabled.Valid && proxyEnabled.Bool
	session.ProxyBaseURL = proxyBaseURL.String
	session.ProxyModelOverride = proxyModelOverride.String
	session.ProxyAPIKey = proxyAPIKey.String

	return &session, nil
}

// GetSessionByRunID retrieves a session by its run_id
func (s *SQLiteStore) GetSessionByRunID(ctx context.Context, runID string) (*Session, error) {
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, title, model, model_id, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, effective_context_tokens,
			duration_ms, num_turns, result_content, error_message, auto_accept_edits, archived,
			dangerously_skip_permissions, dangerously_skip_permissions_expires_at,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
		FROM sessions
		WHERE run_id = ?
	`

	var session Session
	var claudeSessionID, parentSessionID, summary, title, model, modelID, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
	var permissionPromptTool, allowedTools, disallowedTools sql.NullString
	var completedAt sql.NullTime
	var costUSD sql.NullFloat64
	var inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, effectiveContextTokens sql.NullInt64
	var durationMS, numTurns sql.NullInt64
	var resultContent, errorMessage sql.NullString
	var archived sql.NullBool
	var dangerouslySkipPermissionsExpiresAt sql.NullTime
	var proxyEnabled sql.NullBool
	var proxyBaseURL, proxyModelOverride, proxyAPIKey sql.NullString

	err := s.db.QueryRowContext(ctx, query, runID).Scan(
		&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
		&session.Query, &summary, &title, &model, &modelID, &workingDir, &session.MaxTurns,
		&systemPrompt, &appendSystemPrompt, &customInstructions,
		&permissionPromptTool, &allowedTools, &disallowedTools,
		&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
		&costUSD, &inputTokens, &outputTokens, &cacheCreationInputTokens, &cacheReadInputTokens, &effectiveContextTokens,
		&durationMS, &numTurns, &resultContent, &errorMessage, &session.AutoAcceptEdits,
		&archived, &session.DangerouslySkipPermissions, &dangerouslySkipPermissionsExpiresAt,
		&proxyEnabled, &proxyBaseURL, &proxyModelOverride, &proxyAPIKey,
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
	session.Title = title.String
	session.Model = model.String
	session.ModelID = modelID.String
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
	if inputTokens.Valid {
		tokens := int(inputTokens.Int64)
		session.InputTokens = &tokens
	}
	if outputTokens.Valid {
		tokens := int(outputTokens.Int64)
		session.OutputTokens = &tokens
	}
	if cacheCreationInputTokens.Valid {
		tokens := int(cacheCreationInputTokens.Int64)
		session.CacheCreationInputTokens = &tokens
	}
	if cacheReadInputTokens.Valid {
		tokens := int(cacheReadInputTokens.Int64)
		session.CacheReadInputTokens = &tokens
	}
	if effectiveContextTokens.Valid {
		tokens := int(effectiveContextTokens.Int64)
		session.EffectiveContextTokens = &tokens
	}
	if durationMS.Valid {
		duration := int(durationMS.Int64)
		session.DurationMS = &duration
	}
	if numTurns.Valid {
		turns := int(numTurns.Int64)
		session.NumTurns = &turns
	}

	// Handle archived field - default to false if NULL
	session.Archived = archived.Valid && archived.Bool

	// Handle dangerously skip permissions expires at
	if dangerouslySkipPermissionsExpiresAt.Valid {
		session.DangerouslySkipPermissionsExpiresAt = &dangerouslySkipPermissionsExpiresAt.Time
	}

	// Handle proxy fields
	session.ProxyEnabled = proxyEnabled.Valid && proxyEnabled.Bool
	session.ProxyBaseURL = proxyBaseURL.String
	session.ProxyModelOverride = proxyModelOverride.String
	session.ProxyAPIKey = proxyAPIKey.String

	return &session, nil
}

// ListSessions retrieves all sessions
func (s *SQLiteStore) ListSessions(ctx context.Context) ([]*Session, error) {
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, title, model, model_id, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, effective_context_tokens,
		duration_ms, num_turns, result_content, error_message, auto_accept_edits, archived,
			dangerously_skip_permissions, dangerously_skip_permissions_expires_at,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
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
		var claudeSessionID, parentSessionID, summary, title, model, modelID, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
		var permissionPromptTool, allowedTools, disallowedTools sql.NullString
		var completedAt sql.NullTime
		var costUSD sql.NullFloat64
		var inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, effectiveContextTokens sql.NullInt64
		var durationMS, numTurns sql.NullInt64
		var resultContent, errorMessage sql.NullString
		var archived sql.NullBool
		var dangerouslySkipPermissionsExpiresAt sql.NullTime
		var proxyEnabled sql.NullBool
		var proxyBaseURL, proxyModelOverride, proxyAPIKey sql.NullString

		err := rows.Scan(
			&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
			&session.Query, &summary, &title, &model, &modelID, &workingDir, &session.MaxTurns,
			&systemPrompt, &appendSystemPrompt, &customInstructions,
			&permissionPromptTool, &allowedTools, &disallowedTools,
			&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
			&costUSD, &inputTokens, &outputTokens, &cacheCreationInputTokens, &cacheReadInputTokens, &effectiveContextTokens,
			&durationMS, &numTurns, &resultContent, &errorMessage, &session.AutoAcceptEdits,
			&archived, &session.DangerouslySkipPermissions, &dangerouslySkipPermissionsExpiresAt,
			&proxyEnabled, &proxyBaseURL, &proxyModelOverride, &proxyAPIKey,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}

		// Handle nullable fields
		session.ClaudeSessionID = claudeSessionID.String
		session.ParentSessionID = parentSessionID.String
		session.Summary = summary.String
		session.Title = title.String
		session.Model = model.String
		session.ModelID = modelID.String
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
		if inputTokens.Valid {
			tokens := int(inputTokens.Int64)
			session.InputTokens = &tokens
		}
		if outputTokens.Valid {
			tokens := int(outputTokens.Int64)
			session.OutputTokens = &tokens
		}
		if cacheCreationInputTokens.Valid {
			tokens := int(cacheCreationInputTokens.Int64)
			session.CacheCreationInputTokens = &tokens
		}
		if cacheReadInputTokens.Valid {
			tokens := int(cacheReadInputTokens.Int64)
			session.CacheReadInputTokens = &tokens
		}
		if effectiveContextTokens.Valid {
			tokens := int(effectiveContextTokens.Int64)
			session.EffectiveContextTokens = &tokens
		}
		if durationMS.Valid {
			duration := int(durationMS.Int64)
			session.DurationMS = &duration
		}
		if numTurns.Valid {
			turns := int(numTurns.Int64)
			session.NumTurns = &turns
		}
		session.ResultContent = resultContent.String
		session.ErrorMessage = errorMessage.String

		// Handle archived field - default to false if NULL
		session.Archived = archived.Valid && archived.Bool

		// Handle dangerously skip permissions expires at
		if dangerouslySkipPermissionsExpiresAt.Valid {
			session.DangerouslySkipPermissionsExpiresAt = &dangerouslySkipPermissionsExpiresAt.Time
		}

		// Handle proxy fields
		session.ProxyEnabled = proxyEnabled.Valid && proxyEnabled.Bool
		session.ProxyBaseURL = proxyBaseURL.String
		session.ProxyModelOverride = proxyModelOverride.String
		session.ProxyAPIKey = proxyAPIKey.String

		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// GetExpiredDangerousPermissionsSessions returns sessions where dangerous permissions have expired
func (s *SQLiteStore) GetExpiredDangerousPermissionsSessions(ctx context.Context) ([]*Session, error) {
	now := time.Now()
	query := `
		SELECT id, run_id, claude_session_id, parent_session_id,
			query, summary, title, model, model_id, working_dir, max_turns, system_prompt, append_system_prompt, custom_instructions,
			permission_prompt_tool, allowed_tools, disallowed_tools,
			status, created_at, last_activity_at, completed_at,
			cost_usd, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, effective_context_tokens,
		duration_ms, num_turns, result_content, error_message, auto_accept_edits, archived,
			dangerously_skip_permissions, dangerously_skip_permissions_expires_at,
			proxy_enabled, proxy_base_url, proxy_model_override, proxy_api_key
		FROM sessions
		WHERE dangerously_skip_permissions = 1
			AND dangerously_skip_permissions_expires_at IS NOT NULL
			AND dangerously_skip_permissions_expires_at < ?
			AND status IN ('running', 'waiting_input', 'starting')
		ORDER BY dangerously_skip_permissions_expires_at ASC
	`

	rows, err := s.db.QueryContext(ctx, query, now)
	if err != nil {
		return nil, fmt.Errorf("failed to query expired dangerous skip permissions sessions: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sessions []*Session
	for rows.Next() {
		var session Session
		var claudeSessionID, parentSessionID, summary, title, model, modelID, workingDir, systemPrompt, appendSystemPrompt, customInstructions sql.NullString
		var permissionPromptTool, allowedTools, disallowedTools sql.NullString
		var completedAt sql.NullTime
		var costUSD sql.NullFloat64
		var inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, effectiveContextTokens sql.NullInt64
		var durationMS, numTurns sql.NullInt64
		var resultContent, errorMessage sql.NullString
		var archived sql.NullBool
		var dangerouslySkipPermissionsExpiresAt sql.NullTime
		var proxyEnabled sql.NullBool
		var proxyBaseURL, proxyModelOverride, proxyAPIKey sql.NullString

		err := rows.Scan(
			&session.ID, &session.RunID, &claudeSessionID, &parentSessionID,
			&session.Query, &summary, &title, &model, &modelID, &workingDir, &session.MaxTurns,
			&systemPrompt, &appendSystemPrompt, &customInstructions,
			&permissionPromptTool, &allowedTools, &disallowedTools,
			&session.Status, &session.CreatedAt, &session.LastActivityAt, &completedAt,
			&costUSD, &inputTokens, &outputTokens, &cacheCreationInputTokens, &cacheReadInputTokens, &effectiveContextTokens,
			&durationMS, &numTurns, &resultContent, &errorMessage, &session.AutoAcceptEdits,
			&archived, &session.DangerouslySkipPermissions, &dangerouslySkipPermissionsExpiresAt,
			&proxyEnabled, &proxyBaseURL, &proxyModelOverride, &proxyAPIKey,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}

		// Handle nullable fields
		session.ClaudeSessionID = claudeSessionID.String
		session.ParentSessionID = parentSessionID.String
		session.Summary = summary.String
		session.Title = title.String
		session.Model = model.String
		session.ModelID = modelID.String
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
		if inputTokens.Valid {
			tokens := int(inputTokens.Int64)
			session.InputTokens = &tokens
		}
		if outputTokens.Valid {
			tokens := int(outputTokens.Int64)
			session.OutputTokens = &tokens
		}
		if cacheCreationInputTokens.Valid {
			tokens := int(cacheCreationInputTokens.Int64)
			session.CacheCreationInputTokens = &tokens
		}
		if cacheReadInputTokens.Valid {
			tokens := int(cacheReadInputTokens.Int64)
			session.CacheReadInputTokens = &tokens
		}
		if effectiveContextTokens.Valid {
			tokens := int(effectiveContextTokens.Int64)
			session.EffectiveContextTokens = &tokens
		}
		if durationMS.Valid {
			duration := int(durationMS.Int64)
			session.DurationMS = &duration
		}
		if numTurns.Valid {
			turns := int(numTurns.Int64)
			session.NumTurns = &turns
		}
		session.ResultContent = resultContent.String
		session.ErrorMessage = errorMessage.String

		// Handle archived field - default to false if NULL
		session.Archived = archived.Valid && archived.Bool

		// Handle dangerously skip permissions expires at
		if dangerouslySkipPermissionsExpiresAt.Valid {
			session.DangerouslySkipPermissionsExpiresAt = &dangerouslySkipPermissionsExpiresAt.Time
		}

		// Handle proxy fields
		session.ProxyEnabled = proxyEnabled.Valid && proxyEnabled.Bool
		session.ProxyBaseURL = proxyBaseURL.String
		session.ProxyModelOverride = proxyModelOverride.String
		session.ProxyAPIKey = proxyAPIKey.String

		sessions = append(sessions, &session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return sessions, nil
}

// GetRecentWorkingDirs retrieves recently used working directories
func (s *SQLiteStore) GetRecentWorkingDirs(ctx context.Context, limit int) ([]RecentPath, error) {
	if limit <= 0 {
		limit = 20 // Default to 20 recent paths
	}

	query := `
		SELECT
			working_dir as path,
			datetime(MAX(last_activity_at)) as last_used,
			COUNT(*) as usage_count
		FROM sessions
		WHERE working_dir IS NOT NULL
			AND working_dir != ''
			AND working_dir != '.'
		GROUP BY working_dir
		ORDER BY MAX(last_activity_at) DESC
		LIMIT ?
	`

	rows, err := s.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("query recent paths: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var paths []RecentPath
	for rows.Next() {
		var p RecentPath
		var lastUsedStr string
		if err := rows.Scan(&p.Path, &lastUsedStr, &p.UsageCount); err != nil {
			return nil, fmt.Errorf("scan recent path: %w", err)
		}
		// Parse the datetime string from SQLite
		if t, err := time.Parse("2006-01-02 15:04:05", lastUsedStr); err == nil {
			p.LastUsed = t
		}
		paths = append(paths, p)
	}

	return paths, rows.Err()
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
			tool_id, tool_name, tool_input_json, parent_tool_use_id,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	result, err := tx.ExecContext(ctx, query,
		event.SessionID, event.ClaudeSessionID, event.Sequence, event.EventType,
		event.Role, event.Content,
		event.ToolID, event.ToolName, event.ToolInputJSON, event.ParentToolUseID,
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
			tool_id, tool_name, tool_input_json, parent_tool_use_id,
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
			&event.ToolID, &event.ToolName, &event.ToolInputJSON, &event.ParentToolUseID,
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
	isFirstSession := true

	for currentID != "" {
		var claudeSessionID sql.NullString
		var parentID sql.NullString

		err := s.db.QueryRowContext(ctx,
			"SELECT claude_session_id, parent_session_id FROM sessions WHERE id = ?",
			currentID,
		).Scan(&claudeSessionID, &parentID)
		if err != nil {
			if err == sql.ErrNoRows {
				// If the requested session doesn't exist, return error
				if isFirstSession {
					return nil, fmt.Errorf("session not found: %s", sessionID)
				}
				// Otherwise, parent not found, just stop walking
				break
			}
			return nil, fmt.Errorf("failed to get session: %w", err)
		}
		isFirstSession = false

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
			tool_id, tool_name, tool_input_json, parent_tool_use_id,
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
			&event.ToolID, &event.ToolName, &event.ToolInputJSON, &event.ParentToolUseID,
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

// GetToolCallByID retrieves a specific tool call by its ID
func (s *SQLiteStore) GetToolCallByID(ctx context.Context, toolID string) (*ConversationEvent, error) {
	query := `
		SELECT id, session_id, claude_session_id, sequence, event_type, created_at,
			role, content,
			tool_id, tool_name, tool_input_json, parent_tool_use_id,
			tool_result_for_id, tool_result_content,
			is_completed, approval_status, approval_id
		FROM conversation_events
		WHERE tool_id = ?
		  AND event_type = 'tool_call'
		LIMIT 1
	`

	event := &ConversationEvent{}
	err := s.db.QueryRowContext(ctx, query, toolID).Scan(
		&event.ID, &event.SessionID, &event.ClaudeSessionID,
		&event.Sequence, &event.EventType, &event.CreatedAt,
		&event.Role, &event.Content,
		&event.ToolID, &event.ToolName, &event.ToolInputJSON, &event.ParentToolUseID,
		&event.ToolResultForID, &event.ToolResultContent,
		&event.IsCompleted, &event.ApprovalStatus, &event.ApprovalID,
	)
	if err == sql.ErrNoRows {
		return nil, nil // Tool call not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get tool call by ID: %w", err)
	}

	return event, nil
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
	// Special handling for resolved status - don't overwrite approved/denied
	if status == ApprovalStatusResolved {
		query := `
			UPDATE conversation_events
			SET approval_status = ?
			WHERE approval_id = ? AND approval_status = ?
		`
		_, err := s.db.ExecContext(ctx, query, status, approvalID, ApprovalStatusPending)
		if err != nil {
			return fmt.Errorf("failed to update approval status: %w", err)
		}
		return nil
	}

	// For approved/denied, always update
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
		ORDER BY id
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

// CreateApproval creates a new approval
func (s *SQLiteStore) CreateApproval(ctx context.Context, approval *Approval) error {
	// Validate status
	if !approval.Status.IsValid() {
		return fmt.Errorf("invalid approval status: %s", approval.Status)
	}

	query := `
		INSERT INTO approvals (
			id, run_id, session_id, status, created_at,
			tool_name, tool_input
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`

	_, err := s.db.ExecContext(ctx, query,
		approval.ID, approval.RunID, approval.SessionID, approval.Status.String(), approval.CreatedAt,
		approval.ToolName, string(approval.ToolInput),
	)
	if err != nil {
		return fmt.Errorf("failed to create approval: %w", err)
	}
	return nil
}

// GetApproval retrieves an approval by ID
func (s *SQLiteStore) GetApproval(ctx context.Context, id string) (*Approval, error) {
	query := `
		SELECT id, run_id, session_id, status, created_at, responded_at,
			tool_name, tool_input, comment
		FROM approvals WHERE id = ?
	`

	var approval Approval
	var respondedAt sql.NullTime
	var comment sql.NullString
	var statusStr string
	var toolInputStr string

	err := s.db.QueryRowContext(ctx, query, id).Scan(
		&approval.ID, &approval.RunID, &approval.SessionID, &statusStr,
		&approval.CreatedAt, &respondedAt,
		&approval.ToolName, &toolInputStr, &comment,
	)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Type: "approval", ID: id}
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get approval: %w", err)
	}

	// Convert status string to ApprovalStatus
	approval.Status = ApprovalStatus(statusStr)
	if !approval.Status.IsValid() {
		return nil, fmt.Errorf("invalid approval status in database: %s", statusStr)
	}

	// Handle nullable fields
	if respondedAt.Valid {
		approval.RespondedAt = &respondedAt.Time
	}
	approval.Comment = comment.String
	approval.ToolInput = json.RawMessage(toolInputStr)

	return &approval, nil
}

// GetPendingApprovals retrieves all pending approvals for a session
func (s *SQLiteStore) GetPendingApprovals(ctx context.Context, sessionID string) ([]*Approval, error) {
	query := `
		SELECT id, run_id, session_id, status, created_at, responded_at,
			tool_name, tool_input, comment
		FROM approvals
		WHERE session_id = ? AND status = ?
		ORDER BY created_at ASC
	`

	rows, err := s.db.QueryContext(ctx, query, sessionID, ApprovalStatusLocalPending.String())
	if err != nil {
		return nil, fmt.Errorf("failed to get pending approvals: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var approvals []*Approval
	for rows.Next() {
		var approval Approval
		var respondedAt sql.NullTime
		var comment sql.NullString
		var statusStr string
		var toolInputStr string

		err := rows.Scan(
			&approval.ID, &approval.RunID, &approval.SessionID, &statusStr,
			&approval.CreatedAt, &respondedAt,
			&approval.ToolName, &toolInputStr, &comment,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan approval: %w", err)
		}

		// Convert status string to ApprovalStatus
		approval.Status = ApprovalStatus(statusStr)
		if !approval.Status.IsValid() {
			return nil, fmt.Errorf("invalid approval status in database: %s", statusStr)
		}

		// Handle nullable fields
		if respondedAt.Valid {
			approval.RespondedAt = &respondedAt.Time
		}
		approval.Comment = comment.String
		approval.ToolInput = json.RawMessage(toolInputStr)

		approvals = append(approvals, &approval)
	}

	return approvals, nil
}

// UpdateApprovalResponse updates the status and comment of an approval
func (s *SQLiteStore) UpdateApprovalResponse(ctx context.Context, id string, status ApprovalStatus, comment string) error {
	// Validate status
	if !status.IsValid() {
		return fmt.Errorf("invalid approval status: %s", status)
	}

	// Check current status first
	approval, err := s.GetApproval(ctx, id)
	if err != nil {
		return err // This already returns proper error types
	}

	// Check if already decided
	if approval.Status != ApprovalStatusLocalPending {
		return &AlreadyDecidedError{ID: id, Status: approval.Status.String()}
	}

	query := `
		UPDATE approvals
		SET status = ?, comment = ?, responded_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = ?
	`

	result, err := s.db.ExecContext(ctx, query, status.String(), comment, id, ApprovalStatusLocalPending.String())
	if err != nil {
		return fmt.Errorf("failed to update approval response: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		// This shouldn't happen since we checked above, but just in case
		return &NotFoundError{Type: "approval", ID: id}
	}

	return nil
}

// Helper function to convert MCP config to store format
func MCPServersFromConfig(sessionID string, config map[string]claudecode.MCPServer) ([]MCPServer, error) {
	// First, collect all server names and sort them for deterministic ordering
	names := make([]string, 0, len(config))
	for name := range config {
		names = append(names, name)
	}
	// Sort names to ensure consistent ordering
	sort.Strings(names)

	servers := make([]MCPServer, 0, len(config))
	for _, name := range names {
		server := config[name]
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

// CreateFileSnapshot stores a new file snapshot
func (s *SQLiteStore) CreateFileSnapshot(ctx context.Context, snapshot *FileSnapshot) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO file_snapshots (
			tool_id, session_id, file_path, content
		) VALUES (?, ?, ?, ?)
	`, snapshot.ToolID, snapshot.SessionID, snapshot.FilePath, snapshot.Content)
	return err
}

// GetFileSnapshots retrieves all snapshots for a session
func (s *SQLiteStore) GetFileSnapshots(ctx context.Context, sessionID string) ([]FileSnapshot, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, tool_id, session_id, file_path, content, created_at
		FROM file_snapshots
		WHERE session_id = ?
		ORDER BY created_at DESC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var snapshots []FileSnapshot
	for rows.Next() {
		var s FileSnapshot
		if err := rows.Scan(&s.ID, &s.ToolID, &s.SessionID, &s.FilePath,
			&s.Content, &s.CreatedAt); err != nil {
			return nil, err
		}
		snapshots = append(snapshots, s)
	}
	return snapshots, rows.Err()
}

// GetSessionCount returns the total number of sessions
func (s *SQLiteStore) GetSessionCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sessions").Scan(&count)
	return count, err
}

// GetApprovalCount returns the total number of approvals
func (s *SQLiteStore) GetApprovalCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM approvals").Scan(&count)
	return count, err
}

// GetEventCount returns the total number of conversation events
func (s *SQLiteStore) GetEventCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM conversation_events").Scan(&count)
	return count, err
}
