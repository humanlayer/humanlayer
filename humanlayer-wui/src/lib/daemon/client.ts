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
  GetSessionSnapshotsResponse,
  SendDecisionRequest,
  Decision,
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

  async sendDecision(request: SendDecisionRequest): Promise<void> {
    // For now, map to the existing Tauri commands based on decision type
    if (request.decision === 'approve') {
      return await invoke('approve_function_call', {
        approvalId: request.approval_id,
        comment: request.comment,
      })
    } else if (request.decision === 'deny') {
      return await invoke('deny_function_call', {
        approvalId: request.approval_id,
        reason: request.comment || 'Denied',
      })
    } else {
      throw new Error(`Unsupported decision type: ${request.decision}`)
    }
  }

  async approveFunctionCall(approvalId: string, comment?: string): Promise<void> {
    return await this.sendDecision({
      approval_id: approvalId,
      decision: 'approve' as Decision,
      comment,
    })
  }

  async denyFunctionCall(approvalId: string, reason: string): Promise<void> {
    return await this.sendDecision({
      approval_id: approvalId,
      decision: 'deny' as Decision,
      comment: reason,
    })
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

  async getSessionSnapshots(sessionId: string): Promise<GetSessionSnapshotsResponse> {
    return await invoke<GetSessionSnapshotsResponse>('get_session_snapshots', {
      sessionId: sessionId, // Tauri expects camelCase
    })
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await invoke('update_session_title', {
      sessionId,
      title,
    })
  }
}

// Export a singleton instance
export const daemonClient = new DaemonClient()
