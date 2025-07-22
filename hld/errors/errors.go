// Package errors provides domain-specific error types and constants for the hld daemon.
package errors

import (
	"errors"
	"fmt"
)

// Sentinel errors for common cases
var (
	// Session errors
	ErrSessionNotFound         = errors.New("session not found")
	ErrSessionNotActive        = errors.New("session not active")
	ErrSessionAlreadyCompleted = errors.New("session already completed")
	ErrInvalidSessionState     = errors.New("invalid session state")
	ErrSessionOrphaned         = errors.New("session orphaned")

	// Approval errors
	ErrApprovalNotFound        = errors.New("approval not found")
	ErrApprovalAlreadyResolved = errors.New("approval already resolved")
	ErrNoMatchingToolCall      = errors.New("no matching tool call found")
	ErrInvalidApprovalStatus   = errors.New("invalid approval status")

	// Store errors
	ErrDuplicateSession   = errors.New("duplicate session ID")
	ErrDatabaseConnection = errors.New("database connection failed")
	ErrDatabaseMigration  = errors.New("database migration failed")

	// RPC errors
	ErrInvalidRequest       = errors.New("invalid request")
	ErrMissingRequiredField = errors.New("missing required field")
	ErrMethodNotFound       = errors.New("method not found")

	// Daemon errors
	ErrDaemonAlreadyRunning = errors.New("daemon already running")
	ErrDaemonNotRunning     = errors.New("daemon not running")

	// Operation errors
	ErrOperationTimeout   = errors.New("operation timed out")
	ErrOperationCancelled = errors.New("operation cancelled")
)

// SessionError provides rich context for session-related errors
type SessionError struct {
	SessionID string
	RunID     string
	Operation string
	State     string
	Err       error
}

func (e *SessionError) Error() string {
	msg := fmt.Sprintf("session error [%s]", e.Operation)
	if e.SessionID != "" {
		msg += fmt.Sprintf(" session_id=%s", e.SessionID)
	}
	if e.RunID != "" {
		msg += fmt.Sprintf(" run_id=%s", e.RunID)
	}
	if e.State != "" {
		msg += fmt.Sprintf(" state=%s", e.State)
	}
	if e.Err != nil {
		msg += fmt.Sprintf(": %v", e.Err)
	}
	return msg
}

func (e *SessionError) Unwrap() error {
	return e.Err
}

// ApprovalError provides rich context for approval-related errors
type ApprovalError struct {
	ApprovalID string
	SessionID  string
	ToolCallID string
	Status     string
	Operation  string
	Err        error
}

func (e *ApprovalError) Error() string {
	msg := fmt.Sprintf("approval error [%s]", e.Operation)
	if e.ApprovalID != "" {
		msg += fmt.Sprintf(" approval_id=%s", e.ApprovalID)
	}
	if e.SessionID != "" {
		msg += fmt.Sprintf(" session_id=%s", e.SessionID)
	}
	if e.ToolCallID != "" {
		msg += fmt.Sprintf(" tool_call_id=%s", e.ToolCallID)
	}
	if e.Status != "" {
		msg += fmt.Sprintf(" status=%s", e.Status)
	}
	if e.Err != nil {
		msg += fmt.Sprintf(": %v", e.Err)
	}
	return msg
}

func (e *ApprovalError) Unwrap() error {
	return e.Err
}

// ValidationError represents a validation failure
type ValidationError struct {
	Field   string
	Value   interface{}
	Message string
}

func (e *ValidationError) Error() string {
	if e.Value != nil {
		return fmt.Sprintf("validation error: field '%s' with value '%v': %s", e.Field, e.Value, e.Message)
	}
	return fmt.Sprintf("validation error: field '%s': %s", e.Field, e.Message)
}

// StoreError provides context for database operations
type StoreError struct {
	Operation string
	Table     string
	Query     string
	Err       error
}

func (e *StoreError) Error() string {
	msg := fmt.Sprintf("store error [%s]", e.Operation)
	if e.Table != "" {
		msg += fmt.Sprintf(" table=%s", e.Table)
	}
	if e.Query != "" && len(e.Query) > 52 {
		// Truncate at 52 characters to show "created_at" and append "..."
		msg += fmt.Sprintf(" query=%s...", e.Query[:52])
	} else if e.Query != "" {
		msg += fmt.Sprintf(" query=%s", e.Query)
	}
	if e.Err != nil {
		msg += fmt.Sprintf(": %v", e.Err)
	}
	return msg
}

func (e *StoreError) Unwrap() error {
	return e.Err
}

// Helper functions for creating errors with context

// NewSessionError creates a new SessionError
func NewSessionError(operation string, sessionID string, err error) *SessionError {
	return &SessionError{
		SessionID: sessionID,
		Operation: operation,
		Err:       err,
	}
}

// NewApprovalError creates a new ApprovalError
func NewApprovalError(operation string, approvalID string, err error) *ApprovalError {
	return &ApprovalError{
		ApprovalID: approvalID,
		Operation:  operation,
		Err:        err,
	}
}

// NewValidationError creates a new ValidationError
func NewValidationError(field string, message string) *ValidationError {
	return &ValidationError{
		Field:   field,
		Message: message,
	}
}

// NewStoreError creates a new StoreError
func NewStoreError(operation string, table string, err error) *StoreError {
	return &StoreError{
		Operation: operation,
		Table:     table,
		Err:       err,
	}
}

// IsNotFound checks if an error represents a "not found" condition
func IsNotFound(err error) bool {
	return errors.Is(err, ErrSessionNotFound) ||
		errors.Is(err, ErrApprovalNotFound)
}

// IsAlreadyExists checks if an error represents a duplicate/conflict
func IsAlreadyExists(err error) bool {
	return errors.Is(err, ErrDuplicateSession) ||
		errors.Is(err, ErrApprovalAlreadyResolved) ||
		errors.Is(err, ErrSessionAlreadyCompleted)
}

// IsInvalidState checks if an error represents an invalid state transition
func IsInvalidState(err error) bool {
	return errors.Is(err, ErrInvalidSessionState) ||
		errors.Is(err, ErrSessionNotActive) ||
		errors.Is(err, ErrInvalidApprovalStatus)
}

// IsTimeout checks if an error represents a timeout
func IsTimeout(err error) bool {
	return errors.Is(err, ErrOperationTimeout)
}

// IsCancelled checks if an error represents a cancellation
func IsCancelled(err error) bool {
	return errors.Is(err, ErrOperationCancelled)
}
