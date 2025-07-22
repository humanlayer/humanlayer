/**
 * Runtime validation for RPC responses
 * This module provides type guards and validation functions to ensure
 * type safety at runtime for JSON-RPC responses
 */

import type {
  Event,
  EventData,
  NewApprovalData,
  ApprovalResolvedData,
  SessionStatusChangedData,
  Session,
  Approval,
  JSONRPCResponse,
  JSONRPCError,
} from './rpc'

// Type guard for JSONRPCError
export function isJSONRPCError(obj: unknown): obj is JSONRPCError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'code' in obj &&
    'message' in obj &&
    typeof (obj as JSONRPCError).code === 'number' &&
    typeof (obj as JSONRPCError).message === 'string'
  )
}

// Type guard for JSONRPCResponse
export function isJSONRPCResponse<T>(obj: unknown): obj is JSONRPCResponse<T> {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }

  const response = obj as JSONRPCResponse<T>

  return response.jsonrpc === '2.0' && ('result' in response || 'error' in response) && 'id' in response
}

// Validate and assert Session type
export function validateSession(obj: unknown): Session {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid session: expected object')
  }

  const session = obj as Record<string, unknown>

  // Required fields
  if (typeof session.id !== 'string') {
    throw new Error('Invalid session: missing or invalid id')
  }
  if (typeof session.run_id !== 'string') {
    throw new Error('Invalid session: missing or invalid run_id')
  }
  if (typeof session.query !== 'string') {
    throw new Error('Invalid session: missing or invalid query')
  }
  if (typeof session.status !== 'string') {
    throw new Error('Invalid session: missing or invalid status')
  }
  if (typeof session.created_at !== 'string') {
    throw new Error('Invalid session: missing or invalid created_at')
  }

  return session as Session
}

// Validate and assert Approval type
export function validateApproval(obj: unknown): Approval {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid approval: expected object')
  }

  const approval = obj as Record<string, unknown>

  // Required fields
  if (typeof approval.id !== 'string') {
    throw new Error('Invalid approval: missing or invalid id')
  }
  if (typeof approval.session_id !== 'string') {
    throw new Error('Invalid approval: missing or invalid session_id')
  }
  if (typeof approval.run_id !== 'string') {
    throw new Error('Invalid approval: missing or invalid run_id')
  }
  if (typeof approval.tool_name !== 'string') {
    throw new Error('Invalid approval: missing or invalid tool_name')
  }
  if (typeof approval.created_at !== 'string') {
    throw new Error('Invalid approval: missing or invalid created_at')
  }

  // tool_input should be an object
  if (typeof approval.tool_input !== 'object' || approval.tool_input === null) {
    throw new Error('Invalid approval: missing or invalid tool_input')
  }

  return approval as Approval
}

// Validate Event type
export function validateEvent(obj: unknown): Event {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid event: expected object')
  }

  const event = obj as Record<string, unknown>

  if (typeof event.type !== 'string') {
    throw new Error('Invalid event: missing or invalid type')
  }

  if (typeof event.timestamp !== 'string') {
    throw new Error('Invalid event: missing or invalid timestamp')
  }

  if (typeof event.data !== 'object' || event.data === null) {
    throw new Error('Invalid event: missing or invalid data')
  }

  // Validate event data based on type
  const eventType = event.type as string
  const data = event.data as EventData

  switch (eventType) {
    case 'new_approval':
      validateNewApprovalData(data)
      break
    case 'approval_resolved':
      validateApprovalResolvedData(data)
      break
    case 'session_status_changed':
      validateSessionStatusChangedData(data)
      break
    default:
      throw new Error(`Invalid event: unknown event type ${eventType}`)
  }

  return event as Event
}

// Validate NewApprovalData
function validateNewApprovalData(data: unknown): asserts data is NewApprovalData {
  const d = data as Record<string, unknown>

  if (typeof d.session_id !== 'string') {
    throw new Error('Invalid new_approval event: missing session_id')
  }
  if (typeof d.run_id !== 'string') {
    throw new Error('Invalid new_approval event: missing run_id')
  }
  if (typeof d.approval_id !== 'string') {
    throw new Error('Invalid new_approval event: missing approval_id')
  }
  if (typeof d.tool_name !== 'string') {
    throw new Error('Invalid new_approval event: missing tool_name')
  }
}

// Validate ApprovalResolvedData
function validateApprovalResolvedData(data: unknown): asserts data is ApprovalResolvedData {
  const d = data as Record<string, unknown>

  if (typeof d.session_id !== 'string') {
    throw new Error('Invalid approval_resolved event: missing session_id')
  }
  if (typeof d.run_id !== 'string') {
    throw new Error('Invalid approval_resolved event: missing run_id')
  }
  if (typeof d.approval_id !== 'string') {
    throw new Error('Invalid approval_resolved event: missing approval_id')
  }
  if (typeof d.approved !== 'boolean') {
    throw new Error('Invalid approval_resolved event: missing approved')
  }
}

// Validate SessionStatusChangedData
function validateSessionStatusChangedData(data: unknown): asserts data is SessionStatusChangedData {
  const d = data as Record<string, unknown>

  if (typeof d.session_id !== 'string') {
    throw new Error('Invalid session_status_changed event: missing session_id')
  }
  if (typeof d.old_status !== 'string') {
    throw new Error('Invalid session_status_changed event: missing old_status')
  }
  if (typeof d.new_status !== 'string') {
    throw new Error('Invalid session_status_changed event: missing new_status')
  }
}

// Helper function to validate array of items
export function validateArray<T>(items: unknown[], validator: (item: unknown) => T): T[] {
  return items.map(validator)
}

// Wrap RPC response validation
export function validateRPCResponse<T>(
  response: JSONRPCResponse<unknown>,
  validator?: (result: unknown) => T,
): T {
  if (response.error) {
    throw new Error(`RPC error ${response.error.code}: ${response.error.message}`)
  }

  if (!('result' in response)) {
    throw new Error('RPC response missing result')
  }

  if (validator) {
    return validator(response.result)
  }

  return response.result as T
}
