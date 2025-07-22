package errors_test

import (
	"errors"
	"strings"
	"testing"

	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
)

func TestSessionError(t *testing.T) {
	// Create a shared error instance for testing
	connErr := errors.New("connection failed")

	tests := []struct {
		name     string
		err      *hlderrors.SessionError
		contains []string
		wrapped  error
	}{
		{
			name: "full context",
			err: &hlderrors.SessionError{
				SessionID: "session-123",
				RunID:     "run-456",
				Operation: "launch",
				State:     "active",
				Err:       connErr,
			},
			contains: []string{
				"session error [launch]",
				"session_id=session-123",
				"run_id=run-456",
				"state=active",
				"connection failed",
			},
			wrapped: connErr,
		},
		{
			name: "minimal context",
			err: &hlderrors.SessionError{
				Operation: "update",
				Err:       hlderrors.ErrSessionNotFound,
			},
			contains: []string{
				"session error [update]",
				"session not found",
			},
			wrapped: hlderrors.ErrSessionNotFound,
		},
		{
			name: "no wrapped error",
			err: &hlderrors.SessionError{
				SessionID: "session-789",
				Operation: "status",
			},
			contains: []string{
				"session error [status]",
				"session_id=session-789",
			},
			wrapped: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errStr := tt.err.Error()
			for _, substr := range tt.contains {
				if !strings.Contains(errStr, substr) {
					t.Errorf("error string %q does not contain %q", errStr, substr)
				}
			}

			if tt.wrapped != nil {
				if !errors.Is(tt.err, tt.wrapped) {
					t.Errorf("error does not wrap %v", tt.wrapped)
				}
			}
		})
	}
}

func TestApprovalError(t *testing.T) {
	tests := []struct {
		name     string
		err      *hlderrors.ApprovalError
		contains []string
	}{
		{
			name: "full context",
			err: &hlderrors.ApprovalError{
				ApprovalID: "approval-123",
				SessionID:  "session-456",
				ToolCallID: "tool-789",
				Status:     "pending",
				Operation:  "resolve",
				Err:        errors.New("timeout"),
			},
			contains: []string{
				"approval error [resolve]",
				"approval_id=approval-123",
				"session_id=session-456",
				"tool_call_id=tool-789",
				"status=pending",
				"timeout",
			},
		},
		{
			name: "minimal context",
			err: &hlderrors.ApprovalError{
				Operation: "create",
				Err:       hlderrors.ErrApprovalAlreadyResolved,
			},
			contains: []string{
				"approval error [create]",
				"approval already resolved",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errStr := tt.err.Error()
			for _, substr := range tt.contains {
				if !strings.Contains(errStr, substr) {
					t.Errorf("error string %q does not contain %q", errStr, substr)
				}
			}
		})
	}
}

func TestValidationError(t *testing.T) {
	tests := []struct {
		name     string
		err      *hlderrors.ValidationError
		expected string
	}{
		{
			name: "with value",
			err: &hlderrors.ValidationError{
				Field:   "max_turns",
				Value:   -1,
				Message: "must be non-negative",
			},
			expected: "validation error: field 'max_turns' with value '-1': must be non-negative",
		},
		{
			name: "without value",
			err: &hlderrors.ValidationError{
				Field:   "query",
				Message: "required field",
			},
			expected: "validation error: field 'query': required field",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("got %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestStoreError(t *testing.T) {
	tests := []struct {
		name     string
		err      *hlderrors.StoreError
		contains []string
	}{
		{
			name: "full context with long query",
			err: &hlderrors.StoreError{
				Operation: "insert",
				Table:     "sessions",
				Query:     "INSERT INTO sessions (id, run_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
				Err:       errors.New("constraint violation"),
			},
			contains: []string{
				"store error [insert]",
				"table=sessions",
				"query=INSERT INTO sessions (id, run_id, status, created_at...",
				"constraint violation",
			},
		},
		{
			name: "short query",
			err: &hlderrors.StoreError{
				Operation: "select",
				Table:     "approvals",
				Query:     "SELECT * FROM approvals WHERE id = ?",
				Err:       errors.New("no rows"),
			},
			contains: []string{
				"store error [select]",
				"table=approvals",
				"query=SELECT * FROM approvals WHERE id = ?",
				"no rows",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errStr := tt.err.Error()
			for _, substr := range tt.contains {
				if !strings.Contains(errStr, substr) {
					t.Errorf("error string %q does not contain %q", errStr, substr)
				}
			}
		})
	}
}

func TestHelperFunctions(t *testing.T) {
	t.Run("NewSessionError", func(t *testing.T) {
		err := hlderrors.NewSessionError("test", "session-123", errors.New("failed"))
		if err.Operation != "test" || err.SessionID != "session-123" {
			t.Error("NewSessionError did not set fields correctly")
		}
	})

	t.Run("NewApprovalError", func(t *testing.T) {
		err := hlderrors.NewApprovalError("create", "approval-123", errors.New("failed"))
		if err.Operation != "create" || err.ApprovalID != "approval-123" {
			t.Error("NewApprovalError did not set fields correctly")
		}
	})

	t.Run("NewValidationError", func(t *testing.T) {
		err := hlderrors.NewValidationError("field", "message")
		if err.Field != "field" || err.Message != "message" {
			t.Error("NewValidationError did not set fields correctly")
		}
	})

	t.Run("NewStoreError", func(t *testing.T) {
		err := hlderrors.NewStoreError("query", "table", errors.New("failed"))
		if err.Operation != "query" || err.Table != "table" {
			t.Error("NewStoreError did not set fields correctly")
		}
	})
}

func TestErrorCheckers(t *testing.T) {
	t.Run("IsNotFound", func(t *testing.T) {
		tests := []struct {
			err      error
			expected bool
		}{
			{hlderrors.ErrSessionNotFound, true},
			{hlderrors.ErrApprovalNotFound, true},
			{hlderrors.ErrDuplicateSession, false},
			{errors.New("random error"), false},
			{&hlderrors.SessionError{Err: hlderrors.ErrSessionNotFound}, true},
		}

		for _, tt := range tests {
			if got := hlderrors.IsNotFound(tt.err); got != tt.expected {
				t.Errorf("IsNotFound(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		}
	})

	t.Run("IsAlreadyExists", func(t *testing.T) {
		tests := []struct {
			err      error
			expected bool
		}{
			{hlderrors.ErrDuplicateSession, true},
			{hlderrors.ErrApprovalAlreadyResolved, true},
			{hlderrors.ErrSessionAlreadyCompleted, true},
			{hlderrors.ErrSessionNotFound, false},
			{&hlderrors.SessionError{Err: hlderrors.ErrDuplicateSession}, true},
		}

		for _, tt := range tests {
			if got := hlderrors.IsAlreadyExists(tt.err); got != tt.expected {
				t.Errorf("IsAlreadyExists(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		}
	})

	t.Run("IsInvalidState", func(t *testing.T) {
		tests := []struct {
			err      error
			expected bool
		}{
			{hlderrors.ErrInvalidSessionState, true},
			{hlderrors.ErrSessionNotActive, true},
			{hlderrors.ErrInvalidApprovalStatus, true},
			{hlderrors.ErrSessionNotFound, false},
		}

		for _, tt := range tests {
			if got := hlderrors.IsInvalidState(tt.err); got != tt.expected {
				t.Errorf("IsInvalidState(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		}
	})

	t.Run("IsTimeout", func(t *testing.T) {
		if !hlderrors.IsTimeout(hlderrors.ErrOperationTimeout) {
			t.Error("IsTimeout(ErrOperationTimeout) should return true")
		}
		if hlderrors.IsTimeout(errors.New("other")) {
			t.Error("IsTimeout(other) should return false")
		}
	})

	t.Run("IsCancelled", func(t *testing.T) {
		if !hlderrors.IsCancelled(hlderrors.ErrOperationCancelled) {
			t.Error("IsCancelled(ErrOperationCancelled) should return true")
		}
		if hlderrors.IsCancelled(errors.New("other")) {
			t.Error("IsCancelled(other) should return false")
		}
	})
}
