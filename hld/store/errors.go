package store

import (
	"errors"
	"fmt"
)

// Sentinel errors for common store operations
var (
	// ErrNotFound is returned when a requested entity is not found
	ErrNotFound = errors.New("not found")

	// ErrAlreadyDecided is returned when attempting to decide an approval that has already been decided
	ErrAlreadyDecided = errors.New("approval already decided")

	// ErrInvalidStatus is returned when an invalid status is provided
	ErrInvalidStatus = errors.New("invalid status")
)

// NotFoundError wraps ErrNotFound with additional context
type NotFoundError struct {
	Type string // e.g., "approval", "session"
	ID   string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("%s not found: %s", e.Type, e.ID)
}

func (e *NotFoundError) Unwrap() error {
	return ErrNotFound
}

// AlreadyDecidedError wraps ErrAlreadyDecided with additional context
type AlreadyDecidedError struct {
	ID     string
	Status string // current status
}

func (e *AlreadyDecidedError) Error() string {
	return fmt.Sprintf("approval %s already decided with status: %s", e.ID, e.Status)
}

func (e *AlreadyDecidedError) Unwrap() error {
	return ErrAlreadyDecided
}
