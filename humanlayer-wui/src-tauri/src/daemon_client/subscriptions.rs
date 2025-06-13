use crate::daemon_client::{error::Result, types::*};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{interval, Duration};
use tracing::{debug, error, info, warn};

const CHANNEL_BUFFER_SIZE: usize = 100;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

pub struct SubscriptionManager {
    active_subscriptions: Arc<Mutex<HashMap<u64, mpsc::Sender<()>>>>,
}

impl SubscriptionManager {
    pub fn new() -> Self {
        SubscriptionManager {
            active_subscriptions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new subscription
    pub async fn create_subscription(
        &self,
        id: u64,
        stream: UnixStream,
        req: SubscribeRequest,
    ) -> Result<mpsc::Receiver<EventNotification>> {
        let (event_tx, event_rx) = mpsc::channel(CHANNEL_BUFFER_SIZE);
        let (cancel_tx, cancel_rx) = mpsc::channel(1);
        
        // Store the cancel sender
        {
            let mut subs = self.active_subscriptions.lock().await;
            subs.insert(id, cancel_tx);
        }
        
        // Send the subscription request
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: "Subscribe".to_string(),
            params: Some(serde_json::to_value(req)?),
            id,
        };
        
        let request_str = serde_json::to_string(&request)?;
        
        // Clone for the async task
        let active_subscriptions = self.active_subscriptions.clone();
        
        // Spawn the subscription handler
        tokio::spawn(async move {
            if let Err(e) = handle_subscription(
                id,
                stream,
                request_str,
                event_tx,
                cancel_rx,
                active_subscriptions,
            )
            .await
            {
                error!("Subscription {} error: {}", id, e);
            }
        });
        
        Ok(event_rx)
    }

    /// Cancel a subscription
    pub async fn cancel_subscription(&self, id: u64) {
        let mut subs = self.active_subscriptions.lock().await;
        if let Some(cancel_tx) = subs.remove(&id) {
            let _ = cancel_tx.send(()).await;
            info!("Cancelled subscription {}", id);
        }
    }

    /// Cancel all active subscriptions
    pub async fn cancel_all(&self) {
        let mut subs = self.active_subscriptions.lock().await;
        for (id, cancel_tx) in subs.drain() {
            let _ = cancel_tx.send(()).await;
            info!("Cancelled subscription {}", id);
        }
    }
}

async fn handle_subscription(
    id: u64,
    mut stream: UnixStream,
    request_str: String,
    event_tx: mpsc::Sender<EventNotification>,
    mut cancel_rx: mpsc::Receiver<()>,
    active_subscriptions: Arc<Mutex<HashMap<u64, mpsc::Sender<()>>>>,
) -> Result<()> {
    // Send the subscription request
    stream
        .write_all(format!("{}\n", request_str).as_bytes())
        .await?;
    stream.flush().await?;
    
    let mut reader = BufReader::new(&mut stream);
    let mut line = String::new();
    let mut subscription_confirmed = false;
    
    // Create a heartbeat interval
    let mut heartbeat_interval = interval(HEARTBEAT_INTERVAL);
    heartbeat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    
    loop {
        tokio::select! {
            // Handle incoming messages
            result = reader.read_line(&mut line) => {
                match result {
                    Ok(0) => {
                        info!("Subscription {} connection closed", id);
                        break;
                    }
                    Ok(_) => {
                        // Remove trailing newline
                        if line.ends_with('\n') {
                            line.pop();
                        }
                        
                        debug!("Subscription {} received: {}", id, line);
                        
                        // Try to parse as JSON-RPC response first (for initial confirmation)
                        if !subscription_confirmed {
                            if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                                if response.error.is_some() {
                                    error!("Subscription {} error: {:?}", id, response.error);
                                    break;
                                }
                                
                                if let Some(result) = response.result {
                                    if let Ok(sub_response) = serde_json::from_value::<SubscribeResponse>(result) {
                                        info!(
                                            "Subscription {} confirmed: {}",
                                            id, sub_response.message
                                        );
                                        subscription_confirmed = true;
                                    }
                                }
                            }
                        } else {
                            // Handle event notifications
                            if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                                // Check if it's a heartbeat
                                if let Some(msg_type) = msg.get("type") {
                                    if msg_type == "heartbeat" {
                                        debug!("Subscription {} received heartbeat", id);
                                    } else {
                                        // It's an event notification
                                        if let Ok(notification) = serde_json::from_value::<EventNotification>(msg) {
                                            if event_tx.send(notification).await.is_err() {
                                                info!("Subscription {} receiver dropped", id);
                                                break;
                                            }
                                        } else {
                                            warn!("Subscription {} received unknown message: {}", id, line);
                                        }
                                    }
                                }
                            }
                        }
                        
                        line.clear();
                    }
                    Err(e) => {
                        error!("Subscription {} read error: {}", id, e);
                        break;
                    }
                }
            }
            
            // Handle cancellation
            _ = cancel_rx.recv() => {
                info!("Subscription {} cancelled", id);
                break;
            }
            
            // Handle heartbeat interval (for logging/monitoring)
            _ = heartbeat_interval.tick() => {
                debug!("Subscription {} still active", id);
            }
        }
    }
    
    // Clean up
    {
        let mut subs = active_subscriptions.lock().await;
        subs.remove(&id);
    }
    
    info!("Subscription {} handler terminated", id);
    Ok(())
}

impl Drop for SubscriptionManager {
    fn drop(&mut self) {
        // Cancel all subscriptions when the manager is dropped
        let active_subs = self.active_subscriptions.clone();
        tokio::spawn(async move {
            let mut subs = active_subs.lock().await;
            for (id, cancel_tx) in subs.drain() {
                let _ = cancel_tx.send(()).await;
                debug!("Cancelled subscription {} on drop", id);
            }
        });
    }
}