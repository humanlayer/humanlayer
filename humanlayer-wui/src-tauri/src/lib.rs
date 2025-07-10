mod daemon_client;

use daemon_client::client::{DaemonClient, DaemonClientTrait};
use std::sync::Arc;
use tauri::{Emitter, State};
use tokio::sync::Mutex;
use tracing::error;

// App state to hold the daemon client
struct AppState {
    client: Arc<Mutex<Option<DaemonClient>>>,
}

// Tauri commands
#[tauri::command]
async fn connect_daemon(state: State<'_, AppState>) -> std::result::Result<String, String> {
    let mut client_guard = state.client.lock().await;

    match DaemonClient::connect_with_retries(None, 3).await {
        Ok(client) => {
            *client_guard = Some(client);
            Ok("Connected to daemon".to_string())
        }
        Err(e) => {
            error!("Failed to connect to daemon: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
async fn daemon_health(
    state: State<'_, AppState>,
) -> std::result::Result<daemon_client::HealthCheckResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client.health().await.map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn launch_session(
    state: State<'_, AppState>,
    request: daemon_client::LaunchSessionRequest,
) -> std::result::Result<daemon_client::LaunchSessionResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .launch_session(request)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn list_sessions(
    state: State<'_, AppState>,
) -> std::result::Result<daemon_client::ListSessionsResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client.list_sessions().await.map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn get_session_leaves(
    state: State<'_, AppState>,
) -> std::result::Result<daemon_client::GetSessionLeavesResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .get_session_leaves()
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn get_session_state(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<daemon_client::GetSessionStateResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .get_session_state(&session_id)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn continue_session(
    state: State<'_, AppState>,
    request: daemon_client::ContinueSessionRequest,
) -> std::result::Result<daemon_client::ContinueSessionResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .continue_session(request)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn get_conversation(
    state: State<'_, AppState>,
    session_id: Option<String>,
    claude_session_id: Option<String>,
) -> std::result::Result<daemon_client::GetConversationResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .get_conversation(session_id.as_deref(), claude_session_id.as_deref())
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn fetch_approvals(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> std::result::Result<daemon_client::FetchApprovalsResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .fetch_approvals(session_id.as_deref())
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn approve_function_call(
    state: State<'_, AppState>,
    call_id: String,
    comment: Option<String>,
) -> std::result::Result<(), String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .approve_function_call(&call_id, comment.as_deref())
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn deny_function_call(
    state: State<'_, AppState>,
    call_id: String,
    reason: String,
) -> std::result::Result<(), String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .deny_function_call(&call_id, &reason)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn respond_to_human_contact(
    state: State<'_, AppState>,
    call_id: String,
    response: String,
) -> std::result::Result<(), String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .respond_to_human_contact(&call_id, &response)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

// Subscribe command will be handled differently since it returns a stream
#[tauri::command]
async fn subscribe_to_events(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: daemon_client::SubscribeRequest,
) -> std::result::Result<String, String> {
    tracing::info!("subscribe_to_events: Starting subscription request");
    tracing::info!(
        "subscribe_to_events: Request params - event_types: {:?}, session_id: {:?}, run_id: {:?}",
        request.event_types,
        request.session_id,
        request.run_id
    );

    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => {
            tracing::info!("subscribe_to_events: Client found, attempting to subscribe");
            match client.subscribe(request).await {
                Ok((subscription_id, mut receiver)) => {
                    tracing::info!("subscribe_to_events: Subscription created successfully with ID {}, spawning event forwarder", subscription_id);
                    // Spawn a task to forward events to the frontend
                    tokio::spawn(async move {
                        tracing::info!(
                            "subscribe_to_events: Event forwarder task started for subscription {}",
                            subscription_id
                        );
                        while let Some(event) = receiver.recv().await {
                            tracing::info!(
                                "subscribe_to_events: Subscription {} received event - type: {:?}, data: {:?}",
                                subscription_id,
                                event.event.event_type,
                                event.event.data
                            );
                            // Emit the event to the frontend
                            if let Err(e) = app.emit("daemon-event", event) {
                                error!(
                                    "Failed to emit event for subscription {}: {}",
                                    subscription_id, e
                                );
                            } else {
                                tracing::info!("subscribe_to_events: Event emitted to frontend successfully for subscription {}", subscription_id);
                            }
                        }
                        tracing::warn!("subscribe_to_events: Event receiver channel closed for subscription {}", subscription_id);
                    });
                    tracing::info!(
                        "subscribe_to_events: Subscription {} setup completed successfully",
                        subscription_id
                    );
                    Ok(subscription_id.to_string())
                }
                Err(e) => {
                    tracing::error!("subscribe_to_events: Failed to create subscription - {}", e);
                    Err(e.to_string())
                }
            }
        }
        None => {
            tracing::error!("subscribe_to_events: No daemon client connected");
            Err("Not connected to daemon".to_string())
        }
    }
}

#[tauri::command]
async fn unsubscribe_from_events(
    state: State<'_, AppState>,
    subscription_id: String,
) -> std::result::Result<(), String> {
    tracing::info!(
        "unsubscribe_from_events: Unsubscribing from subscription {}",
        subscription_id
    );

    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => {
            // Parse the subscription ID
            let id = subscription_id
                .parse::<u64>()
                .map_err(|e| format!("Invalid subscription ID: {}", e))?;

            client.unsubscribe(id).await.map_err(|e| e.to_string())?;
            tracing::info!(
                "unsubscribe_from_events: Successfully unsubscribed from subscription {}",
                id
            );
            Ok(())
        }
        None => {
            tracing::error!("unsubscribe_from_events: No daemon client connected");
            Err("Not connected to daemon".to_string())
        }
    }
}

#[tauri::command]
async fn interrupt_session(
    state: State<'_, AppState>,
    session_id: String,
) -> std::result::Result<(), String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .interrupt_session(&session_id)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[tauri::command]
async fn get_recent_paths(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> std::result::Result<daemon_client::GetRecentPathsResponse, String> {
    let client_guard = state.client.lock().await;

    match &*client_guard {
        Some(client) => client
            .get_recent_paths(limit)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            client: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            connect_daemon,
            daemon_health,
            launch_session,
            list_sessions,
            get_session_leaves,
            get_session_state,
            continue_session,
            get_conversation,
            fetch_approvals,
            approve_function_call,
            deny_function_call,
            respond_to_human_contact,
            subscribe_to_events,
            unsubscribe_from_events,
            interrupt_session,
            get_recent_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
