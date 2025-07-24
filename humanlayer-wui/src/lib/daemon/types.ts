// Import types from the SDK instead of redefining them
import type {
  Session as SDKSession,
  Approval as SDKApproval,
  Event,
  CreateSessionRequest,
  ConversationEvent as SDKConversationEvent,
  FileSnapshot,
  HealthResponse,
} from '@humanlayer/hld-sdk'

// Import everything we need from the SDK
import { 
  SessionStatus as SDKSessionStatus,
  ApprovalStatus as SDKApprovalStatus,
} from '@humanlayer/hld-sdk'
import type { 
  EventType,
  SessionStatus as SessionStatusType,
  ApprovalStatus as ApprovalStatusType,
} from '@humanlayer/hld-sdk'

// Re-export SDK types for convenience
export { Event } from '@humanlayer/hld-sdk'
// Re-export the const objects and their types
export const SessionStatus = SDKSessionStatus
export const ApprovalStatus = SDKApprovalStatus
export type SessionStatus = SessionStatusType
export type ApprovalStatus = ApprovalStatusType
export type { EventType }

// Map to legacy types for backward compatibility
export type Session = LegacySession // Components expect snake_case
export type Approval = LegacyApproval // Components expect snake_case

// Map SDK types to existing interfaces for backward compatibility
export type ConversationEvent = LegacyConversationEvent // Components expect snake_case
export type SessionSnapshot = FileSnapshotInfo // Components expect snake_case
export type HealthCheckResponse = HealthResponse

// Define client-specific types not in SDK
export interface LaunchSessionParams extends CreateSessionRequest {
  // Add any WUI-specific extensions if needed
}

export interface SessionState {
  session: LegacySession
  pending_approvals: LegacyApproval[]
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

// Legacy type mappings for gradual migration
// TODO: These legacy interfaces exist to maintain backward compatibility with the existing
// codebase that expects snake_case properties. The SDK uses camelCase (TypeScript convention)
// but the UI was built expecting snake_case from the original JSON-RPC API.
//
// Future refactor: Update all UI code to use camelCase properties directly from the SDK types,
// then remove these legacy interfaces and the transform functions in http-client.ts
export interface LegacySession {
  // Snake_case properties for backward compatibility
  id: string
  run_id: string
  query: string
  status: SessionStatus
  created_at: string
  updated_at: string
  summary: string
  parent_session_id?: string
  claude_session_id?: string
  auto_accept_edits: boolean
  archived: boolean
  // Additional legacy fields
  start_time: string
  last_activity_at: string
  end_time?: string
  error?: string
  working_dir?: string
  title?: string
  model?: string
  provider?: string
  temperature?: number
  max_tokens?: number
  stop_sequences?: string[]
  top_p?: number
  top_k?: number
  metadata?: any
  cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface LegacyApproval {
  // Snake_case properties for backward compatibility
  id: string
  session_id: string
  run_id: string
  status: ApprovalStatus
  tool_name: string
  tool_input?: any
  tool_parameters?: any
  created_at: string
  responded_at?: string
  resolved_at?: string
  comment?: string
  resolution?: {
    decision: string
    comment?: string
    resolved_by?: string
  }
}

export interface LegacyConversationEvent {
  // Snake_case properties for backward compatibility
  id?: number
  session_id?: string
  claude_session_id?: string
  sequence?: number
  event_type: ConversationEventType
  created_at?: string
  role?: ConversationRole
  content?: string
  tool_id?: string
  tool_name?: string
  tool_input_json?: string
  tool_result_for_id?: string
  tool_result_content?: string
  is_completed?: boolean
  approval_status?: ApprovalStatus | null
  approval_id?: string
  parent_tool_use_id?: string
  // For compatibility with SDK format
  type?: string
  data?: any
  timestamp?: string
}

// Client interface using legacy types for backward compatibility
export interface DaemonClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  health(): Promise<HealthCheckResponse>

  // Session methods (returning legacy types)
  launchSession(params: LaunchSessionParams | LaunchSessionRequest): Promise<LegacySession>
  listSessions(): Promise<LegacySession[]>
  getSessionLeaves(request?: {
    include_archived?: boolean
    archived_only?: boolean
  }): Promise<{ sessions: LegacySession[] }>
  getSessionState(sessionId: string): Promise<SessionState>
  continueSession(
    sessionId: string,
    message: string,
  ): Promise<{ success: boolean; new_session_id?: string }>
  interruptSession(sessionId: string): Promise<{ success: boolean }>
  updateSessionSettings(
    sessionId: string,
    settings: { auto_accept_edits?: boolean },
  ): Promise<{ success: boolean }>
  archiveSession(
    sessionIdOrRequest: string | { session_id: string; archived: boolean },
  ): Promise<{ success: boolean }>
  bulkArchiveSessions(
    sessionIdsOrRequest: string[] | { session_ids: string[]; archived: boolean },
  ): Promise<{ success: boolean; archived_count: number }>
  updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }>

  // Conversation methods (returning legacy types)
  getConversation(params: {
    session_id?: string
    claude_session_id?: string
  }): Promise<LegacyConversationEvent[]>
  getSessionSnapshots(sessionId: string): Promise<SessionSnapshot[]>

  // Approval methods (returning legacy types)
  fetchApprovals(sessionId?: string): Promise<LegacyApproval[]>
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
  getRecentPaths(limit?: number): Promise<string[]>
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
}

export interface LaunchSessionResponse {
  session_id: string
  run_id: string
}

export interface SessionInfo {
  id: string
  run_id: string
  claude_session_id?: string
  parent_session_id?: string
  status: SessionStatus
  start_time: string
  end_time?: string
  last_activity_at: string
  error?: string
  query: string
  summary: string
  title?: string
  model?: string
  working_dir?: string
  result?: any
  auto_accept_edits: boolean
  archived?: boolean
}

export interface ListSessionsResponse {
  sessions: SessionInfo[]
}

export interface GetSessionLeavesRequest {
  include_archived?: boolean
  archived_only?: boolean
}

export interface GetSessionLeavesResponse {
  sessions: SessionInfo[]
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
  old_status: string
  new_status: string
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

// Recent paths types
export interface RecentPath {
  path: string
  last_used: string
  usage_count: number
}

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
