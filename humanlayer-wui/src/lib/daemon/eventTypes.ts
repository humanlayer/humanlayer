/**
 * Type definitions for daemon events
 * Based on hld/bus/types.go and hld/bus/events.go
 */

import { ApprovalStatus } from './types'
import { AnyToolInput } from './toolTypes'

/**
 * Event types that can be emitted by the daemon
 */
export enum DaemonEventType {
  NewApproval = 'new_approval',
  ApprovalResolved = 'approval_resolved',
  SessionStatusChanged = 'session_status_changed',
  ConversationUpdated = 'conversation_updated',
}

/**
 * Base event structure matching Go Event struct
 */
export interface BaseEvent<T extends DaemonEventType, D> {
  type: T
  timestamp: string
  data: D
}

/**
 * Data for new_approval event
 * Emitted when a new approval is created that requires human review
 */
export interface NewApprovalEventData {
  approval_id: string
  session_id: string
  tool_name: string
}

/**
 * Data for approval_resolved event
 * Emitted when an approval has been resolved (approved/denied)
 * Note: The Go daemon sends 'approved' (boolean) and 'response_text',
 * but for compatibility with existing TypeScript code we map to 'decision'
 */
export interface ApprovalResolvedEventData {
  approval_id: string
  session_id: string
  decision: 'approve' | 'deny'
  // Original fields from Go (may need mapping):
  // approved: boolean
  // response_text: string
}

/**
 * Data for session_status_changed event
 * Emitted when a session status changes
 */
export interface SessionStatusChangedEventData {
  session_id: string
  run_id?: string
  old_status?: string
  new_status?: string
  // Additional fields for specific status changes
  event_type?: 'settings_updated'
  auto_accept_edits?: boolean
}

/**
 * Data for conversation_updated event
 * Emitted when new conversation content is added to a session
 */
export interface ConversationUpdatedEventData {
  session_id: string
  claude_session_id?: string
  sequence?: number
  event_type?: 'system' | 'message' | 'tool_call' | 'tool_result' | 'thinking'
  // Fields for message events
  role?: 'user' | 'assistant' | 'system'
  content?: string
  // Fields for tool events
  tool_id?: string
  tool_name?: string
  tool_input?: AnyToolInput
  tool_result?: string
  // Fields for correlation
  approval_id?: string
  approval_status?: ApprovalStatus
}

/**
 * Individual event types with their specific data
 */
export type NewApprovalEvent = BaseEvent<DaemonEventType.NewApproval, NewApprovalEventData>
export type ApprovalResolvedEvent = BaseEvent<
  DaemonEventType.ApprovalResolved,
  ApprovalResolvedEventData
>
export type SessionStatusChangedEvent = BaseEvent<
  DaemonEventType.SessionStatusChanged,
  SessionStatusChangedEventData
>
export type ConversationUpdatedEvent = BaseEvent<
  DaemonEventType.ConversationUpdated,
  ConversationUpdatedEventData
>

/**
 * Discriminated union of all possible daemon events
 */
export type DaemonEvent =
  | NewApprovalEvent
  | ApprovalResolvedEvent
  | SessionStatusChangedEvent
  | ConversationUpdatedEvent

/**
 * Helper type guard functions
 */
export function isNewApprovalEvent(event: DaemonEvent): event is NewApprovalEvent {
  return event.type === DaemonEventType.NewApproval
}

export function isApprovalResolvedEvent(event: DaemonEvent): event is ApprovalResolvedEvent {
  return event.type === DaemonEventType.ApprovalResolved
}

export function isSessionStatusChangedEvent(event: DaemonEvent): event is SessionStatusChangedEvent {
  return event.type === DaemonEventType.SessionStatusChanged
}

export function isConversationUpdatedEvent(event: DaemonEvent): event is ConversationUpdatedEvent {
  return event.type === DaemonEventType.ConversationUpdated
}

/**
 * Event notification wrapper as sent by the daemon's websocket
 */
export interface DaemonEventNotification {
  event: DaemonEvent
}

/**
 * Event filter for subscriptions (matching Go EventFilter)
 */
export interface EventFilter {
  types?: DaemonEventType[]
  session_id?: string
  run_id?: string
}
