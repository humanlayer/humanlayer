// Package domain contains the pure business logic of the application.
package domain

import "errors"

// Sentinel errors for common error conditions
var (
	// ErrNotFound indicates that a requested resource was not found
	ErrNotFound = errors.New("resource not found")

	// ErrConflict indicates that the operation conflicts with existing state
	ErrConflict = errors.New("operation conflicts with existing state")

	// ErrAlreadyExists indicates that a resource already exists
	ErrAlreadyExists = errors.New("resource already exists")

	// ErrInvalidInput indicates that the provided input is invalid
	ErrInvalidInput = errors.New("invalid input")

	// ErrTimeout indicates that an operation timed out
	ErrTimeout = errors.New("operation timed out")

	// ErrConnectionFailed indicates that a connection could not be established
	ErrConnectionFailed = errors.New("connection failed")

	// ErrUnauthorized indicates that the operation is not authorized
	ErrUnauthorized = errors.New("unauthorized")

	// ErrServerError indicates an internal server error
	ErrServerError = errors.New("internal server error")

	// ErrAlreadyResponded indicates that an approval/request has already been responded to
	ErrAlreadyResponded = errors.New("already responded")

	// ErrDaemonNotConnected indicates that the daemon is not connected
	ErrDaemonNotConnected = errors.New("daemon not connected")

	// ErrNoActiveSession indicates that there is no active session
	ErrNoActiveSession = errors.New("no active session")

	// ErrCacheMiss indicates that the requested item was not found in cache
	ErrCacheMiss = errors.New("cache miss")

	// ErrUnexpectedResponse indicates an unexpected response from the API
	ErrUnexpectedResponse = errors.New("unexpected response from API")
)
