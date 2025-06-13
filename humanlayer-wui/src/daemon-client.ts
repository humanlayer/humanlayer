import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Type definitions matching the Rust types
export interface HealthCheckResponse {
  status: string;
  version: string;
}

export interface LaunchSessionRequest {
  query: string;
  model?: string;
  mcp_config?: any;
  permission_prompt_tool?: string;
  working_dir?: string;
  max_turns?: number;
  system_prompt?: string;
  append_system_prompt?: string;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  custom_instructions?: string;
  verbose?: boolean;
}

export interface LaunchSessionResponse {
  session_id: string;
  run_id: string;
}

export interface SessionInfo {
  id: string;
  run_id: string;
  claude_session_id?: string;
  parent_session_id?: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'waiting_input';
  start_time: string;
  end_time?: string;
  last_activity_at: string;
  error?: string;
  query: string;
  model?: string;
  working_dir?: string;
  result?: any;
}

export interface ListSessionsResponse {
  sessions: SessionInfo[];
}

export interface PendingApproval {
  type: 'function_call' | 'human_contact';
  function_call?: any;
  human_contact?: any;
}

export interface FetchApprovalsResponse {
  approvals: PendingApproval[];
}

export interface EventNotification {
  event: {
    type: string;
    timestamp: string;
    data: any;
  };
}

// Daemon client API
export class DaemonClient {
  private connected = false;

  async connect(): Promise<void> {
    await invoke('connect_daemon');
    this.connected = true;
  }

  async health(): Promise<HealthCheckResponse> {
    return await invoke('daemon_health');
  }

  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResponse> {
    return await invoke('launch_session', { request });
  }

  async listSessions(): Promise<ListSessionsResponse> {
    return await invoke('list_sessions');
  }

  async getSessionState(sessionId: string) {
    return await invoke('get_session_state', { sessionId });
  }

  async continueSession(request: any) {
    return await invoke('continue_session', { request });
  }

  async getConversation(sessionId?: string, claudeSessionId?: string) {
    return await invoke('get_conversation', { sessionId, claudeSessionId });
  }

  async fetchApprovals(sessionId?: string): Promise<FetchApprovalsResponse> {
    return await invoke('fetch_approvals', { sessionId });
  }

  async approveFunctionCall(callId: string, comment?: string): Promise<void> {
    return await invoke('approve_function_call', { callId, comment });
  }

  async denyFunctionCall(callId: string, reason: string): Promise<void> {
    return await invoke('deny_function_call', { callId, reason });
  }

  async respondToHumanContact(callId: string, response: string): Promise<void> {
    return await invoke('respond_to_human_contact', { callId, response });
  }

  async subscribeToEvents(request: {
    event_types?: string[];
    session_id?: string;
    run_id?: string;
  }): Promise<() => void> {
    await invoke('subscribe_to_events', { request });
    
    // Return unsubscribe function
    const unlisten = await listen<EventNotification>('daemon-event', (event) => {
      console.log('Received daemon event:', event.payload);
    });
    
    return unlisten;
  }
}

// Export a singleton instance
export const daemonClient = new DaemonClient();