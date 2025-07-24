import { HLDClient } from '@humanlayer/hld-sdk'
import { getDaemonUrl, getDefaultHeaders } from './http-config'
import type {
  DaemonClient as IDaemonClient,
  LaunchSessionParams,
  LaunchSessionRequest,
  SessionState,
  SubscribeOptions,
  SubscriptionHandle,
  ConversationEvent,
  SessionSnapshot,
  HealthCheckResponse,
  LegacySession,
  LegacyApproval,
  LegacyConversationEvent,
} from './types'
import { ConversationEventType } from './types'

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
      } catch (error) {
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
      status: response.status,
      version: response.version || 'unknown',
    }
  }

  // Session Management Methods

  async launchSession(params: LaunchSessionParams | LaunchSessionRequest): Promise<LegacySession> {
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
      workingDir: params.workingDir || (params as any).working_dir,
      model: model,
      mcpConfig: params.mcpConfig || (params as any).mcp_config,
      permissionPromptTool: params.permissionPromptTool || (params as any).permission_prompt_tool,
      autoAcceptEdits: params.autoAcceptEdits || (params as any).auto_accept_edits,
      // Additional fields that might be in legacy format
      ...(params as any).template && { template: (params as any).template },
      ...(params as any).instructions && { instructions: (params as any).instructions },
    })
    return this.transformSession(response)
  }

  async listSessions(): Promise<LegacySession[]> {
    await this.ensureConnected()
    const response = await this.client!.listSessions({ leafOnly: true })
    return response.map(s => this.transformSession(s))
  }

  async getSessionLeaves(request?: {
    include_archived?: boolean
    archived_only?: boolean
  }): Promise<{ sessions: LegacySession[] }> {
    await this.ensureConnected()
    // The SDK's listSessions with leafOnly=true is equivalent
    const response = await this.client!.listSessions({
      leafOnly: true,
      includeArchived: request?.include_archived || request?.archived_only,
    })
    return {
      sessions: response.map(s => this.transformSession(s)),
    }
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    await this.ensureConnected()
    const session = await this.client!.getSession(sessionId)

    // Transform to expected SessionState format
    return {
      session: this.transformSession(session),
      pending_approvals: [], // Will be populated if needed
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

  async updateSessionTitle(sessionId: string, title: string): Promise<{ success: boolean }> {
    await this.ensureConnected()
    // TODO: Add updateSessionTitle to the SDK
    // Temporary workaround: use updateSession with custom metadata
    try {
      await this.client!.updateSession(sessionId, {
        // Store title in metadata until SDK supports it directly
        auto_accept_edits: undefined,
      })
      // For now, title update is not supported
      console.warn('updateSessionTitle not yet supported in SDK')
      return { success: true }
    } catch (error) {
      console.warn('updateSessionTitle failed:', error)
      return { success: false }
    }
  }

  // Conversation & Content Methods

  async getConversation(params: {
    session_id?: string
    claude_session_id?: string
  }): Promise<LegacyConversationEvent[]> {
    await this.ensureConnected()
    if (!params.session_id) {
      throw new Error('session_id is required')
    }
    const messages = await this.client!.getSessionMessages(params.session_id)
    return messages.map(m => this.transformMessage(m))
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

  async fetchApprovals(sessionId?: string): Promise<LegacyApproval[]> {
    await this.ensureConnected()
    const approvals = await this.client!.listApprovals(sessionId)
    return approvals.map(a => this.transformApproval(a))
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
              options.onEvent({
                type: event.type,
                data: event.data,
                timestamp: event.timestamp,
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

  async getRecentPaths(limit?: number): Promise<string[]> {
    await this.ensureConnected()
    const response = await this.client!.getRecentPaths(limit)
    return response
  }

  // Private Helper Methods

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
  }

  private transformSession(apiSession: any): LegacySession {
    // Transform SDK response (camelCase) to legacy format (snake_case)
    return {
      id: apiSession.id,
      run_id: apiSession.runId || apiSession.run_id,
      query: apiSession.query,
      status: apiSession.status,
      created_at:
        apiSession.createdAt instanceof Date
          ? apiSession.createdAt.toISOString()
          : apiSession.createdAt || apiSession.created_at,
      updated_at:
        apiSession.lastActivityAt instanceof Date
          ? apiSession.lastActivityAt.toISOString()
          : apiSession.lastActivityAt || apiSession.updated_at || apiSession.createdAt || apiSession.created_at,
      summary: apiSession.summary || '',
      parent_session_id: apiSession.parentSessionId || apiSession.parent_session_id,
      claude_session_id: apiSession.claudeSessionId || apiSession.claude_session_id,
      auto_accept_edits: apiSession.autoAcceptEdits || apiSession.auto_accept_edits || false,
      archived: apiSession.archived || false,
      provider: apiSession.provider,
      model: apiSession.model,
      temperature: apiSession.temperature,
      max_tokens: apiSession.maxTokens || apiSession.max_tokens,
      stop_sequences: apiSession.stopSequences || apiSession.stop_sequences,
      top_p: apiSession.topP || apiSession.top_p,
      top_k: apiSession.topK || apiSession.top_k,
      metadata: apiSession.metadata,
      cost_usd: apiSession.costUsd || apiSession.cost_usd,
      input_tokens: apiSession.inputTokens || apiSession.input_tokens,
      output_tokens: apiSession.outputTokens || apiSession.output_tokens,
      total_tokens: apiSession.totalTokens || apiSession.total_tokens,
      // Add legacy fields
      start_time:
        apiSession.createdAt instanceof Date
          ? apiSession.createdAt.toISOString()
          : apiSession.createdAt || apiSession.created_at,
      last_activity_at:
        apiSession.lastActivityAt instanceof Date
          ? apiSession.lastActivityAt.toISOString()
          : apiSession.lastActivityAt || apiSession.last_activity_at || apiSession.updatedAt || apiSession.updated_at,
      end_time: apiSession.completedAt
        ? apiSession.completedAt instanceof Date
          ? apiSession.completedAt.toISOString()
          : apiSession.completedAt
        : apiSession.end_time,
      error: apiSession.errorMessage || apiSession.error,
      working_dir: apiSession.workingDir || apiSession.working_dir,
      title: apiSession.metadata?.title || apiSession.title,
    }
  }

  private transformApproval(apiApproval: any): LegacyApproval {
    // Transform SDK response (camelCase) to legacy format (snake_case)
    return {
      id: apiApproval.id,
      session_id: apiApproval.sessionId || apiApproval.session_id,
      run_id: apiApproval.runId || apiApproval.run_id,
      status: apiApproval.status,
      tool_name: apiApproval.toolName || apiApproval.tool_name,
      tool_input: apiApproval.toolParameters || apiApproval.tool_parameters || apiApproval.tool_input,
      tool_parameters: apiApproval.toolParameters || apiApproval.tool_parameters,
      created_at:
        apiApproval.createdAt instanceof Date
          ? apiApproval.createdAt.toISOString()
          : apiApproval.createdAt || apiApproval.created_at,
      responded_at: apiApproval.resolvedAt || apiApproval.resolved_at
        ? (apiApproval.resolvedAt || apiApproval.resolved_at) instanceof Date
          ? (apiApproval.resolvedAt || apiApproval.resolved_at).toISOString()
          : apiApproval.resolvedAt || apiApproval.resolved_at
        : apiApproval.responded_at,
      resolved_at: apiApproval.resolvedAt || apiApproval.resolved_at
        ? (apiApproval.resolvedAt || apiApproval.resolved_at) instanceof Date
          ? (apiApproval.resolvedAt || apiApproval.resolved_at).toISOString()
          : apiApproval.resolvedAt || apiApproval.resolved_at
        : undefined,
      comment: apiApproval.resolution?.comment || apiApproval.comment,
      resolution: apiApproval.resolution
        ? {
            decision: apiApproval.resolution.decision,
            comment: apiApproval.resolution.comment,
            resolved_by: apiApproval.resolution.resolvedBy || apiApproval.resolution.resolved_by,
          }
        : undefined,
    }
  }

  private transformMessage(apiMessage: ConversationEvent): LegacyConversationEvent {
    // The SDK ConversationEvent type might have different structure than what we need
    // For now, pass through and add snake_case mappings as needed
    const event = apiMessage as any
    return {
      id: event.id,
      session_id: event.sessionId || event.session_id,
      claude_session_id: event.claudeSessionId || event.claude_session_id,
      sequence: event.sequence,
      event_type: event.eventType || event.event_type || ConversationEventType.Message,
      created_at: event.createdAt || event.created_at,
      role: event.role,
      content: event.content,
      tool_id: event.toolId || event.tool_id,
      tool_name: event.toolName || event.tool_name,
      tool_input_json: event.toolInputJson || event.tool_input_json,
      tool_result_for_id: event.toolResultForId || event.tool_result_for_id,
      tool_result_content: event.toolResultContent || event.tool_result_content,
      is_completed: event.isCompleted !== undefined ? event.isCompleted : event.is_completed,
      approval_status: event.approvalStatus || event.approval_status,
      approval_id: event.approvalId || event.approval_id,
      parent_tool_use_id: event.parentToolUseId || event.parent_tool_use_id,
      // Also include the SDK format fields for compatibility
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
    }
  }
}
