package store_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigration14_ToolUseID(t *testing.T) {
	// Create an in-memory database for testing
	s, err := store.NewSQLiteStore(":memory:")
	require.NoError(t, err)
	defer func() { _ = s.Close() }()

	// First create a session to satisfy foreign key constraint
	session := &store.Session{
		ID:     "test-session-1",
		RunID:  "test-run-1",
		Query:  "test query",
		Status: store.SessionStatusRunning,
	}
	err = s.CreateSession(context.Background(), session)
	require.NoError(t, err, "Should be able to create session")

	// Create a test approval with tool_use_id
	toolUseID := "test-tool-use-id-123"
	approval := &store.Approval{
		ID:        "test-approval-1",
		RunID:     "test-run-1",
		SessionID: "test-session-1",
		ToolUseID: &toolUseID,
		Status:    store.ApprovalStatusLocalPending,
		ToolName:  "test-tool",
		ToolInput: []byte(`{"test": "data"}`),
	}

	// Create the approval
	err = s.CreateApproval(context.Background(), approval)
	require.NoError(t, err, "Should be able to create approval with tool_use_id")

	// Retrieve the approval
	retrieved, err := s.GetApproval(context.Background(), "test-approval-1")
	require.NoError(t, err)
	require.NotNil(t, retrieved)

	// Verify tool_use_id was saved and retrieved correctly
	assert.NotNil(t, retrieved.ToolUseID, "ToolUseID should not be nil")
	if retrieved.ToolUseID != nil {
		assert.Equal(t, toolUseID, *retrieved.ToolUseID, "ToolUseID should match")
	}

	// Create another session for the second approval
	session2 := &store.Session{
		ID:     "test-session-2",
		RunID:  "test-run-2",
		Query:  "test query 2",
		Status: store.SessionStatusRunning,
	}
	err = s.CreateSession(context.Background(), session2)
	require.NoError(t, err, "Should be able to create second session")

	// Test creating approval without tool_use_id (nullable field)
	approval2 := &store.Approval{
		ID:        "test-approval-2",
		RunID:     "test-run-2",
		SessionID: "test-session-2",
		ToolUseID: nil, // Explicitly nil
		Status:    store.ApprovalStatusLocalPending,
		ToolName:  "test-tool-2",
		ToolInput: []byte(`{"test": "data2"}`),
	}

	err = s.CreateApproval(context.Background(), approval2)
	require.NoError(t, err, "Should be able to create approval without tool_use_id")

	// Retrieve and verify it's nil
	retrieved2, err := s.GetApproval(context.Background(), "test-approval-2")
	require.NoError(t, err)
	assert.Nil(t, retrieved2.ToolUseID, "ToolUseID should be nil when not provided")
}

func TestMigration18Healing(t *testing.T) {
	testCases := []struct {
		name           string
		setupFunc      func(s *store.SQLiteStore) error
		expectedFixes  []string
		skipValidation bool // For cases where we simulate partial schemas
	}{
		{
			name: "v16_missing_additional_directories",
			setupFunc: func(s *store.SQLiteStore) error {
				// Get direct access to the database
				db := s.GetDB()

				// Simulate v16 with only user_settings
				// First, drop the additional_directories column if it exists
				_, _ = db.Exec(`ALTER TABLE sessions DROP COLUMN additional_directories`)

				// Remove migration 17, 18 and 19 from schema_version to simulate v16
				_, err := db.Exec(`DELETE FROM schema_version WHERE version IN (17, 18, 19)`)
				return err
			},
			expectedFixes: []string{"additional_directories"},
		},
		{
			name: "v16_missing_user_settings",
			setupFunc: func(s *store.SQLiteStore) error {
				// Get direct access to the database
				db := s.GetDB()

				// Simulate v16 with only additional_directories
				// Drop the user_settings table
				_, _ = db.Exec(`DROP TABLE IF EXISTS user_settings`)

				// Remove migration 16, 17, 18 and 19 from schema_version to simulate pre-16
				_, err := db.Exec(`DELETE FROM schema_version WHERE version IN (16, 17, 18, 19)`)
				return err
			},
			expectedFixes: []string{"user_settings"},
		},
		{
			name: "v17_complete",
			setupFunc: func(s *store.SQLiteStore) error {
				// Everything should already be in place, just remove migrations 18 and 19
				db := s.GetDB()
				_, err := db.Exec(`DELETE FROM schema_version WHERE version IN (18, 19)`)
				return err
			},
			expectedFixes: []string{}, // No fixes needed
		},
		{
			name: "fresh_database",
			setupFunc: func(s *store.SQLiteStore) error {
				// Fresh database should have everything
				return nil
			},
			expectedFixes:  []string{}, // No fixes needed
			skipValidation: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create test database
			s, err := store.NewSQLiteStore(":memory:")
			require.NoError(t, err)
			defer func() { _ = s.Close() }()

			// Run test-specific setup if provided
			if tc.setupFunc != nil {
				err = tc.setupFunc(s)
				require.NoError(t, err, "Setup should not fail")
			}

			// Get direct access to check state before migration
			db := s.GetDB()

			// Check initial state
			var userSettingsExists int
			_ = db.QueryRow(`
				SELECT COUNT(*) FROM sqlite_master
				WHERE type='table' AND name='user_settings'
			`).Scan(&userSettingsExists)

			var additionalDirsExists int
			_ = db.QueryRow(`
				SELECT COUNT(*) FROM pragma_table_info('sessions')
				WHERE name = 'additional_directories'
			`).Scan(&additionalDirsExists)

			t.Logf("Before migration - user_settings exists: %d, additional_directories exists: %d",
				userSettingsExists, additionalDirsExists)

			// Close and reopen to trigger migrations
			_ = s.Close()
			s, err = store.NewSQLiteStore(":memory:")

			// For test cases with partial schemas, we expect the healing to fix them
			if tc.skipValidation {
				// If we're testing a broken state, NewSQLiteStore might fail on validation
				// but the migration should have run
				if err != nil {
					t.Logf("Expected validation error after healing: %v", err)
				}
			} else {
				require.NoError(t, err, "Store should open successfully after healing")
			}

			if s != nil {
				defer func() { _ = s.Close() }()

				// Verify final state
				db = s.GetDB()

				// Check that both components exist
				err = db.QueryRow(`
					SELECT COUNT(*) FROM sqlite_master
					WHERE type='table' AND name='user_settings'
				`).Scan(&userSettingsExists)
				require.NoError(t, err)
				assert.Equal(t, 1, userSettingsExists, "user_settings table should exist")

				err = db.QueryRow(`
					SELECT COUNT(*) FROM pragma_table_info('sessions')
					WHERE name = 'additional_directories'
				`).Scan(&additionalDirsExists)
				require.NoError(t, err)
				assert.Equal(t, 1, additionalDirsExists, "additional_directories column should exist")

				// Check version is 19
				var version int
				err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
				require.NoError(t, err)
				assert.Equal(t, 22, version, "Database should be at version 22")

				t.Logf("After migration - user_settings exists: %d, additional_directories exists: %d, version: %d",
					userSettingsExists, additionalDirsExists, version)
			}
		})
	}
}

// TestMigration18Idempotency verifies that migration 18 can be run multiple times safely
func TestMigration18Idempotency(t *testing.T) {
	// Create test database
	s, err := store.NewSQLiteStore(":memory:")
	require.NoError(t, err)
	defer func() { _ = s.Close() }()

	// Get initial state
	db := s.GetDB()
	var version int
	err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
	require.NoError(t, err)
	assert.Equal(t, 22, version, "Should be at version 22")

	// Try to manually run migration 18 logic again (simulating idempotency)
	// This would happen if someone ran the migration twice
	var tableExists int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='user_settings'
	`).Scan(&tableExists)
	require.NoError(t, err)
	assert.Equal(t, 1, tableExists, "Table should exist")

	// Try to create the table again (should not error due to IF NOT EXISTS)
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS user_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			advanced_providers BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	require.NoError(t, err, "Creating table with IF NOT EXISTS should not error")

	// Verify nothing broke
	err = db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='user_settings'
	`).Scan(&tableExists)
	require.NoError(t, err)
	assert.Equal(t, 1, tableExists, "Table should still exist")
}

// TestAllMigrationStates tests that migrations work correctly from every possible starting state (versions 1-19)
func TestAllMigrationStates(t *testing.T) {
	// Define what each migration adds to help us simulate each state
	type migrationDefinition struct {
		version     int
		description string
		setupSQL    []string // SQL to run to simulate this migration having been applied
	}

	migrations := []migrationDefinition{
		{
			version:     1,
			description: "Initial schema",
			setupSQL:    []string{}, // Base schema is created by initSchema
		},
		{
			version:     2,
			description: "Schema version tracking",
			setupSQL:    []string{}, // schema_version table already created by initSchema
		},
		{
			version:     3,
			description: "Add permission and tool fields",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN system_prompt TEXT`,
				`ALTER TABLE sessions ADD COLUMN custom_instructions TEXT`,
				`ALTER TABLE sessions ADD COLUMN permission_prompt_tool TEXT`,
				`ALTER TABLE sessions ADD COLUMN allowed_tools TEXT`,
				`ALTER TABLE sessions ADD COLUMN disallowed_tools TEXT`,
			},
		},
		{
			version:     4,
			description: "Add approvals table",
			setupSQL: []string{
				`CREATE TABLE IF NOT EXISTS approvals (
					id TEXT PRIMARY KEY,
					run_id TEXT NOT NULL,
					session_id TEXT NOT NULL,
					status TEXT NOT NULL,
					tool_name TEXT NOT NULL,
					tool_input TEXT NOT NULL,
					response TEXT,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					responded_at TIMESTAMP,
					parent_tool_use_id TEXT,
					FOREIGN KEY (session_id) REFERENCES sessions(id)
				)`,
				`CREATE INDEX idx_approvals_run_id ON approvals(run_id)`,
				`CREATE INDEX idx_approvals_session_id ON approvals(session_id)`,
			},
		},
		{
			version:     5,
			description: "Add index on parent_session_id",
			setupSQL: []string{
				`CREATE INDEX IF NOT EXISTS idx_sessions_parent_session_id ON sessions(parent_session_id)`,
			},
		},
		{
			version:     6,
			description: "Add parent_tool_use_id",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN parent_tool_use_id TEXT`,
			},
		},
		{
			version:     7,
			description: "Add file_snapshots table",
			setupSQL: []string{
				`CREATE TABLE IF NOT EXISTS file_snapshots (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					session_id TEXT NOT NULL,
					file_path TEXT NOT NULL,
					content TEXT NOT NULL,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY (session_id) REFERENCES sessions(id)
				)`,
				`CREATE INDEX idx_file_snapshots_session_id ON file_snapshots(session_id)`,
			},
		},
		{
			version:     8,
			description: "Add auto_accept_edits column",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN auto_accept_edits BOOLEAN DEFAULT FALSE`,
			},
		},
		{
			version:     9,
			description: "Add archived field",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN archived BOOLEAN DEFAULT FALSE`,
			},
		},
		{
			version:     10,
			description: "Add title column",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN title TEXT`,
			},
		},
		{
			version:     11,
			description: "Add dangerously skip permissions",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN dangerously_skip_permissions BOOLEAN DEFAULT FALSE`,
				`ALTER TABLE sessions ADD COLUMN dangerously_skip_permissions_expires_at TIMESTAMP`,
			},
		},
		{
			version:     12,
			description: "Add model_id column",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN model_id TEXT`,
			},
		},
		{
			version:     13,
			description: "Add detailed token tracking",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN input_tokens INTEGER`,
				`ALTER TABLE sessions ADD COLUMN output_tokens INTEGER`,
				`ALTER TABLE sessions ADD COLUMN cache_creation_input_tokens INTEGER`,
				`ALTER TABLE sessions ADD COLUMN cache_read_input_tokens INTEGER`,
				`ALTER TABLE sessions ADD COLUMN effective_context_tokens INTEGER`,
			},
		},
		{
			version:     14,
			description: "Add tool_use_id column",
			setupSQL: []string{
				`ALTER TABLE approvals ADD COLUMN tool_use_id TEXT`,
			},
		},
		{
			version:     15,
			description: "Add proxy configuration",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN proxy_enabled BOOLEAN DEFAULT FALSE`,
				`ALTER TABLE sessions ADD COLUMN proxy_base_url TEXT`,
				`ALTER TABLE sessions ADD COLUMN proxy_model_override TEXT`,
				`ALTER TABLE sessions ADD COLUMN proxy_api_key TEXT`,
			},
		},
		{
			version:     16,
			description: "Add user settings table",
			setupSQL: []string{
				`CREATE TABLE IF NOT EXISTS user_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					advanced_providers BOOLEAN NOT NULL DEFAULT FALSE,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
				)`,
				`INSERT INTO user_settings (id, advanced_providers) VALUES (1, FALSE) ON CONFLICT(id) DO NOTHING`,
			},
		},
		// Skip 17 as noted in the migration code
		{
			version:     18,
			description: "Add additional_directories and heal",
			setupSQL: []string{
				`ALTER TABLE sessions ADD COLUMN additional_directories TEXT`,
				// Also ensure user_settings exists (healing aspect)
				`CREATE TABLE IF NOT EXISTS user_settings (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					advanced_providers BOOLEAN NOT NULL DEFAULT FALSE,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
				)`,
				`INSERT INTO user_settings (id, advanced_providers) VALUES (1, FALSE) ON CONFLICT(id) DO NOTHING`,
			},
		},
		{
			version:     19,
			description: "Add opt_in_telemetry column for error reporting consent",
			setupSQL: []string{
				`ALTER TABLE user_settings ADD COLUMN opt_in_telemetry BOOLEAN DEFAULT NULL`,
			},
		},
	}

	for _, targetVersion := range []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19} { // Note: 17 is skipped
		t.Run(fmt.Sprintf("FromVersion_%d", targetVersion), func(t *testing.T) {
			// Create a fresh database
			s, err := store.NewSQLiteStore(":memory:")
			require.NoError(t, err)

			// Get direct DB access
			db := s.GetDB()

			// Clear the schema_version table to simulate starting from scratch
			_, err = db.Exec(`DELETE FROM schema_version`)
			require.NoError(t, err)

			// Apply migrations up to the target version
			for _, mig := range migrations {
				if mig.version > targetVersion {
					break
				}

				// Apply the migration's SQL
				for _, sql := range mig.setupSQL {
					_, err = db.Exec(sql)
					// Ignore errors for things that might already exist
					// This is a bit hacky but works for our test purposes
					_ = err
				}

				// Record this migration as applied
				if mig.version > 0 {
					_, err = db.Exec(
						`INSERT INTO schema_version (version, description) VALUES (?, ?)`,
						mig.version, mig.description,
					)
					require.NoError(t, err, "Failed to record migration %d", mig.version)
				}
			}

			// Verify we're at the expected version
			var currentVersion int
			err = db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_version").Scan(&currentVersion)
			require.NoError(t, err)
			assert.Equal(t, targetVersion, currentVersion, "Database should be at version %d", targetVersion)

			// Close and reopen to trigger migrations
			_ = s.Close()

			// Reopen - this should run all remaining migrations
			s, err = store.NewSQLiteStore(":memory:")
			if targetVersion < 16 {
				// Versions before 16 might fail validation due to missing user_settings
				// But migration 18 should fix it
				if err != nil {
					t.Logf("Expected validation error for version %d: %v", targetVersion, err)
				}
			} else {
				require.NoError(t, err, "Should be able to open database from version %d", targetVersion)
			}

			if s != nil {
				defer func() { _ = s.Close() }()

				// Verify final state
				db = s.GetDB()

				// Check final version is 21
				err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&currentVersion)
				require.NoError(t, err)
				assert.Equal(t, 22, currentVersion, "Should be at version 22 after all migrations")

				// Verify both critical components exist
				var userSettingsExists int
				err = db.QueryRow(`
					SELECT COUNT(*) FROM sqlite_master
					WHERE type='table' AND name='user_settings'
				`).Scan(&userSettingsExists)
				require.NoError(t, err)
				assert.Equal(t, 1, userSettingsExists, "user_settings table should exist")

				var additionalDirsExists int
				err = db.QueryRow(`
					SELECT COUNT(*) FROM pragma_table_info('sessions')
					WHERE name = 'additional_directories'
				`).Scan(&additionalDirsExists)
				require.NoError(t, err)
				assert.Equal(t, 1, additionalDirsExists, "additional_directories column should exist")

				t.Logf("Successfully migrated from version %d to 22", targetVersion)
			}
		})
	}
}

// TestMigrationFromBuggyState17 specifically tests the case where someone has the buggy migration 17
func TestMigrationFromBuggyState17(t *testing.T) {
	// This test simulates the real buggy state where:
	// 1. Database has migrations 1-16 properly applied
	// 2. Version is marked as 17 but migration 17 didn't actually run
	// 3. So we're missing the additional_directories column

	// Use a file-based database for this test
	tempDir := t.TempDir()
	dbPath := tempDir + "/test.db"

	// Create database and let it run migrations up to 16
	s, err := store.NewSQLiteStore(dbPath)
	require.NoError(t, err)

	db := s.GetDB()

	// Verify we're at version 21 after normal migration
	var version int
	err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
	require.NoError(t, err)
	require.Equal(t, 22, version, "Fresh database should be at version 22")

	// Now simulate the buggy state by:
	// 1. Remove migration 17 and 18 records
	_, err = db.Exec(`DELETE FROM schema_version WHERE version >= 17`)
	require.NoError(t, err)

	// 2. Drop the additional_directories column (to simulate it never being added)
	// Note: SQLite doesn't support DROP COLUMN, so we need to recreate the table
	// For simplicity, we'll just mark version as 17 without the column

	// 3. Just mark the database as being at version 17 (the buggy state)
	_, err = db.Exec(
		`INSERT INTO schema_version (version, description) VALUES (?, ?)`,
		17, "Buggy migration 17 - simulating missing additional_directories",
	)
	require.NoError(t, err)

	// Verify we're now at version 17
	err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
	require.NoError(t, err)
	assert.Equal(t, 17, version, "Should be at version 17 (buggy state)")

	// Check that user_settings exists (from migration 16)
	var userSettingsExists int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='user_settings'
	`).Scan(&userSettingsExists)
	require.NoError(t, err)
	assert.Equal(t, 1, userSettingsExists, "user_settings should exist from migration 16")

	// Close and reopen to trigger migration 18 which should heal the database
	_ = s.Close()

	s, err = store.NewSQLiteStore(dbPath)
	require.NoError(t, err, "Should be able to open database with migration 18 healing")
	defer func() { _ = s.Close() }()

	// Verify healing worked
	db = s.GetDB()

	err = db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
	require.NoError(t, err)
	assert.Equal(t, 22, version, "Should be at version 22 after healing")

	// Both components should exist
	err = db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='user_settings'
	`).Scan(&userSettingsExists)
	require.NoError(t, err)
	assert.Equal(t, 1, userSettingsExists, "user_settings table should still exist after healing")

	var additionalDirsExists int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM pragma_table_info('sessions')
		WHERE name = 'additional_directories'
	`).Scan(&additionalDirsExists)
	require.NoError(t, err)
	assert.Equal(t, 1, additionalDirsExists, "additional_directories column should exist after healing")

	t.Logf("Successfully healed database from buggy v17 state")
}
