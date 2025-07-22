/**
 * Type definitions for JSON-RPC communication with the HumanLayer daemon
 * This file provides comprehensive type safety for all RPC methods
 */

// Session Status Types
export type SessionStatus = 'running' | 'completed' | 'failed' | 'interrupted' | 'archived'

// Model Types
export type Model = 'opus' | 'sonnet' | 'haiku'

// Session Types
export interface Session {
  id: string
  run_id: string
  claude_session_id?: string
  parent_session_id?: string
  query: string
  summary: string
  title: string
  model: string
  working_dir: string
  max_turns: number
  status: SessionStatus
  created_at: string
  last_activity_at: string
  completed_at?: string
}

export interface SessionLeaf {
  id: string
  title: string
  created_at: string
  last_activity_at: string
  status: string
}

// MCP Configuration Types
export interface MCPServer {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServer>
}

// Launch Session Types
export interface LaunchSessionRequest {
  query: string
  model?: Model
  working_dir?: string
  max_turns?: number
  permission_prompt_tool?: string
  system_prompt?: string
  append_system_prompt?: string
  resume_session_id?: string
  mcp_config?: MCPConfig
  forbidden_paths?: string[]
  allowed_tools?: string[]
  disallowed_tools?: string[]
  custom_instructions?: string
}

export interface LaunchSessionResponse {
  session_id: string
  run_id: string
  claude_session_id?: string
}

// Continue Session Types
export interface ContinueSessionRequest {
  query: string
  session_id: string
  model?: Model
  max_turns?: number
  working_dir?: string
}

export interface ContinueSessionResponse {
  session_id: string
  run_id: string
  claude_session_id?: string
}

// Approval Types
export interface ToolInput {
  [key: string]: unknown // This can be refined based on specific tools
}

export interface Approval {
  id: string
  session_id: string
  run_id: string
  tool_name: string
  tool_input: ToolInput
  function_name?: string
  created_at: string
  resolved_at?: string
  approved?: boolean
  response_text?: string
  user_id?: string
  user_email?: string
}

export interface CreateApprovalRequest {
  tool_name: string
  tool_input: ToolInput
  function_name?: string
  user_id?: string
  user_email?: string
}

export interface CreateApprovalResponse {
  id: string
}

export interface UpdateApprovalRequest {
  id: string
  approved: boolean
  response_text?: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UpdateApprovalResponse {
  // Empty response
}

export interface GetApprovalRequest {
  id: string
}

export type GetApprovalResponse = Approval

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ListApprovalsRequest {
  // Empty request
}

export interface ListApprovalsResponse {
  approvals: Approval[]
}

// Conversation Types
export interface Message {
  id: string
  type: 'human' | 'assistant' | 'system'
  content: string
  timestamp: string
}

export interface Snapshot {
  id: string
  title: string
  timestamp: string
  message_count: number
}

export interface Conversation {
  session_id: string
  messages: Message[]
  snapshots: Snapshot[]
}

export interface GetConversationRequest {
  session_id: string
}

export type GetConversationResponse = Conversation

// Session Management Types
export interface GetSessionRequest {
  id: string
}

export type GetSessionResponse = Session

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ListSessionsRequest {
  // Empty request
}

export interface ListSessionsResponse {
  sessions: Session[]
}

export interface GetSessionLeavesRequest {
  parent_session_id: string
}

export interface GetSessionLeavesResponse {
  leaves: SessionLeaf[]
}

export interface ArchiveSessionRequest {
  id: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ArchiveSessionResponse {
  // Empty response
}

export interface InterruptSessionRequest {
  id: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterruptSessionResponse {
  // Empty response
}

// Subscription Types
export interface SubscribeRequest {
  event_types: EventType[]
}

export interface SubscribeResponse {
  subscription_id: string
}

export type EventType = 'new_approval' | 'approval_resolved' | 'session_status_changed'

export interface Event {
  type: EventType
  timestamp: string
  data: EventData
}

export type EventData = NewApprovalData | ApprovalResolvedData | SessionStatusChangedData

export interface NewApprovalData {
  session_id: string
  run_id: string
  approval_id: string
  tool_name: string
}

export interface ApprovalResolvedData {
  session_id: string
  run_id: string
  approval_id: string
  approved: boolean
  response_text?: string
}

export interface SessionStatusChangedData {
  session_id: string
  old_status: string
  new_status: string
  parent_session_id?: string
}

// Result Storage Types
export interface ToolResult {
  tool_use_id: string
  content: string
  is_error: boolean
}

export interface AddToolResultRequest {
  session_id: string
  run_id: string
  tool_use_id: string
  content: string
  is_error?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AddToolResultResponse {
  // Empty response
}

export interface GetToolResultRequest {
  session_id: string
  run_id: string
  tool_use_id: string
}

export type GetToolResultResponse = ToolResult

// Health Check Types
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HealthRequest {
  // Empty request
}

export interface HealthResponse {
  status: string
}

// RPC Method Map for Type-Safe Client
export interface RPCMethods {
  health: {
    request: HealthRequest
    response: HealthResponse
  }
  launchSession: {
    request: LaunchSessionRequest
    response: LaunchSessionResponse
  }
  continueSession: {
    request: ContinueSessionRequest
    response: ContinueSessionResponse
  }
  createApproval: {
    request: CreateApprovalRequest
    response: CreateApprovalResponse
  }
  updateApproval: {
    request: UpdateApprovalRequest
    response: UpdateApprovalResponse
  }
  getApproval: {
    request: GetApprovalRequest
    response: GetApprovalResponse
  }
  listApprovals: {
    request: ListApprovalsRequest
    response: ListApprovalsResponse
  }
  getConversation: {
    request: GetConversationRequest
    response: GetConversationResponse
  }
  getSession: {
    request: GetSessionRequest
    response: GetSessionResponse
  }
  listSessions: {
    request: ListSessionsRequest
    response: ListSessionsResponse
  }
  getSessionLeaves: {
    request: GetSessionLeavesRequest
    response: GetSessionLeavesResponse
  }
  archiveSession: {
    request: ArchiveSessionRequest
    response: ArchiveSessionResponse
  }
  interruptSession: {
    request: InterruptSessionRequest
    response: InterruptSessionResponse
  }
  subscribe: {
    request: SubscribeRequest
    response: SubscribeResponse
  }
  addToolResult: {
    request: AddToolResultRequest
    response: AddToolResultResponse
  }
  getToolResult: {
    request: GetToolResultRequest
    response: GetToolResultResponse
  }
}

// JSON-RPC Types
export interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id: string | number
}

export interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0'
  result?: T
  error?: JSONRPCError
  id: string | number
}

export interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

// Type guards
export function isEvent(obj: unknown): obj is Event {
  return typeof obj === 'object' && obj !== null && 'type' in obj && 'timestamp' in obj && 'data' in obj
}

export function isNewApprovalData(data: EventData): data is NewApprovalData {
  return 'approval_id' in data && 'tool_name' in data
}

export function isApprovalResolvedData(data: EventData): data is ApprovalResolvedData {
  return 'approval_id' in data && 'approved' in data
}

export function isSessionStatusChangedData(data: EventData): data is SessionStatusChangedData {
  return 'old_status' in data && 'new_status' in data
}
