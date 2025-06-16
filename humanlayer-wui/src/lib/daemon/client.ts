import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  HealthCheckResponse,
  LaunchSessionRequest,
  LaunchSessionResponse,
  ListSessionsResponse,
  GetSessionStateResponse,
  ContinueSessionRequest,
  ContinueSessionResponse,
  GetConversationResponse,
  FetchApprovalsResponse,
  EventNotification,
  SubscribeRequest,
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
      // eslint-disable-next-line no-unused-vars
      onEvent?: (event: EventNotification) => void
      // eslint-disable-next-line no-unused-vars
      onError?: (error: Error) => void
    } = {},
  ): Promise<() => void> {
    await invoke('subscribe_to_events', { request })

    // Listen for daemon events and forward to handlers
    const unlisten = await listen<EventNotification>('daemon-event', event => {
      try {
        handlers.onEvent?.(event.payload)
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    })

    return unlisten
  }
}

// Export a singleton instance
export const daemonClient = new DaemonClient()
