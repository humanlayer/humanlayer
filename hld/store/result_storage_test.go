package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResultStorageAndRetrieval(t *testing.T) {
	// Create temp database
	tmpDir, err := os.MkdirTemp("", "hld-test-result-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session
	session := &Session{
		ID:     "test-session-result",
		RunID:  "test-run-result",
		Query:  "Calculate 2+2",
		Status: SessionStatusStarting,
	}

	err = store.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Simulate session completion with result data
	numTurns := 3
	resultContent := "The calculation 2+2 equals 4. This is a basic arithmetic operation."
	costUSD := 0.0024
	durationMS := 1500

	update := SessionUpdate{
		Status:        stringPtr(SessionStatusCompleted),
		NumTurns:      &numTurns,
		ResultContent: &resultContent,
		CostUSD:       &costUSD,
		DurationMS:    &durationMS,
	}

	err = store.UpdateSession(ctx, session.ID, update)
	if err != nil {
		t.Fatalf("Failed to update session with results: %v", err)
	}

	// Retrieve the session and verify result data is stored
	retrievedSession, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("Failed to retrieve session: %v", err)
	}

	// Verify all result fields are populated
	if retrievedSession.NumTurns == nil || *retrievedSession.NumTurns != numTurns {
		t.Errorf("Expected NumTurns %d, got %v", numTurns, retrievedSession.NumTurns)
	}

	if retrievedSession.ResultContent != resultContent {
		t.Errorf("Expected ResultContent %q, got %q", resultContent, retrievedSession.ResultContent)
	}

	if retrievedSession.CostUSD == nil || *retrievedSession.CostUSD != costUSD {
		t.Errorf("Expected CostUSD %f, got %v", costUSD, retrievedSession.CostUSD)
	}

	if retrievedSession.DurationMS == nil || *retrievedSession.DurationMS != durationMS {
		t.Errorf("Expected DurationMS %d, got %v", durationMS, retrievedSession.DurationMS)
	}
}

func TestEmptyResultHandling(t *testing.T) {
	// Create temp database
	tmpDir, err := os.MkdirTemp("", "hld-test-empty-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session that fails without result data
	session := &Session{
		ID:     "test-session-no-result",
		RunID:  "test-run-no-result",
		Query:  "This will fail",
		Status: SessionStatusStarting,
	}

	err = store.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Update session as failed (no result data)
	update := SessionUpdate{
		Status:       stringPtr(SessionStatusFailed),
		ErrorMessage: stringPtr("Simulated failure"),
	}

	err = store.UpdateSession(ctx, session.ID, update)
	if err != nil {
		t.Fatalf("Failed to update session: %v", err)
	}

	// Retrieve and verify no result data
	retrievedSession, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("Failed to retrieve session: %v", err)
	}

	if retrievedSession.NumTurns != nil {
		t.Errorf("Expected nil NumTurns for failed session, got %v", retrievedSession.NumTurns)
	}

	if retrievedSession.ResultContent != "" {
		t.Errorf("Expected empty ResultContent for failed session, got %q", retrievedSession.ResultContent)
	}

	if retrievedSession.ErrorMessage != "Simulated failure" {
		t.Errorf("Expected error message, got %q", retrievedSession.ErrorMessage)
	}
}

func TestPartialResultData(t *testing.T) {
	// Create temp database
	tmpDir, err := os.MkdirTemp("", "hld-test-partial-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session
	session := &Session{
		ID:     "test-session-partial",
		RunID:  "test-run-partial",
		Query:  "Partial result test",
		Status: SessionStatusStarting,
	}

	err = store.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Update with only some result fields (realistic scenario)
	resultContent := "Some result text"
	numTurns := 1

	update := SessionUpdate{
		Status:        stringPtr(SessionStatusCompleted),
		ResultContent: &resultContent,
		NumTurns:      &numTurns,
		// No cost or duration data
	}

	err = store.UpdateSession(ctx, session.ID, update)
	if err != nil {
		t.Fatalf("Failed to update session: %v", err)
	}

	// Retrieve and verify partial data is handled correctly
	retrievedSession, err := store.GetSession(ctx, session.ID)
	if err != nil {
		t.Fatalf("Failed to retrieve session: %v", err)
	}

	if retrievedSession.ResultContent != resultContent {
		t.Errorf("Expected ResultContent %q, got %q", resultContent, retrievedSession.ResultContent)
	}

	if retrievedSession.NumTurns == nil || *retrievedSession.NumTurns != numTurns {
		t.Errorf("Expected NumTurns %d, got %v", numTurns, retrievedSession.NumTurns)
	}

	// These should be nil/zero since not provided
	if retrievedSession.CostUSD != nil {
		t.Errorf("Expected nil CostUSD, got %v", retrievedSession.CostUSD)
	}

	if retrievedSession.DurationMS != nil {
		t.Errorf("Expected nil DurationMS, got %v", retrievedSession.DurationMS)
	}
}

// Helper function to create string pointer
func stringPtr(s string) *string {
	return &s
}
