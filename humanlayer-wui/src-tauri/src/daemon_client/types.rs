use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// JSON-RPC types
#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<Value>,
    pub id: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    pub id: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

// Health check types
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthCheckRequest {}

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthCheckResponse {
    pub status: String,
    pub version: String,
}

// Session types
#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchSessionRequest {
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_prompt_tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verbose: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchSessionResponse {
    pub session_id: String,
    pub run_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InterruptSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InterruptSessionResponse {
    pub success: bool,
    pub session_id: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListSessionsRequest {}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListSessionsResponse {
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionLeavesRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_only: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionLeavesResponse {
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    pub status: SessionStatus,
    pub start_time: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<DateTime<Utc>>,
    pub last_activity_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub query: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Starting,
    Running,
    Completed,
    Failed,
    WaitingInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionStateRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionStateResponse {
    pub session: SessionState,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionState {
    pub id: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    pub status: String,
    pub query: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    pub created_at: String,
    pub last_activity_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_accept_edits: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContinueSessionRequest {
    pub session_id: String,
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub append_system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_config: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_prompt_tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContinueSessionResponse {
    pub session_id: String,
    pub run_id: String,
    pub claude_session_id: String,
    pub parent_session_id: String,
}

// Conversation types
#[derive(Debug, Serialize, Deserialize)]
pub struct GetConversationRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetConversationResponse {
    pub events: Vec<ConversationEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationEvent {
    pub id: i64,
    pub session_id: String,
    pub claude_session_id: String,
    pub sequence: i32,
    pub event_type: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result_for_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result_content: Option<String>,
    pub is_completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
}

// Approval types
#[derive(Debug, Serialize, Deserialize)]
pub struct FetchApprovalsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchApprovalsResponse {
    pub approvals: Vec<Approval>,
}

// Local approval format (as stored in daemon)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Approval {
    pub id: String,
    pub run_id: String,
    pub session_id: String,
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub responded_at: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendDecisionRequest {
    pub approval_id: String,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendDecisionResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// Subscription types
#[derive(Debug, Serialize, Deserialize)]
pub struct SubscribeRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscribeResponse {
    pub subscription_id: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EventNotification {
    pub event: Event,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Event {
    #[serde(rename = "type")]
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub data: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Heartbeat {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub message: String,
}

// Decision types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Approve,
    Deny,
}

impl Decision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Decision::Approve => "approve",
            Decision::Deny => "deny",
        }
    }
}


// Session settings types
#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSessionSettingsRequest {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_accept_edits: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSessionSettingsResponse {
    pub success: bool,
}

// Recent paths types
#[derive(Debug, Serialize, Deserialize)]
pub struct GetRecentPathsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetRecentPathsResponse {
    pub paths: Vec<RecentPath>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentPath {
    pub path: String,
    pub last_used: String,
    pub usage_count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArchiveSessionRequest {
    pub session_id: String,
    pub archived: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArchiveSessionResponse {
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkArchiveSessionsRequest {
    pub session_ids: Vec<String>,
    pub archived: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkArchiveSessionsResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_sessions: Option<Vec<String>>,
}

// Snapshot types
#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionSnapshotsRequest {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetSessionSnapshotsResponse {
    pub snapshots: Vec<FileSnapshotInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSnapshotInfo {
    pub tool_id: String,
    pub file_path: String,
    pub content: String,
    pub created_at: String,  // ISO 8601 format
}
