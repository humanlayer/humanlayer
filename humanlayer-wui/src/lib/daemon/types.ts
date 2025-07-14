// Enums

export enum SessionStatus {
  Starting = 'starting',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  WaitingInput = 'waiting_input',
  Completing = 'completing',
}

export enum ApprovalType {
  FunctionCall = 'function_call',
  HumanContact = 'human_contact',
}

export enum Decision {
  Approve = 'approve',
  Deny = 'deny',
  Respond = 'respond',
}

export enum ConversationEventType {
  Message = 'message',
  ToolCall = 'tool_call',
  ToolResult = 'tool_result',
  System = 'system',
}

export enum ConversationRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export enum ApprovalStatus {
  Pending = 'pending',
  Approved = 'approved',
  Denied = 'denied',
  Resolved = 'resolved',
}

export enum ViewMode {
  Normal = 'normal',
  Archived = 'archived',
}

// Type definitions matching the Rust types
export interface HealthCheckResponse {
  status: string
  version: string
}

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
  model?: string
  working_dir?: string
  result?: any
  auto_accept_edits: boolean
  archived?: boolean
}

export interface SessionState {
  id: string
  run_id: string
  claude_session_id?: string
  parent_session_id?: string
  status: string // Protocol returns string, not enum
  query: string
  summary: string
  model?: string
  working_dir?: string
  created_at: string
  last_activity_at: string
  completed_at?: string
  error_message?: string
  cost_usd?: number
  total_tokens?: number
  duration_ms?: number
  auto_accept_edits?: boolean
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

// Function call types
export interface FunctionCallSpec {
  fn: string
  kwargs: Record<string, any>
  channel?: ContactChannel
  reject_options?: ResponseOption[]
  state?: Record<string, any>
}

export interface FunctionCallStatus {
  requested_at?: string
  responded_at?: string
  approved?: boolean
  comment?: string
  user_info?: Record<string, any>
  reject_option_name?: string
}

export interface FunctionCall {
  run_id: string
  call_id: string
  spec: FunctionCallSpec
  status?: FunctionCallStatus
}

// Human contact types
export interface HumanContactSpec {
  msg: string
  subject?: string
  channel?: ContactChannel
  response_options?: ResponseOption[]
  state?: Record<string, any>
}

export interface HumanContactStatus {
  requested_at?: string
  responded_at?: string
  response?: string
  response_option_name?: string
}

export interface HumanContact {
  run_id: string
  call_id: string
  spec: HumanContactSpec
  status?: HumanContactStatus
}

export interface PendingApproval {
  type: ApprovalType
  function_call?: FunctionCall
  human_contact?: HumanContact
}

export interface FetchApprovalsResponse {
  approvals: PendingApproval[]
}

// Event types
export interface Event {
  type: string
  timestamp: string
  data: any
}

export interface EventNotification {
  event: Event
}

// Event-specific data types
export interface NewApprovalEventData {
  approval: PendingApproval
}

// Alias for backwards compatibility (to be removed)
export type ApprovalRequestedEventData = NewApprovalEventData

export interface ApprovalResolvedEventData {
  call_id: string
  type: ApprovalType
  decision: Decision
  comment?: string
}

export interface SessionStatusChangedEventData {
  session_id: string
  old_status: string
  new_status: string
}

// Conversation types
export interface ConversationEvent {
  id: number
  session_id: string
  claude_session_id: string
  sequence: number
  event_type: ConversationEventType
  created_at: string
  role?: ConversationRole
  content?: string
  tool_id?: string
  tool_name?: string
  tool_input_json?: string
  tool_result_for_id?: string
  tool_result_content?: string
  is_completed: boolean
  approval_status?: ApprovalStatus | null
  approval_id?: string
  parent_tool_use_id?: string
}

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
  call_id: string
  type: ApprovalType
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
