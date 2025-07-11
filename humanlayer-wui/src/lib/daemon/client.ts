import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  HealthCheckResponse,
  LaunchSessionRequest,
  LaunchSessionResponse,
  ListSessionsResponse,
  GetSessionLeavesRequest,
  GetSessionLeavesResponse,
  GetSessionStateResponse,
  ContinueSessionRequest,
  ContinueSessionResponse,
  GetConversationResponse,
  FetchApprovalsResponse,
  EventNotification,
  SubscribeRequest,
  UpdateSessionSettingsResponse,
  GetRecentPathsResponse,
  ArchiveSessionRequest,
  ArchiveSessionResponse,
  BulkArchiveSessionsRequest,
  BulkArchiveSessionsResponse,
} from './types'

export class DaemonClient {
  async connect(): Promise<void> {
    await invoke('connect_daemon')
  }

  async health(): Promise<HealthCheckResponse> {
    return await invoke('daemon_health')
  }

  async launchSession(request: LaunchSessionRequest): Promise<LaunchSessionResponse> {
    return await invoke('launch_session', { request })
  }

  async listSessions(): Promise<ListSessionsResponse> {
    return await invoke('list_sessions')
  }

  async getSessionLeaves(request?: GetSessionLeavesRequest): Promise<GetSessionLeavesResponse> {
    return await invoke('get_session_leaves', { request: request || {} })
  }

  async getSessionState(sessionId: string): Promise<GetSessionStateResponse> {
    return await invoke('get_session_state', { sessionId })
  }

  async continueSession(request: ContinueSessionRequest): Promise<ContinueSessionResponse> {
    return await invoke('continue_session', { request })
  }

  async getConversation(
    sessionId?: string,
    claudeSessionId?: string,
  ): Promise<GetConversationResponse> {
    return await invoke('get_conversation', { sessionId, claudeSessionId })
  }

  async fetchApprovals(sessionId?: string): Promise<FetchApprovalsResponse> {
    return await invoke('fetch_approvals', { sessionId })
  }

  async approveFunctionCall(callId: string, comment?: string): Promise<void> {
    return await invoke('approve_function_call', { callId, comment })
  }

  async denyFunctionCall(callId: string, reason: string): Promise<void> {
    return await invoke('deny_function_call', { callId, reason })
  }

  async respondToHumanContact(callId: string, response: string): Promise<void> {
    return await invoke('respond_to_human_contact', { callId, response })
  }

  async subscribeToEvents(
    request: SubscribeRequest,
    handlers: {
      onEvent?: (event: EventNotification) => void

      onError?: (error: Error) => void
    } = {},
  ): Promise<{ unlisten: () => void; subscriptionId: string }> {
    const subscriptionId = await invoke<string>('subscribe_to_events', { request })

    // Listen for daemon events and forward to handlers
    const unlisten = await listen<EventNotification>('daemon-event', event => {
      // console.log('subscribeToEvents()', event)
      try {
        handlers.onEvent?.(event.payload)
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    })

    return { unlisten, subscriptionId }
  }

  async unsubscribeFromEvents(subscriptionId: string): Promise<void> {
    await invoke('unsubscribe_from_events', { subscriptionId })
  }

  async interruptSession(sessionId: string): Promise<void> {
    return await invoke('interrupt_session', { sessionId })
  }

  async updateSessionSettings(
    sessionId: string,
    settings: { autoAcceptEdits?: boolean },
  ): Promise<UpdateSessionSettingsResponse> {
    return await invoke('update_session_settings', {
      sessionId,
      autoAcceptEdits: settings.autoAcceptEdits,
    })
  }

  async getRecentPaths(limit?: number): Promise<GetRecentPathsResponse> {
    return await invoke('get_recent_paths', { limit })
  }

  async archiveSession(request: ArchiveSessionRequest): Promise<ArchiveSessionResponse> {
    return await invoke('archive_session', { request })
  }

  async bulkArchiveSessions(request: BulkArchiveSessionsRequest): Promise<BulkArchiveSessionsResponse> {
    return await invoke('bulk_archive_sessions', { request })
  }
}

// Export a singleton instance
export const daemonClient = new DaemonClient()
