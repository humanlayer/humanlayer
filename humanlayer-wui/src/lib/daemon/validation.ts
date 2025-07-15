import { Decision, ApprovalType } from './types'

/**
 * Type guard to check if a value is a valid Decision enum value
 */
export function isValidDecision(value: any): value is Decision {
  return Object.values(Decision).includes(value)
}

/**
 * Type guard to check if a value is a valid ApprovalType enum value
 */
export function isValidApprovalType(value: any): value is ApprovalType {
  return Object.values(ApprovalType).includes(value)
}

/**
 * Check if a decision is valid for a given approval type
 * Mirrors the Rust implementation's validation logic
 */
export function isValidDecisionForApprovalType(
  decision: Decision,
  approvalType: ApprovalType,
): boolean {
  switch (approvalType) {
    case ApprovalType.FunctionCall:
      return decision === Decision.Approve || decision === Decision.Deny
    case ApprovalType.HumanContact:
      return decision === Decision.Respond
    default:
      return false
  }
}

/**
 * Validate that required fields are present for a decision
 */
export function validateDecisionRequest(
  decision: Decision,
  approvalType: ApprovalType,
  comment?: string,
): { valid: boolean; error?: string } {
  // Check decision is valid for approval type
  if (!isValidDecisionForApprovalType(decision, approvalType)) {
    return {
      valid: false,
      error: `Invalid decision '${decision}' for approval type '${approvalType}'`,
    }
  }

  // Check required fields
  if (decision === Decision.Deny && !comment) {
    return {
      valid: false,
      error: 'Comment is required when denying a function call',
    }
  }

  if (decision === Decision.Respond && !comment) {
    return {
      valid: false,
      error: 'Response is required for human contact',
    }
  }

  return { valid: true }
}
