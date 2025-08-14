package store_test

import (
	"context"
	"testing"

	"github.com/humanlayer/humanlayer/hld/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigration12_ToolUseID(t *testing.T) {
	// Create an in-memory database for testing
	s, err := store.NewSQLiteStore(":memory:")
	require.NoError(t, err)
	defer s.Close()

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
