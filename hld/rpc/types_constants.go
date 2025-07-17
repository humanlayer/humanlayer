package rpc

import "fmt"

// Decision represents a valid decision type for approvals
type Decision string

// Valid decision values
const (
	DecisionApprove Decision = "approve"
	DecisionDeny    Decision = "deny"
	DecisionRespond Decision = "respond"
)

// ApprovalType represents the type of approval being processed
type ApprovalType string

// Valid approval types
const (
	ApprovalTypeFunctionCall ApprovalType = "function_call"
)

// String returns the string representation of the decision
func (d Decision) String() string {
	return string(d)
}

// String returns the string representation of the approval type
func (at ApprovalType) String() string {
	return string(at)
}

// IsValidForApprovalType validates if the decision is valid for a specific approval type
func (d Decision) IsValidForApprovalType(approvalType ApprovalType) bool {
	switch approvalType {
	case ApprovalTypeFunctionCall:
		return d == DecisionApprove || d == DecisionDeny
	default:
		return false
	}
}

// ValidateForApprovalType validates the decision for a specific approval type and returns an error if invalid
func (d Decision) ValidateForApprovalType(approvalType ApprovalType) error {
	if !d.IsValidForApprovalType(approvalType) {
		return fmt.Errorf("invalid decision '%s' for approval type '%s'", d, approvalType)
	}
	return nil
}

// ValidDecisionsForApprovalType returns the valid decisions for a given approval type
func ValidDecisionsForApprovalType(approvalType ApprovalType) []Decision {
	switch approvalType {
	case ApprovalTypeFunctionCall:
		return []Decision{DecisionApprove, DecisionDeny}
	default:
		return []Decision{}
	}
}

// IsValidApprovalType checks if the given string is a valid approval type
func IsValidApprovalType(s string) bool {
	return ApprovalType(s) == ApprovalTypeFunctionCall
}

// ParseApprovalType parses a string into an ApprovalType, returning an error if invalid
func ParseApprovalType(s string) (ApprovalType, error) {
	if !IsValidApprovalType(s) {
		return "", fmt.Errorf("invalid approval type: %s", s)
	}
	return ApprovalType(s), nil
}

// ParseDecision parses a string into a Decision, returning an error if invalid
func ParseDecision(s string) (Decision, error) {
	switch s {
	case string(DecisionApprove), string(DecisionDeny), string(DecisionRespond):
		return Decision(s), nil
	default:
		return "", fmt.Errorf("invalid decision: %s", s)
	}
}
