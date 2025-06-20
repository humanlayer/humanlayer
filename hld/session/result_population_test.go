package session

import (
	"context"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/bus"
	"github.com/humanlayer/humanlayer/hld/store"
)

func TestSessionManager_ResultPopulation(t *testing.T) {
	// Create an in-memory store
	testStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}
	defer func() { _ = testStore.Close() }()

	// Create session manager
	eventBus := bus.NewEventBus()
	manager, err := NewManager(eventBus, testStore)
	if err != nil {
		t.Fatalf("Failed to create session manager: %v", err)
	}

	ctx := context.Background()

	// Create a session
	session := &store.Session{
		ID:             "test-session-results",
		RunID:          "test-run-results",
		Query:          "What is 2+2?",
		Status:         store.SessionStatusStarting,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}

	err = testStore.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Update with result data (simulating completion)
	numTurns := 2
	resultContent := "2+2 equals 4"
	costUSD := 0.001
	durationMS := 800

	update := store.SessionUpdate{
		Status:        stringPtr(store.SessionStatusCompleted),
		NumTurns:      &numTurns,
		ResultContent: &resultContent,
		CostUSD:       &costUSD,
		DurationMS:    &durationMS,
	}

	err = testStore.UpdateSession(ctx, session.ID, update)
	if err != nil {
		t.Fatalf("Failed to update session with results: %v", err)
	}

	// Test GetSessionInfo populates Result field correctly
	info, err := manager.GetSessionInfo(session.ID)
	if err != nil {
		t.Fatalf("Failed to get session info: %v", err)
	}

	// Verify Result field is populated
	if info.Result == nil {
		t.Fatal("Expected Result field to be populated, got nil")
	}

	result := info.Result

	// Check all Result fields
	if result.Result != resultContent {
		t.Errorf("Expected Result.Result %q, got %q", resultContent, result.Result)
	}

	if result.NumTurns != numTurns {
		t.Errorf("Expected Result.NumTurns %d, got %d", numTurns, result.NumTurns)
	}

	if result.CostUSD != costUSD {
		t.Errorf("Expected Result.CostUSD %f, got %f", costUSD, result.CostUSD)
	}

	if result.DurationMS != durationMS {
		t.Errorf("Expected Result.DurationMS %d, got %d", durationMS, result.DurationMS)
	}

	if result.Type != "result" {
		t.Errorf("Expected Result.Type 'result', got %q", result.Type)
	}

	if result.Subtype != "session_completed" {
		t.Errorf("Expected Result.Subtype 'session_completed', got %q", result.Subtype)
	}
}

func TestSessionManager_ListSessions_PopulatesResults(t *testing.T) {
	// Create an in-memory store
	testStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}
	defer func() { _ = testStore.Close() }()

	// Create session manager
	eventBus := bus.NewEventBus()
	manager, err := NewManager(eventBus, testStore)
	if err != nil {
		t.Fatalf("Failed to create session manager: %v", err)
	}

	ctx := context.Background()

	// Create sessions
	sessions := []*store.Session{
		{
			ID:             "session-with-results",
			RunID:          "run-with-results",
			Query:          "Completed session",
			Status:         store.SessionStatusStarting,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		},
		{
			ID:             "session-no-results",
			RunID:          "run-no-results",
			Query:          "Running session",
			Status:         store.SessionStatusRunning,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		},
		{
			ID:             "session-partial-results",
			RunID:          "run-partial-results",
			Query:          "Session with partial data",
			Status:         store.SessionStatusStarting,
			CreatedAt:      time.Now(),
			LastActivityAt: time.Now(),
		},
	}

	// Create all sessions in store
	for _, session := range sessions {
		err = testStore.CreateSession(ctx, session)
		if err != nil {
			t.Fatalf("Failed to create session %s: %v", session.ID, err)
		}
	}

	// Update sessions with result data
	// Session with full results
	resultContent := "This is the result"
	numTurns := 3
	costUSD := 0.005
	update1 := store.SessionUpdate{
		Status:        stringPtr(store.SessionStatusCompleted),
		ResultContent: &resultContent,
		NumTurns:      &numTurns,
		CostUSD:       &costUSD,
	}
	err = testStore.UpdateSession(ctx, "session-with-results", update1)
	if err != nil {
		t.Fatalf("Failed to update session-with-results: %v", err)
	}

	// Session with partial results
	partialTurns := 1
	update2 := store.SessionUpdate{
		Status:   stringPtr(store.SessionStatusCompleted),
		NumTurns: &partialTurns,
	}
	err = testStore.UpdateSession(ctx, "session-partial-results", update2)
	if err != nil {
		t.Fatalf("Failed to update session-partial-results: %v", err)
	}

	// Test ListSessions populates Result fields
	infos := manager.ListSessions()

	if len(infos) != 3 {
		t.Fatalf("Expected 3 sessions, got %d", len(infos))
	}

	// Find each session and verify Result population
	sessionMap := make(map[string]Info)
	for _, info := range infos {
		sessionMap[info.ID] = info
	}

	// Session with full results
	if info, ok := sessionMap["session-with-results"]; ok {
		if info.Result == nil {
			t.Error("Expected Result for session-with-results, got nil")
		} else {
			if info.Result.Result != "This is the result" {
				t.Errorf("Expected result text, got %q", info.Result.Result)
			}
			if info.Result.NumTurns != 3 {
				t.Errorf("Expected 3 turns, got %d", info.Result.NumTurns)
			}
		}
	} else {
		t.Error("session-with-results not found in results")
	}

	// Session with no results
	if info, ok := sessionMap["session-no-results"]; ok {
		if info.Result != nil {
			t.Error("Expected nil Result for session-no-results, got non-nil")
		}
	} else {
		t.Error("session-no-results not found in results")
	}

	// Session with partial results
	if info, ok := sessionMap["session-partial-results"]; ok {
		if info.Result == nil {
			t.Error("Expected Result for session-partial-results, got nil")
		} else {
			if info.Result.NumTurns != 1 {
				t.Errorf("Expected 1 turn, got %d", info.Result.NumTurns)
			}
			if info.Result.Result != "" {
				t.Errorf("Expected empty result text, got %q", info.Result.Result)
			}
		}
	} else {
		t.Error("session-partial-results not found in results")
	}
}

func TestSessionManager_ResultWithError(t *testing.T) {
	// Create an in-memory store
	testStore, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("Failed to create test store: %v", err)
	}
	defer func() { _ = testStore.Close() }()

	// Create session manager
	eventBus := bus.NewEventBus()
	manager, err := NewManager(eventBus, testStore)
	if err != nil {
		t.Fatalf("Failed to create session manager: %v", err)
	}

	ctx := context.Background()

	// Create a failed session
	session := &store.Session{
		ID:             "test-session-error",
		RunID:          "test-run-error",
		Query:          "This will fail",
		Status:         store.SessionStatusStarting,
		CreatedAt:      time.Now(),
		LastActivityAt: time.Now(),
	}

	err = testStore.CreateSession(ctx, session)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Update with error (simulating failure)
	durationMS := 500
	update := store.SessionUpdate{
		Status:       stringPtr(store.SessionStatusFailed),
		ErrorMessage: stringPtr("Something went wrong"),
		DurationMS:   &durationMS,
	}

	err = testStore.UpdateSession(ctx, session.ID, update)
	if err != nil {
		t.Fatalf("Failed to create session: %v", err)
	}

	// Test GetSessionInfo handles error correctly
	info, err := manager.GetSessionInfo(session.ID)
	if err != nil {
		t.Fatalf("Failed to get session info: %v", err)
	}

	// Should have Result with error information
	if info.Result == nil {
		t.Fatal("Expected Result field for failed session, got nil")
	}

	if !info.Result.IsError {
		t.Error("Expected IsError to be true for failed session")
	}

	if info.Result.Error != "Something went wrong" {
		t.Errorf("Expected error message, got %q", info.Result.Error)
	}

	if info.Result.DurationMS != 500 {
		t.Errorf("Expected duration 500ms, got %d", info.Result.DurationMS)
	}
}

// Helper functions

func stringPtr(s string) *string {
	return &s
}
