import {
  CreateSessionResponseData,
  HLDClient,
  RecentPath as SDKRecentPath,
  Session,
  Approval,
  ConversationEvent,
} from '@humanlayer/hld-sdk'
import { getDaemonUrl, getDefaultHeaders } from './http-config'
import type {
  DaemonClient as IDaemonClient,
  LaunchSessionParams,
  LaunchSessionRequest,
  SessionState,
  SubscribeOptions,
  SubscriptionHandle,
  SessionSnapshot,
  HealthCheckResponse,
} from './types'

export class HTTPDaemonClient implements IDaemonClient {
  private client?: HLDClient
  private connected = false
  private connectionPromise?: Promise<void>
  private retryCount = 0
  private readonly maxRetries = 3
  private readonly retryDelay = 500
  private subscriptions = new Map<string, () => void>()

  async connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve()
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.connectWithRetries()
    return this.connectionPromise
  }

  private async connectWithRetries(): Promise<void> {
    this.retryCount = 0

    while (this.retryCount < this.maxRetries) {
      try {
        await this.doConnect()
        this.connected = true
        this.connectionPromise = undefined
        return
      } catch {
        this.retryCount++
        if (this.retryCount >= this.maxRetries) {
          this.connectionPromise = undefined
          throw new Error('Cannot connect to daemon. Is it running?')
        }
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
      }
    }
  }

  private async doConnect(): Promise<void> {
    const baseUrl = getDaemonUrl()

    this.client = new HLDClient({
      baseUrl: `${baseUrl}/api/v1`,
      headers: getDefaultHeaders(),
    })

    // Verify connection with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const health = await this.client.health()
      if (health.status !== 'ok') {
        throw new Error('Daemon health check failed')
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async disconnect(): Promise<void> {
    // Unsubscribe all event streams
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe()
    }
    this.subscriptions.clear()

    this.connected = false
    this.client = undefined
  }

  async health(): Promise<HealthCheckResponse> {
    await this.ensureConnected()
    const response = await this.client!.health()
    return {
      status: response.status as 'ok',
      version: response.version || 'unknown',
    }
  }

  // Session Management Methods

  async launchSession(
    params: LaunchSessionParams | LaunchSessionRequest,
  ): Promise<CreateSessionResponseData> {
    await this.ensureConnected()

    // Map model names to SDK enum values
    let model: 'opus' | 'sonnet' | undefined = undefined
    if (params.model) {
      if (params.model.includes('sonnet')) {
        model = 'sonnet'
      } else if (params.model.includes('opus')) {
        model = 'opus'
      }
    }

    const response = await this.client!.createSession({
      query: params.query,
      workingDir:
        'workingDir' in params ? params.workingDir : (params as LaunchSessionRequest).working_dir,
      model: model,
      mcpConfig: 'mcpConfig' in params ? params.mcpConfig : (params as LaunchSessionRequest).mcp_config,
      permissionPromptTool:
        'permissionPromptTool' in params
          ? params.permissionPromptTool
          : (params as LaunchSessionRequest).permission_prompt_tool,
      autoAcceptEdits: 'autoAcceptEdits' in params ? params.autoAcceptEdits : undefined,
      // Additional fields that might be in legacy format
      ...((params as any).template && { template: (params as any).template }),
      ...((params as any).instructions && { instructions: (params as any).instructions }),
    })
    return response
    // return this.transformSession(response)
  }

  async listSessions(): Promise<Session[]> {
    await this.ensureConnected()
    const response = await this.client!.listSessions({ leafOnly: true })
    return response
  }

  async getSessionLeaves(request?: {
    include_archived?: boolean
    archived_only?: boolean
  }): Promise<{ sessions: Session[] }> {
    await this.ensureConnected()
    // The SDK's listSessions with leafOnly=true is equivalent
    const response = await this.client!.listSessions({
      leafOnly: true,
      includeArchived: request?.include_archived || request?.archived_only,
    })
    return {
      sessions: response,
    }
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    await this.ensureConnected()
    const session = await this.client!.getSession(sessionId)

    // Transform to expected SessionState format
    return {
      session: session,
      pendingApprovals: [], // Will be populated if needed
    }
  }

  async continueSession(
    sessionId: string,
    message: string,
  ): Promise<{ success: boolean; new_session_id?: string }> {
    await this.ensureConnected()
    const response = await this.client!.continueSession(sessionId, message)
    return {
      success: true,
      new_session_id: response.sessionId,
    }
  }

  async interruptSession(sessionId: string): Promise<{ success: boolean }> {
    await this.ensureConnected()
    await this.client!.interruptSession(sessionId)
    return { success: true }
  }

  async updateSessionSettings(
    sessionId: string,
    settings: { auto_accept_edits?: boolean },
  ): Promise<{ success: boolean }> {
    await this.ensureConnected()
    await this.client!.updateSession(sessionId, {
      auto_accept_edits: settings.auto_accept_edits,
    })
    return { success: true }
  }

  async archiveSession(
    sessionIdOrRequest: string | { session_id: string; archived: boolean },
  ): Promise<{ success: boolean }> {
    await this.ensureConnected()
    // Handle both old string format and new object format
    let sessionId: string
    let archived: boolean

    if (typeof sessionIdOrRequest === 'string') {
      sessionId = sessionIdOrRequest
      archived = true // Default to archiving
    } else {
      sessionId = sessionIdOrRequest.session_id
      archived = sessionIdOrRequest.archived
    }

    const result = await this.client!.archiveSessions([sessionId], archived)
    return { success: result.archived.length === 1 }
  }

  async bulkArchiveSessions(
    sessionIdsOrRequest: string[] | { session_ids: string[]; archived: boolean },
  ): Promise<{ success: boolean; archived_count: number }> {
    await this.ensureConnected()
    // Handle both old array format and new object format
    let sessionIds: string[]
    let archived: boolean

    if (Array.isArray(sessionIdsOrRequest)) {
      sessionIds = sessionIdsOrRequest
      archived = true // Default to archiving
    } else {
      sessionIds = sessionIdsOrRequest.session_ids
      archived = sessionIdsOrRequest.archived
    }

    const result = await this.client!.archiveSessions(sessionIds, archived)
    return {
      success: true,
      archived_count: result.archived.length,
    }
  }

  // remove ignore once we've implemented this again
  async updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }> {
    await this.ensureConnected()
    await this.client!.updateSession(sessionId, {
      title: title,
    })
    return { success: true }
  }

  // Conversation & Content Methods

  async getConversation(
    params: {
      session_id?: string
      claude_session_id?: string
    },
    options?: RequestInit,
  ): Promise<ConversationEvent[]> {
    await this.ensureConnected()
    if (!params.session_id) {
      throw new Error('session_id is required')
    }
    const messages = await this.client!.getSessionMessages(params.session_id, options)
    return messages
  }

  async getSessionSnapshots(sessionId: string): Promise<SessionSnapshot[]> {
    await this.ensureConnected()
    const snapshots = await this.client!.getSessionSnapshots(sessionId)
    // Transform FileSnapshot (camelCase) to FileSnapshotInfo (snake_case)
    return snapshots.map(s => ({
      tool_id: s.toolId,
      file_path: s.filePath,
      content: s.content,
      created_at: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    }))
  }

  // Approval Methods

  async fetchApprovals(sessionId?: string): Promise<Approval[]> {
    await this.ensureConnected()
    const approvals = await this.client!.listApprovals(sessionId)
    return approvals
  }

  async sendDecision(
    approvalId: string,
    decision: 'approve' | 'deny',
    comment?: string,
  ): Promise<{ success: boolean; error?: string }> {
    await this.ensureConnected()
    try {
      await this.client!.decideApproval(approvalId, decision, comment)
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send decision',
      }
    }
  }

  // Convenience wrappers for backwards compatibility
  async approveFunctionCall(
    approvalId: string,
    comment?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendDecision(approvalId, 'approve', comment)
  }

  async denyFunctionCall(
    approvalId: string,
    comment?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.sendDecision(approvalId, 'deny', comment)
  }

  // Event Subscription

  subscribeToEvents(options: SubscribeOptions): SubscriptionHandle {
    const subscriptionId = `${Date.now()}-${Math.random()}`

    // Start subscription after ensuring connection
    this.ensureConnected()
      .then(async () => {
        const unsubscribe = await this.client!.subscribeToEvents(
          {
            eventTypes: options.event_types,
            sessionId: options.session_id,
            runId: options.run_id,
          },
          {
            onMessage: event => {
              // Transform event to match expected format
              // Handle timestamp conversion - SDK passes raw JSON, needs Date object
              options.onEvent({
                type: event.type,
                data: event.data,
                timestamp:
                  typeof event.timestamp === 'string' ? new Date(event.timestamp) : event.timestamp,
              })
            },
            onError: error => {
              console.error('Event subscription error:', error)
              // Attempt reconnection
              if (!this.connected) {
                this.connect().catch(console.error)
              }
            },
            onDisconnect: () => {
              // Remove from active subscriptions
              this.subscriptions.delete(subscriptionId)
            },
          },
        )

        this.subscriptions.set(subscriptionId, unsubscribe)
      })
      .catch(error => {
        console.error('Failed to start event subscription:', error)
      })

    // Return handle for unsubscribing
    return {
      unsubscribe: () => {
        const unsub = this.subscriptions.get(subscriptionId)
        if (unsub) {
          unsub()
          this.subscriptions.delete(subscriptionId)
        }
      },
    }
  }

  // Utility Methods

  // Note, limit not being used just yet, post REST client implementation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRecentPaths(_limit?: number): Promise<SDKRecentPath[]> {
    await this.ensureConnected()
    // SDK client doesn't support limit parameter yet
    const response = await this.client!.getRecentPaths()
    return response // SDK now properly returns RecentPath[]
  }

  // Private Helper Methods

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
  }
}
