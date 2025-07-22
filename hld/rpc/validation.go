package rpc

import (
	"errors"
	"fmt"
	"strings"

	hlderrors "github.com/humanlayer/humanlayer/hld/errors"
)

// validateLaunchRequest validates a launch session request
func validateLaunchRequest(req *LaunchSessionRequest) error {
	var errs []error

	if req.Query == "" {
		errs = append(errs, hlderrors.NewValidationError("query", "required field"))
	}

	if req.MaxTurns < 0 {
		errs = append(errs, &hlderrors.ValidationError{
			Field:   "max_turns",
			Value:   req.MaxTurns,
			Message: "must be non-negative",
		})
	}

	if req.Model != "" && !isValidModel(req.Model) {
		errs = append(errs, &hlderrors.ValidationError{
			Field:   "model",
			Value:   req.Model,
			Message: "invalid model specified",
		})
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

// validateContinueRequest validates a continue session request
func validateContinueRequest(req *ContinueSessionRequest) error {
	var errs []error

	if req.SessionID == "" {
		errs = append(errs, hlderrors.NewValidationError("session_id", "required field"))
	}

	if req.Query == "" {
		errs = append(errs, hlderrors.NewValidationError("query", "required field"))
	}

	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

// validateInterruptRequest validates an interrupt session request
//
//nolint:unused // Available for future use
func validateInterruptRequest(req *InterruptSessionRequest) error {
	if req.SessionID == "" {
		return hlderrors.NewValidationError("session_id", "required field")
	}
	return nil
}

// validateUpdateSessionSettingsRequest validates an update session settings request
//
//nolint:unused // Available for future use
func validateUpdateSessionSettingsRequest(req *UpdateSessionSettingsRequest) error {
	if req.SessionID == "" {
		return hlderrors.NewValidationError("session_id", "required field")
	}
	return nil
}

// validateArchiveSessionRequest validates an archive session request
//
//nolint:unused // Available for future use
func validateArchiveSessionRequest(req *ArchiveSessionRequest) error {
	if req.SessionID == "" {
		return hlderrors.NewValidationError("session_id", "required field")
	}
	return nil
}

// validateSessionID validates a session ID format
//
//nolint:unused // Available for future use
func validateSessionID(id string) error {
	if id == "" {
		return hlderrors.NewValidationError("session_id", "cannot be empty")
	}
	if len(id) > 100 {
		return hlderrors.NewValidationError("session_id", "too long (max 100 characters)")
	}
	if strings.ContainsAny(id, "\n\r\t") {
		return hlderrors.NewValidationError("session_id", "contains invalid characters")
	}
	return nil
}

// validateRunID validates a run ID format
//
//nolint:unused // Available for future use
func validateRunID(id string) error {
	if id == "" {
		return hlderrors.NewValidationError("run_id", "cannot be empty")
	}
	if len(id) > 100 {
		return hlderrors.NewValidationError("run_id", "too long (max 100 characters)")
	}
	if strings.ContainsAny(id, "\n\r\t") {
		return hlderrors.NewValidationError("run_id", "contains invalid characters")
	}
	return nil
}

// Helper functions

func isValidModel(model string) bool {
	validModels := []string{
		"claude-3-opus-20240229",
		"claude-3-sonnet-20240229",
		"claude-3-haiku-20240307",
		"claude-3-5-sonnet-20241022",
		"claude-3-5-haiku-20241022",
	}
	for _, valid := range validModels {
		if model == valid {
			return true
		}
	}
	return false
}

//nolint:unused // Available for future use
func isValidSessionStatus(status string) bool {
	validStatuses := []string{
		"pending",
		"active",
		"completed",
		"failed",
		"cancelled",
	}
	for _, valid := range validStatuses {
		if status == valid {
			return true
		}
	}
	return false
}

// joinValidationErrors creates a single error from multiple validation errors
//
//nolint:unused // Available for future use
func joinValidationErrors(errs []error) error {
	if len(errs) == 0 {
		return nil
	}
	if len(errs) == 1 {
		return errs[0]
	}

	// Create a compound validation error message
	var fields []string
	for _, err := range errs {
		var valErr *hlderrors.ValidationError
		if errors.As(err, &valErr) {
			fields = append(fields, valErr.Field)
		}
	}

	return fmt.Errorf("validation failed for fields: %s (%w)", strings.Join(fields, ", "), errors.Join(errs...))
}
