package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/humanlayer/humanlayer/hld/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApprovalErrors(t *testing.T) {
	// Create temp database
	dbPath := testutil.DatabasePath(t, "sqlite-approval-errors")
	store, err := NewSQLiteStore(dbPath)
	require.NoError(t, err)
	defer func() { _ = store.Close() }()

	ctx := context.Background()

	// Create a session first
	session := &Session{
		ID:              "test-session",
		RunID:           "test-run",
		ClaudeSessionID: "claude-session",
		Query:           "Test query",
		Model:           "sonnet",
		Status:          SessionStatusRunning,
		CreatedAt:       time.Now(),
		LastActivityAt:  time.Now(),
	}
	err = store.CreateSession(ctx, session)
	require.NoError(t, err)

	t.Run("GetApproval_NotFound", func(t *testing.T) {
		approval, err := store.GetApproval(ctx, "non-existent-approval")
		assert.Nil(t, approval)
		assert.Error(t, err)

		// Check that the error is of the correct type
		var notFoundErr *NotFoundError
		assert.True(t, errors.As(err, &notFoundErr))
		assert.Equal(t, "approval", notFoundErr.Type)
		assert.Equal(t, "non-existent-approval", notFoundErr.ID)

		// Check that it unwraps to ErrNotFound
		assert.True(t, errors.Is(err, ErrNotFound))
	})

	t.Run("UpdateApprovalResponse_AlreadyDecided", func(t *testing.T) {
		// Create an approval
		approval := &Approval{
			ID:        "test-approval-1",
			RunID:     session.RunID,
			SessionID: session.ID,
			Status:    ApprovalStatusLocalPending,
			CreatedAt: time.Now(),
			ToolName:  "bash",
			ToolInput: json.RawMessage(`{"command": "ls -la"}`),
		}
		err = store.CreateApproval(ctx, approval)
		require.NoError(t, err)

		// Approve it first
		err = store.UpdateApprovalResponse(ctx, approval.ID, ApprovalStatusLocalApproved, "Looks safe")
		require.NoError(t, err)

		// Try to approve it again - should fail with AlreadyDecidedError
		err = store.UpdateApprovalResponse(ctx, approval.ID, ApprovalStatusLocalApproved, "Approving again")
		assert.Error(t, err)

		// Check that the error is of the correct type
		var alreadyDecidedErr *AlreadyDecidedError
		assert.True(t, errors.As(err, &alreadyDecidedErr))
		assert.Equal(t, approval.ID, alreadyDecidedErr.ID)
		assert.Equal(t, ApprovalStatusLocalApproved.String(), alreadyDecidedErr.Status)

		// Check that it unwraps to ErrAlreadyDecided
		assert.True(t, errors.Is(err, ErrAlreadyDecided))

		// Try to deny it - should also fail
		err = store.UpdateApprovalResponse(ctx, approval.ID, ApprovalStatusLocalDenied, "Actually, deny it")
		assert.Error(t, err)
		assert.True(t, errors.Is(err, ErrAlreadyDecided))
	})

	t.Run("UpdateApprovalResponse_NotFound", func(t *testing.T) {
		err := store.UpdateApprovalResponse(ctx, "non-existent", ApprovalStatusLocalApproved, "")
		assert.Error(t, err)

		// Should get NotFoundError from GetApproval call
		assert.True(t, errors.Is(err, ErrNotFound))
	})

	t.Run("UpdateApprovalResponse_DeniedApproval", func(t *testing.T) {
		// Create another approval
		approval := &Approval{
			ID:        "test-approval-2",
			RunID:     session.RunID,
			SessionID: session.ID,
			Status:    ApprovalStatusLocalPending,
			CreatedAt: time.Now(),
			ToolName:  "write_file",
			ToolInput: json.RawMessage(`{"path": "/tmp/test.txt", "content": "Hello"}`),
		}
		err = store.CreateApproval(ctx, approval)
		require.NoError(t, err)

		// Deny it
		err = store.UpdateApprovalResponse(ctx, approval.ID, ApprovalStatusLocalDenied, "Not allowed")
		require.NoError(t, err)

		// Try to approve it now - should fail
		err = store.UpdateApprovalResponse(ctx, approval.ID, ApprovalStatusLocalApproved, "Changed my mind")
		assert.Error(t, err)

		var alreadyDecidedErr *AlreadyDecidedError
		assert.True(t, errors.As(err, &alreadyDecidedErr))
		assert.Equal(t, ApprovalStatusLocalDenied.String(), alreadyDecidedErr.Status)
	})
}
