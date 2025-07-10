use crate::daemon_client::{
    connection::Connection,
    error::{Error, Result},
    subscriptions::SubscriptionManager,
    types::*,
};
use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::debug;

#[async_trait]
pub trait DaemonClientTrait: Send + Sync {
    async fn health(&self) -> Result<HealthCheckResponse>;
    async fn launch_session(&self, req: LaunchSessionRequest) -> Result<LaunchSessionResponse>;
    async fn list_sessions(&self) -> Result<ListSessionsResponse>;
    async fn get_session_leaves(&self) -> Result<GetSessionLeavesResponse>;
    async fn continue_session(&self, req: ContinueSessionRequest) -> Result<ContinueSessionResponse>;
    async fn get_session_state(&self, session_id: &str) -> Result<GetSessionStateResponse>;
    async fn get_conversation(
        &self,
        session_id: Option<&str>,
        claude_session_id: Option<&str>,
    ) -> Result<GetConversationResponse>;
    async fn fetch_approvals(&self, session_id: Option<&str>) -> Result<FetchApprovalsResponse>;
    async fn send_decision(
        &self,
        call_id: &str,
        approval_type: ApprovalType,
        decision: Decision,
        comment: Option<&str>,
    ) -> Result<SendDecisionResponse>;
    async fn approve_function_call(&self, call_id: &str, comment: Option<&str>) -> Result<()>;
    async fn deny_function_call(&self, call_id: &str, reason: &str) -> Result<()>;
    async fn respond_to_human_contact(&self, call_id: &str, response: &str) -> Result<()>;
    async fn subscribe(
        &self,
        req: SubscribeRequest,
    ) -> Result<(u64, tokio::sync::mpsc::Receiver<EventNotification>)>;
    async fn unsubscribe(&self, subscription_id: u64) -> Result<()>;
    async fn interrupt_session(&self, session_id: &str) -> Result<()>;
    async fn get_recent_paths(&self, limit: Option<i32>) -> Result<GetRecentPathsResponse>;
}

pub struct DaemonClient {
    connection: Arc<RwLock<Connection>>,
    subscription_manager: Arc<SubscriptionManager>,
    request_id: AtomicU64,
}

impl DaemonClient {
    /// Create a new daemon client
    pub async fn new(socket_path: Option<PathBuf>) -> Result<Self> {
        let connection = Connection::new(socket_path).await?;
        let subscription_manager = Arc::new(SubscriptionManager::new());

        Ok(DaemonClient {
            connection: Arc::new(RwLock::new(connection)),
            subscription_manager,
            request_id: AtomicU64::new(1),
        })
    }

    /// Connect with retries
    pub async fn connect_with_retries(
        socket_path: Option<PathBuf>,
        max_retries: u32,
    ) -> Result<Self> {
        let connection = Connection::connect_with_retries(socket_path, max_retries).await?;
        let subscription_manager = Arc::new(SubscriptionManager::new());

        Ok(DaemonClient {
            connection: Arc::new(RwLock::new(connection)),
            subscription_manager,
            request_id: AtomicU64::new(1),
        })
    }

    /// Send a JSON-RPC request and get the response
    async fn send_rpc_request<P, R>(&self, method: &str, params: Option<P>) -> Result<R>
    where
        P: serde::Serialize,
        R: serde::de::DeserializeOwned,
    {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params: params.map(|p| serde_json::to_value(p).unwrap_or(Value::Null)),
            id,
        };

        let request_str = serde_json::to_string(&request)?;
        debug!("Sending RPC request: {}", request_str);

        let connection = self.connection.read().await;
        let response_str = connection.send_request(&request_str).await?;
        debug!("Received RPC response: {}", response_str);

        let response: JsonRpcResponse = serde_json::from_str(&response_str)?;

        if let Some(error) = response.error {
            return Err(Error::Rpc {
                code: error.code,
                message: error.message,
            });
        }

        if let Some(result) = response.result {
            serde_json::from_value(result)
                .map_err(|e| Error::InvalidResponse(format!("Failed to parse result: {}", e)))
        } else {
            Err(Error::InvalidResponse("No result in response".to_string()))
        }
    }

    /// Check if the client is connected
    pub async fn is_connected(&self) -> bool {
        let connection = self.connection.read().await;
        connection.is_alive().await
    }

    /// Reconnect to the daemon
    pub async fn reconnect(&self) -> Result<()> {
        let mut connection = self.connection.write().await;
        connection.reconnect().await
    }
}

#[async_trait]
impl DaemonClientTrait for DaemonClient {
    async fn health(&self) -> Result<HealthCheckResponse> {
        self.send_rpc_request("health", None::<()>).await
    }

    async fn launch_session(&self, req: LaunchSessionRequest) -> Result<LaunchSessionResponse> {
        self.send_rpc_request("launchSession", Some(req)).await
    }

    async fn list_sessions(&self) -> Result<ListSessionsResponse> {
        self.send_rpc_request("listSessions", None::<()>).await
    }

    async fn get_session_leaves(&self) -> Result<GetSessionLeavesResponse> {
        self.send_rpc_request("getSessionLeaves", None::<()>).await
    }

    async fn continue_session(&self, req: ContinueSessionRequest) -> Result<ContinueSessionResponse> {
        self.send_rpc_request("continueSession", Some(req)).await
    }

    async fn get_session_state(&self, session_id: &str) -> Result<GetSessionStateResponse> {
        let req = GetSessionStateRequest {
            session_id: session_id.to_string(),
        };
        self.send_rpc_request("getSessionState", Some(req)).await
    }

    async fn get_conversation(
        &self,
        session_id: Option<&str>,
        claude_session_id: Option<&str>,
    ) -> Result<GetConversationResponse> {
        if session_id.is_none() && claude_session_id.is_none() {
            return Err(Error::Protocol(
                "Either session_id or claude_session_id is required".to_string(),
            ));
        }

        let req = GetConversationRequest {
            session_id: session_id.map(|s| s.to_string()),
            claude_session_id: claude_session_id.map(|s| s.to_string()),
        };
        self.send_rpc_request("getConversation", Some(req)).await
    }

    async fn fetch_approvals(&self, session_id: Option<&str>) -> Result<FetchApprovalsResponse> {
        let req = FetchApprovalsRequest {
            session_id: session_id.map(|s| s.to_string()),
        };
        self.send_rpc_request("fetchApprovals", Some(req)).await
    }

    async fn send_decision(
        &self,
        call_id: &str,
        approval_type: ApprovalType,
        decision: Decision,
        comment: Option<&str>,
    ) -> Result<SendDecisionResponse> {
        // Validate decision for approval type
        if !decision.is_valid_for_approval_type(approval_type.as_str()) {
            return Err(Error::Approval(format!(
                "Invalid decision '{}' for approval type '{}'",
                decision.as_str(),
                approval_type.as_str()
            )));
        }

        let req = SendDecisionRequest {
            call_id: call_id.to_string(),
            approval_type: approval_type.as_str().to_string(),
            decision: decision.as_str().to_string(),
            comment: comment.map(|s| s.to_string()),
        };

        self.send_rpc_request("sendDecision", Some(req)).await
    }

    async fn approve_function_call(&self, call_id: &str, comment: Option<&str>) -> Result<()> {
        let response = self
            .send_decision(
                call_id,
                ApprovalType::FunctionCall,
                Decision::Approve,
                comment,
            )
            .await?;

        if !response.success {
            return Err(Error::Approval(
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        Ok(())
    }

    async fn deny_function_call(&self, call_id: &str, reason: &str) -> Result<()> {
        let response = self
            .send_decision(
                call_id,
                ApprovalType::FunctionCall,
                Decision::Deny,
                Some(reason),
            )
            .await?;

        if !response.success {
            return Err(Error::Approval(
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        Ok(())
    }

    async fn respond_to_human_contact(&self, call_id: &str, response: &str) -> Result<()> {
        let resp = self
            .send_decision(
                call_id,
                ApprovalType::HumanContact,
                Decision::Respond,
                Some(response),
            )
            .await?;

        if !resp.success {
            return Err(Error::Approval(
                resp.error.unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        Ok(())
    }

    async fn subscribe(
        &self,
        req: SubscribeRequest,
    ) -> Result<(u64, tokio::sync::mpsc::Receiver<EventNotification>)> {
        let connection = self.connection.read().await;
        let sub_stream = connection.create_subscription_connection().await?;

        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let receiver = self
            .subscription_manager
            .create_subscription(id, sub_stream, req)
            .await?;

        Ok((id, receiver))
    }

    async fn unsubscribe(&self, subscription_id: u64) -> Result<()> {
        self.subscription_manager
            .cancel_subscription(subscription_id)
            .await;
        Ok(())
    }

    async fn interrupt_session(&self, session_id: &str) -> Result<()> {
        let req = InterruptSessionRequest {
            session_id: session_id.to_string(),
        };
        let response: InterruptSessionResponse =
            self.send_rpc_request("interruptSession", Some(req)).await?;

        if !response.success {
            return Err(Error::Session(format!(
                "Failed to interrupt session {}",
                session_id
            )));
        }

        Ok(())
    }

    async fn get_recent_paths(&self, limit: Option<i32>) -> Result<GetRecentPathsResponse> {
        let req = GetRecentPathsRequest { limit };
        self.send_rpc_request("getRecentPaths", Some(req)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decision_validation() {
        assert!(Decision::Approve.is_valid_for_approval_type("function_call"));
        assert!(Decision::Deny.is_valid_for_approval_type("function_call"));
        assert!(!Decision::Respond.is_valid_for_approval_type("function_call"));

        assert!(Decision::Respond.is_valid_for_approval_type("human_contact"));
        assert!(!Decision::Approve.is_valid_for_approval_type("human_contact"));
        assert!(!Decision::Deny.is_valid_for_approval_type("human_contact"));
    }
}
