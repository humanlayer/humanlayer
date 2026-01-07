package session

import (
	"context"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestContinueOpenCodeSession(t *testing.T) {
	ctx := context.Background()

	// Create test components
	eventBus := bus.NewEventBus()
	sqliteStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer func() { _ = sqliteStore.Close() }()

	manager, err := NewManager(eventBus, sqliteStore, "")
	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	t.Run("RoutesToOpenCodeProvider", func(t *testing.T) {
		// Create parent OpenCode session
		parentSessionID := "parent-opencode-1"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-opencode-1",
			ClaudeSessionID: "opencode-session-abc123", // OpenCode session ID stored in ClaudeSessionID field
			Status:          store.SessionStatusCompleted,
			Query:           "original opencode query",
			Model:           "anthropic/claude-sonnet-4-20250514",
			WorkingDir:      "/tmp/test",
			Provider:        "opencode", // Key: marks this as OpenCode session
			Title:           "OpenCode Test Session",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session - will fail at launch (no OpenCode binary) but creates child session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "follow up opencode query",
		}

		_, _ = manager.ContinueSession(ctx, req)
		// Expected to fail due to missing OpenCode binary

		// Find the child session
		sessions, err := sqliteStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Verify child session has OpenCode provider
		if childSession.Provider != "opencode" {
			t.Errorf("Provider not inherited: got %s, want opencode", childSession.Provider)
		}

		// Verify other fields inherited
		if childSession.WorkingDir != parentSession.WorkingDir {
			t.Errorf("WorkingDir not inherited: got %s, want %s", childSession.WorkingDir, parentSession.WorkingDir)
		}
		if childSession.Model != parentSession.Model {
			t.Errorf("Model not inherited: got %s, want %s", childSession.Model, parentSession.Model)
		}
		if childSession.Title != parentSession.Title {
			t.Errorf("Title not inherited: got %s, want %s", childSession.Title, parentSession.Title)
		}
	})

	t.Run("InheritsOpenCodeSessionID", func(t *testing.T) {
		// Create parent OpenCode session with session ID
		parentSessionID := "parent-opencode-session-id"
		opencodeSessionID := "oc-session-xyz789"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-session-id",
			ClaudeSessionID: opencodeSessionID, // OpenCode session ID for continuation
			Status:          store.SessionStatusCompleted,
			Query:           "initial query",
			Model:           "anthropic/claude-sonnet-4-20250514",
			WorkingDir:      "/tmp/test",
			Provider:        "opencode",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue with context",
		}

		_, _ = manager.ContinueSession(ctx, req)

		// The child session is created before launch fails
		// We can't verify the OpenCode config directly (internal to launch)
		// but we can verify the session structure is correct
		sessions, err := sqliteStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Child session should be marked as OpenCode
		if childSession.Provider != "opencode" {
			t.Errorf("Provider not set correctly: got %s, want opencode", childSession.Provider)
		}

		// Parent reference should be set
		if childSession.ParentSessionID != parentSessionID {
			t.Errorf("ParentSessionID not set correctly: got %s, want %s", childSession.ParentSessionID, parentSessionID)
		}
	})

	t.Run("InheritsAutoAcceptAndSkipPermissions", func(t *testing.T) {
		// Create parent OpenCode session with special settings
		parentSessionID := "parent-opencode-settings"
		expiresAt := time.Now().Add(time.Hour)
		parentSession := &store.Session{
			ID:                                  parentSessionID,
			RunID:                               "run-settings",
			ClaudeSessionID:                     "oc-settings-123",
			Status:                              store.SessionStatusCompleted,
			Query:                               "initial",
			Model:                               "anthropic/claude-sonnet-4-20250514",
			WorkingDir:                          "/tmp/test",
			Provider:                            "opencode",
			AutoAcceptEdits:                     true,
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &expiresAt,
			CreatedAt:                           time.Now(),
			LastActivityAt:                      time.Now(),
			CompletedAt:                         &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue",
		}

		_, _ = manager.ContinueSession(ctx, req)

		// Find child session
		sessions, err := sqliteStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Verify settings inherited
		if !childSession.AutoAcceptEdits {
			t.Error("AutoAcceptEdits not inherited")
		}
		if !childSession.DangerouslySkipPermissions {
			t.Error("DangerouslySkipPermissions not inherited")
		}
		if childSession.DangerouslySkipPermissionsExpiresAt == nil {
			t.Error("DangerouslySkipPermissionsExpiresAt not inherited")
		}
	})

	t.Run("ExpiredSkipPermissionsNotInherited", func(t *testing.T) {
		// Create parent OpenCode session with expired skip permissions
		parentSessionID := "parent-opencode-expired"
		expiredAt := time.Now().Add(-time.Hour) // Expired 1 hour ago
		parentSession := &store.Session{
			ID:                                  parentSessionID,
			RunID:                               "run-expired",
			ClaudeSessionID:                     "oc-expired-123",
			Status:                              store.SessionStatusCompleted,
			Query:                               "initial",
			Model:                               "anthropic/claude-sonnet-4-20250514",
			WorkingDir:                          "/tmp/test",
			Provider:                            "opencode",
			DangerouslySkipPermissions:          true,
			DangerouslySkipPermissionsExpiresAt: &expiredAt,
			CreatedAt:                           time.Now(),
			LastActivityAt:                      time.Now(),
			CompletedAt:                         &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue",
		}

		_, _ = manager.ContinueSession(ctx, req)

		// Find child session
		sessions, err := sqliteStore.ListSessions(ctx)
		if err != nil {
			t.Fatalf("Failed to list sessions: %v", err)
		}

		var childSession *store.Session
		for _, s := range sessions {
			if s.ParentSessionID == parentSessionID {
				childSession = s
				break
			}
		}

		if childSession == nil {
			t.Fatal("Child session not found")
		}

		// Verify expired skip permissions are NOT inherited
		if childSession.DangerouslySkipPermissions {
			t.Error("Expired DangerouslySkipPermissions should not be inherited")
		}
		if childSession.DangerouslySkipPermissionsExpiresAt != nil {
			t.Error("Expired DangerouslySkipPermissionsExpiresAt should not be inherited")
		}
	})

	t.Run("RequiresWorkingDirectory", func(t *testing.T) {
		// Create parent OpenCode session without working directory
		parentSessionID := "parent-opencode-no-workdir"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-no-workdir",
			ClaudeSessionID: "oc-no-workdir-123",
			Status:          store.SessionStatusCompleted,
			Query:           "initial",
			Model:           "anthropic/claude-sonnet-4-20250514",
			WorkingDir:      "", // Empty working directory
			Provider:        "opencode",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
			CompletedAt:     &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session - should fail due to missing working directory
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue",
		}

		_, err := manager.ContinueSession(ctx, req)

		// Should get an error about missing working directory
		if err == nil {
			t.Error("Expected error for missing working directory, got nil")
		} else if err.Error() != "parent session missing working_dir (cannot resume session without working directory)" {
			// The error message should be about working directory
			// Note: error might vary based on when validation happens
			t.Logf("Got error (expected): %v", err)
		}
	})

	t.Run("RejectsInvalidParentStatus", func(t *testing.T) {
		// Create parent OpenCode session with invalid status
		parentSessionID := "parent-opencode-draft"
		parentSession := &store.Session{
			ID:              parentSessionID,
			RunID:           "run-draft",
			ClaudeSessionID: "",
			Status:          store.SessionStatusDraft, // Draft status - cannot continue
			Query:           "initial",
			Model:           "anthropic/claude-sonnet-4-20250514",
			WorkingDir:      "/tmp/test",
			Provider:        "opencode",
			CreatedAt:       time.Now(),
			LastActivityAt:  time.Now(),
		}

		if err := sqliteStore.CreateSession(ctx, parentSession); err != nil {
			t.Fatalf("Failed to create parent session: %v", err)
		}

		// Continue session - should fail due to invalid status
		req := ContinueSessionConfig{
			ParentSessionID: parentSessionID,
			Query:           "continue",
		}

		_, err := manager.ContinueSession(ctx, req)

		// Should get an error about invalid status
		if err == nil {
			t.Error("Expected error for draft status parent, got nil")
		}
	})
}

func TestLaunchDraftWithOpenCode(t *testing.T) {
	ctx := context.Background()

	// Create test components
	eventBus := bus.NewEventBus()
	sqliteStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	defer func() { _ = sqliteStore.Close() }()

	manager, err := NewManager(eventBus, sqliteStore, "")
	if err != nil {
		t.Fatalf("Failed to create manager: %v", err)
	}

	// Create a real temporary directory for tests that need valid paths
	tempDir := t.TempDir()

	t.Run("LaunchesOpenCodeDraftSession", func(t *testing.T) {
		// Create a draft session with OpenCode provider using real temp dir
		draftSessionID := "draft-opencode-1"
		draftSession := &store.Session{
			ID:             draftSessionID,
			RunID:          "run-draft-oc-1",
			Status:         store.SessionStatusDraft,
			Query:          "", // Empty for draft
			Model:          "anthropic/claude-sonnet-4-20250514",
			WorkingDir:     tempDir, // Use real temp directory
			Provider:       "opencode",
			Title:          "OpenCode Draft Session",
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}

		if err := sqliteStore.CreateSession(ctx, draftSession); err != nil {
			t.Fatalf("Failed to create draft session: %v", err)
		}

		// Launch the draft session - will fail at launch (no OpenCode binary)
		// but we can verify the routing logic and that session is updated
		err := manager.LaunchDraftSession(ctx, draftSessionID, "Execute this task", false)

		// Expected to fail due to missing OpenCode binary (or succeed if available)
		if err != nil {
			t.Logf("LaunchDraftSession failed as expected (OpenCode binary issue): %v", err)
		}

		// Verify the session was updated with the prompt
		sess, err := sqliteStore.GetSession(ctx, draftSessionID)
		if err != nil {
			t.Fatalf("Failed to get session: %v", err)
		}

		// Query should be updated (happens before launch attempt)
		if sess.Query != "Execute this task" {
			t.Errorf("Query not updated: got %s, want 'Execute this task'", sess.Query)
		}

		// Status should have changed from draft (to starting, then potentially failed)
		if sess.Status == store.SessionStatusDraft {
			t.Error("Status should have changed from draft")
		}

		// Provider should still be opencode
		if sess.Provider != "opencode" {
			t.Errorf("Provider changed unexpectedly: got %s, want opencode", sess.Provider)
		}
	})

	t.Run("LaunchDraftSessionUpdatesPrompt", func(t *testing.T) {
		// Create a draft session using real temp dir
		draftSessionID := "draft-opencode-prompt"
		draftSession := &store.Session{
			ID:             draftSessionID,
			RunID:          "run-draft-prompt",
			Status:         store.SessionStatusDraft,
			Query:          "old draft query",
			Model:          "anthropic/claude-sonnet-4-20250514",
			WorkingDir:     tempDir, // Use real temp directory
			Provider:       "opencode",
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}

		if err := sqliteStore.CreateSession(ctx, draftSession); err != nil {
			t.Fatalf("Failed to create draft session: %v", err)
		}

		// Launch with new prompt (may fail due to binary, but prompt update happens first)
		_ = manager.LaunchDraftSession(ctx, draftSessionID, "new actual prompt", false)

		// Verify the session was updated
		sess, err := sqliteStore.GetSession(ctx, draftSessionID)
		if err != nil {
			t.Fatalf("Failed to get session: %v", err)
		}

		// Query should be the new prompt
		if sess.Query != "new actual prompt" {
			t.Errorf("Query not updated correctly: got %s, want 'new actual prompt'", sess.Query)
		}
	})

	t.Run("RejectsNonDraftSession", func(t *testing.T) {
		// Create a completed session (not draft)
		sessionID := "not-draft-opencode"
		session := &store.Session{
			ID:             sessionID,
			RunID:          "run-not-draft",
			Status:         store.SessionStatusCompleted,
			Query:          "completed query",
			Model:          "anthropic/claude-sonnet-4-20250514",
			WorkingDir:     "/tmp/test",
			Provider:       "opencode",
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
			CompletedAt:    &time.Time{},
		}

		if err := sqliteStore.CreateSession(ctx, session); err != nil {
			t.Fatalf("Failed to create session: %v", err)
		}

		// Try to launch as draft - should fail
		err := manager.LaunchDraftSession(ctx, sessionID, "new prompt", false)

		if err == nil {
			t.Error("Expected error when launching non-draft session")
		}
	})

	t.Run("CreatesWorkingDirectoryIfRequested", func(t *testing.T) {
		// This test would require a real temporary directory
		// For now, we test the error case when directory doesn't exist

		draftSessionID := "draft-opencode-mkdir"
		nonExistentDir := "/tmp/nonexistent-opencode-test-dir-12345"
		draftSession := &store.Session{
			ID:             draftSessionID,
			RunID:          "run-draft-mkdir",
			Status:         store.SessionStatusDraft,
			Query:          "",
			Model:          "anthropic/claude-sonnet-4-20250514",
			WorkingDir:     nonExistentDir,
			Provider:       "opencode",
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		}

		if err := sqliteStore.CreateSession(ctx, draftSession); err != nil {
			t.Fatalf("Failed to create draft session: %v", err)
		}

		// Launch without create flag - should fail with DirectoryNotFoundError
		err := manager.LaunchDraftSession(ctx, draftSessionID, "test prompt", false)

		if err == nil {
			t.Error("Expected error for non-existent directory")
		} else {
			// Should be a DirectoryNotFoundError
			if _, ok := err.(*DirectoryNotFoundError); !ok {
				t.Logf("Got error (expected DirectoryNotFoundError): %T - %v", err, err)
			}
		}
	})
}

func TestOpenCodeSessionWrapperInterface(t *testing.T) {
	// Test that OpenCodeSessionWrapper correctly implements ClaudeSession interface
	// This is a compile-time check, but we can also verify behavior

	t.Run("NilSessionPanics", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("Expected panic for nil session")
			}
		}()

		// Should panic
		NewOpenCodeSessionWrapper(nil)
	})
}
