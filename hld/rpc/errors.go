package rpc

import (
	"context"
	"database/sql"
	"errors"

	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
)

// Custom error codes for domain-specific errors
const (
	// ResourceNotFound indicates the requested resource was not found
	ResourceNotFound = -32001
	// ResourceConflict indicates a conflict with existing resource
	ResourceConflict = -32002
	// OperationTimeout indicates the operation timed out
	OperationTimeout = -32003
	// InvalidState indicates an invalid state transition
	InvalidState = -32004
	// ValidationFailed indicates request validation failed
	ValidationFailed = -32005
)

// mapErrorToRPCError converts internal errors to appropriate RPC errors
func mapErrorToRPCError(err error) *Error {
	if err == nil {
		return nil
	}

	// Check for not found errors
	if hlderrors.IsNotFound(err) {
		return &Error{
			Code:    ResourceNotFound,
			Message: "Resource not found",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}
	}

	// Check for already exists/conflict errors
	if hlderrors.IsAlreadyExists(err) {
		return &Error{
			Code:    ResourceConflict,
			Message: "Resource conflict",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}
	}

	// Check for invalid state errors
	if hlderrors.IsInvalidState(err) {
		return &Error{
			Code:    InvalidState,
			Message: "Invalid state transition",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}
	}

	// Check for timeout errors
	if hlderrors.IsTimeout(err) || errors.Is(err, context.DeadlineExceeded) {
		return &Error{
			Code:    OperationTimeout,
			Message: "Operation timed out",
			Data: map[string]interface{}{
				"error": "The operation took too long to complete",
			},
		}
	}

	// Check for cancellation
	if hlderrors.IsCancelled(err) || errors.Is(err, context.Canceled) {
		return &Error{
			Code:    InternalError,
			Message: "Operation cancelled",
			Data: map[string]interface{}{
				"error": "The operation was cancelled",
			},
		}
	}

	// Check for validation errors
	var validationErr *hlderrors.ValidationError
	if errors.As(err, &validationErr) {
		return &Error{
			Code:    ValidationFailed,
			Message: "Validation failed",
			Data: map[string]interface{}{
				"field":   validationErr.Field,
				"message": validationErr.Message,
				"value":   validationErr.Value,
			},
		}
	}

	// Check for specific sentinel errors
	switch {
	case errors.Is(err, hlderrors.ErrInvalidRequest):
		return &Error{
			Code:    InvalidRequest,
			Message: err.Error(),
		}
	case errors.Is(err, hlderrors.ErrMissingRequiredField):
		return &Error{
			Code:    InvalidParams,
			Message: err.Error(),
		}
	case errors.Is(err, hlderrors.ErrMethodNotFound):
		return &Error{
			Code:    MethodNotFound,
			Message: err.Error(),
		}
	case errors.Is(err, sql.ErrNoRows):
		return &Error{
			Code:    ResourceNotFound,
			Message: "Resource not found",
		}
	}

	// Extract context from typed errors
	var sessionErr *hlderrors.SessionError
	if errors.As(err, &sessionErr) {
		data := make(map[string]interface{})
		if sessionErr.SessionID != "" {
			data["session_id"] = sessionErr.SessionID
		}
		if sessionErr.RunID != "" {
			data["run_id"] = sessionErr.RunID
		}
		if sessionErr.Operation != "" {
			data["operation"] = sessionErr.Operation
		}
		if sessionErr.State != "" {
			data["state"] = sessionErr.State
		}
		data["error"] = sessionErr.Error()

		return &Error{
			Code:    InternalError,
			Message: "Session operation failed",
			Data:    data,
		}
	}

	var approvalErr *hlderrors.ApprovalError
	if errors.As(err, &approvalErr) {
		data := make(map[string]interface{})
		if approvalErr.ApprovalID != "" {
			data["approval_id"] = approvalErr.ApprovalID
		}
		if approvalErr.SessionID != "" {
			data["session_id"] = approvalErr.SessionID
		}
		if approvalErr.ToolCallID != "" {
			data["tool_call_id"] = approvalErr.ToolCallID
		}
		if approvalErr.Operation != "" {
			data["operation"] = approvalErr.Operation
		}
		data["error"] = approvalErr.Error()

		return &Error{
			Code:    InternalError,
			Message: "Approval operation failed",
			Data:    data,
		}
	}

	var storeErr *hlderrors.StoreError
	if errors.As(err, &storeErr) {
		// Don't expose internal database details
		return &Error{
			Code:    InternalError,
			Message: "Database operation failed",
			Data: map[string]interface{}{
				"operation": storeErr.Operation,
			},
		}
	}

	// Default internal error
	return &Error{
		Code:    InternalError,
		Message: "Internal error occurred",
		Data: map[string]interface{}{
			"error": err.Error(),
		},
	}
}

// wrapError creates an RPC response with an error
//
//nolint:unused // Available for future use
func wrapError(id interface{}, err error) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   mapErrorToRPCError(err),
	}
}

// successResponse creates a successful RPC response
//
//nolint:unused // Available for future use
func successResponse(id interface{}, result interface{}) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
}
