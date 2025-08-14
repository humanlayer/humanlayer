import { SessionStatus, ApprovalStatus } from '@humanlayer/hld-sdk'
import type {
  CreateSessionRequest,
  CreateSessionResponseData,
  HealthResponse,
  Event,
  EventType,
  RecentPath as SDKRecentPath,
  Session as SDKSession,
  Approval,
  ConversationEvent,
} from '@humanlayer/hld-sdk'

// Re-export SDK types and values
export { SessionStatus, ApprovalStatus }
export type { Event, EventType }
export type RecentPath = SDKRecentPath

// Export SDK types directly
export type { Approval } from '@humanlayer/hld-sdk'

// Use SDK Session type directly with camelCase naming
export type Session = SDKSession

// Export SDK ConversationEvent type directly
export type { ConversationEvent } from '@humanlayer/hld-sdk'
export type SessionSnapshot = FileSnapshotInfo // Components expect snake_case
export type HealthCheckResponse = HealthResponse

// Define client-specific types not in SDK
export interface LaunchSessionParams extends CreateSessionRequest {
  // Add any WUI-specific extensions if needed
}

export interface SessionState {
  session: Session
  pendingApprovals: Approval[]
}

export interface SubscribeOptions {
  event_types?: EventType[]
  session_id?: string
  run_id?: string
  onEvent: (event: Event) => void
}

export interface SubscriptionHandle {
  unsubscribe: () => void
}

export interface DatabaseInfo {
  path: string
  size: number
  table_count: number
  stats: Record<string, number>
  last_modified?: string
}

// Client interface using legacy types for backward compatibility
export interface DaemonClient {
  connect(): Promise<void>
  reconnect(): Promise<void>
  disconnect(): Promise<void>
  health(): Promise<HealthCheckResponse>

  // Session methods
  launchSession(params: LaunchSessionParams | LaunchSessionRequest): Promise<CreateSessionResponseData>
  listSessions(): Promise<Session[]>
  getSessionLeaves(request?: {
    include_archived?: boolean
    archived_only?: boolean
  }): Promise<{ sessions: Session[] }>
  getSessionState(sessionId: string): Promise<SessionState>
  continueSession(
    sessionId: string,
    message: string,
  ): Promise<{ success: boolean; new_session_id?: string }>
  interruptSession(sessionId: string): Promise<{ success: boolean }>
  updateSessionSettings(
    sessionId: string,
    settings: {
      auto_accept_edits?: boolean
      dangerously_skip_permissions?: boolean
      dangerously_skip_permissions_timeout_ms?: number
    },
  ): Promise<{ success: boolean }>
  archiveSession(
    sessionIdOrRequest: string | { session_id: string; archived: boolean },
  ): Promise<{ success: boolean }>
  bulkArchiveSessions(
    sessionIdsOrRequest: string[] | { session_ids: string[]; archived: boolean },
  ): Promise<{ success: boolean; archived_count: number }>
  updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }>

  // Conversation methods
  getConversation(
    params: {
      session_id?: string
      claude_session_id?: string
    },
    options?: RequestInit,
  ): Promise<ConversationEvent[]>
  getSessionSnapshots(sessionId: string): Promise<SessionSnapshot[]>

  // Approval methods
  fetchApprovals(sessionId?: string): Promise<Approval[]>
  sendDecision(
    approvalId: string,
    decision: 'approve' | 'deny',
    comment?: string,
  ): Promise<{ success: boolean; error?: string }>
  approveFunctionCall(
    approvalId: string,
    comment?: string,
  ): Promise<{ success: boolean; error?: string }>
  denyFunctionCall(approvalId: string, comment?: string): Promise<{ success: boolean; error?: string }>

  // Event subscription
  subscribeToEvents(options: SubscribeOptions): SubscriptionHandle

  // Utility methods
  getRecentPaths(limit?: number): Promise<RecentPath[]>
  getDatabaseInfo(): Promise<DatabaseInfo>
}

// Legacy enums and types for backward compatibility (to be gradually removed)
export enum Decision {
  Approve = 'approve',
  Deny = 'deny',
}

export enum ConversationEventType {
  Message = 'message',
  ToolCall = 'tool_call',
  ToolResult = 'tool_result',
  System = 'system',
  Thinking = 'thinking',
}

export enum ConversationRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export enum ViewMode {
  Normal = 'normal',
  Archived = 'archived',
}

// Legacy request/response types (for gradual migration)
export interface LaunchSessionRequest {
  query: string
  model?: string
  mcp_config?: any
  permission_prompt_tool?: string
  working_dir?: string
  max_turns?: number
  system_prompt?: string
  append_system_prompt?: string
  allowed_tools?: string[]
  disallowed_tools?: string[]
  custom_instructions?: string
  verbose?: boolean
  dangerously_skip_permissions?: boolean
  dangerously_skip_permissions_timeout?: number
}

export interface LaunchSessionResponse {
  session_id: string
  run_id: string
}

export interface ListSessionsResponse {
  sessions: Session[]
}

export interface GetSessionLeavesRequest {
  include_archived?: boolean
  archived_only?: boolean
}

export interface GetSessionLeavesResponse {
  sessions: Session[]
}

// Contact channel types
export interface SlackChannel {
  channel_or_user_id: string
}

export interface EmailChannel {
  address: string
}

export interface ContactChannel {
  slack?: SlackChannel
  email?: EmailChannel
}

// Response option types
export interface ResponseOption {
  name: string
  title?: string
  description?: string
  prompt_fill?: string
  interactive: boolean
}

// Minimal approval event data
export interface ApprovalEventData {
  approval_id: string
  session_id: string
  tool_name: string
}

export interface FetchApprovalsResponse {
  approvals: Approval[]
}

// Event-specific data types
export interface NewApprovalEventData extends ApprovalEventData {
  // Uses the ApprovalEventData fields
}

// Alias for backwards compatibility (to be removed)
export type ApprovalRequestedEventData = NewApprovalEventData

export interface ApprovalResolvedEventData {
  approval_id: string // was call_id
  session_id: string
  decision: Decision
}

export interface SessionStatusChangedEventData {
  session_id: string
  old_status: SessionStatus
  new_status: SessionStatus
}

// Constants for session settings change reasons
export const SessionSettingsChangeReason = {
  EXPIRED: 'expired', // Dangerous skip permissions expired due to timeout
} as const

export type SessionSettingsChangeReasonType =
  (typeof SessionSettingsChangeReason)[keyof typeof SessionSettingsChangeReason]

export interface SessionSettingsChangedEventData {
  session_id: string
  event_type?: string
  auto_accept_edits?: boolean
  dangerously_skip_permissions?: boolean
  dangerously_skip_permissions_timeout_ms?: number
  reason?: SessionSettingsChangeReasonType
  expired_at?: string // Timestamp when the dangerous skip permissions expired
}

// Conversation types
export interface GetConversationRequest {
  session_id?: string
  claude_session_id?: string
}

export interface GetConversationResponse {
  events: ConversationEvent[]
}

// Continue session types
export interface ContinueSessionRequest {
  session_id: string
  query: string
  system_prompt?: string
  append_system_prompt?: string
  mcp_config?: string // JSON string in protocol
  permission_prompt_tool?: string
  allowed_tools?: string[]
  disallowed_tools?: string[]
  custom_instructions?: string
  max_turns?: number
}

export interface ContinueSessionResponse {
  session_id: string
  run_id: string
  claude_session_id: string
  parent_session_id: string
}

// Decision types
export interface SendDecisionRequest {
  approval_id: string // was call_id
  decision: Decision
  comment?: string
}

export interface SendDecisionResponse {
  success: boolean
  error?: string
}

// Subscribe types
export interface SubscribeRequest {
  event_types?: string[]
  session_id?: string
  run_id?: string
}

// Recent paths types (legacy interface - replaced by SDK type)
// export interface RecentPath {
//   path: string
//   last_used: string
//   usage_count: number
// }

export interface GetRecentPathsResponse {
  paths: RecentPath[]
}

// Daemon client API
export interface GetSessionStateResponse {
  session: SessionState
}

export interface InterruptSessionRequest {
  session_id: string
}

export interface InterruptSessionResponse {
  success: boolean
  session_id: string
  status: string
}

// Session settings types
export interface UpdateSessionSettingsRequest {
  session_id: string
  auto_accept_edits?: boolean
  dangerously_skip_permissions?: boolean
  dangerously_skip_permissions_timeout_ms?: number
}

export interface UpdateSessionSettingsResponse {
  success: boolean
}
// Archive session types
export interface ArchiveSessionRequest {
  session_id: string
  archived: boolean
}

export interface ArchiveSessionResponse {
  success: boolean
}

export interface BulkArchiveSessionsRequest {
  session_ids: string[]
  archived: boolean
}

export interface BulkArchiveSessionsResponse {
  success: boolean
  failed_sessions?: string[]
}

// Snapshot types
export interface FileSnapshotInfo {
  tool_id: string
  file_path: string
  content: string
  created_at: string // ISO 8601 format
}

export interface GetSessionSnapshotsRequest {
  session_id: string
}

export interface GetSessionSnapshotsResponse {
  snapshots: FileSnapshotInfo[]
}

// Update session title types
export interface UpdateSessionTitleRequest {
  session_id: string
  title: string
}

export interface UpdateSessionTitleResponse {
  success: boolean
}

// Helper function to ensure SDK Session has proper defaults
export function transformSDKSession(sdkSession: SDKSession): Session {
  // SDK Session already has the correct camelCase fields, just ensure defaults
  return {
    ...sdkSession,
    dangerouslySkipPermissions: sdkSession.dangerouslySkipPermissions ?? false,
  }
}
