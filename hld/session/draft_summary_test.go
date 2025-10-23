package session

import (
	"context"
	"testing"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestLaunchDraftSession_SummaryShouldBeUpdated(t *testing.T) {
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

	// Create a draft session with an initial query
	initialQuery := "This is the initial draft query that will be replaced when we launch"
	initialSummary := CalculateSummary(initialQuery)

	draftSession := &store.Session{
		ID:      "draft-summary-test",
		RunID:   "run-draft-summary-test",
		Status:  store.SessionStatusDraft,
		Query:   initialQuery,
		Summary: initialSummary,
		Model:   "claude-3-5-sonnet-20241022",
	}

	if err := sqliteStore.CreateSession(ctx, draftSession); err != nil {
		t.Fatalf("Failed to create draft session: %v", err)
	}

	// Verify initial summary
	session, err := sqliteStore.GetSession(ctx, draftSession.ID)
	if err != nil {
		t.Fatalf("Failed to get session: %v", err)
	}
	if session.Summary != initialSummary {
		t.Errorf("expected initial summary %q, got %q", initialSummary, session.Summary)
	}

	// Launch the draft with a completely different prompt
	newPrompt := "Write a Python script to parse JSON files"
	expectedNewSummary := CalculateSummary(newPrompt)

	// LaunchDraftSession will fail because Claude binary doesn't exist in test env,
	// but the database update happens before that, so we can still verify the behavior
	_ = manager.LaunchDraftSession(ctx, draftSession.ID, newPrompt, false)

	// Verify the query was updated
	session, err = sqliteStore.GetSession(ctx, draftSession.ID)
	if err != nil {
		t.Fatalf("Failed to get session after launch: %v", err)
	}

	if session.Query != newPrompt {
		t.Errorf("expected query to be updated to %q, got %q", newPrompt, session.Query)
	}

	// Verify the summary was updated to match the new query
	// This test will FAIL until we fix the implementation
	if session.Summary != expectedNewSummary {
		t.Errorf("expected summary to be updated to %q, got %q (old summary was %q)",
			expectedNewSummary, session.Summary, initialSummary)
	}
}
