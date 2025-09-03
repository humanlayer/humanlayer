import {
  CreateSessionResponseData,
  HLDClient,
  RecentPath as SDKRecentPath,
  Approval,
  ConversationEvent,
  UserSettingsResponse,
  UpdateUserSettingsRequest,
  ConfigResponse,
  UpdateConfigRequest,
} from '@humanlayer/hld-sdk'
import { getDaemonUrl, getDefaultHeaders } from './http-config'
import { logger } from '@/lib/logging'
import type {
  DaemonClient as IDaemonClient,
  LaunchSessionParams,
  LaunchSessionRequest,
  SessionState,
  SubscribeOptions,
  SubscriptionHandle,
  SessionSnapshot,
  HealthCheckResponse,
  Session,
  ConfigStatus,
} from './types'
import { transformSDKSession } from './types'

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
    // getDaemonUrl now checks for managed daemon port dynamically
    const baseUrl = await getDaemonUrl()

    this.client = new HLDClient({
      baseUrl: `${baseUrl}/api/v1`,
      headers: getDefaultHeaders(),
    })

    // Verify connection with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const health = await this.client.health()
      // Accept both 'ok' and 'degraded' status - degraded means daemon is running but Claude is unavailable
      if (health.status !== 'ok' && health.status !== 'degraded') {
        throw new Error('Daemon health check failed')
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async reconnect(): Promise<void> {
    // Disconnect first if connected
    if (this.connected || this.connectionPromise) {
      await this.disconnect()
    }

    // Now connect to the potentially new URL
    return this.connect()
  }

  async disconnect(): Promise<void> {
    // Unsubscribe all event streams
    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe()
    }
    this.subscriptions.clear()

    this.connected = false
    this.client = undefined
    this.connectionPromise = undefined
    this.retryCount = 0
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

    // Handle provider-specific model formatting
    let model: string | undefined = params.model
    const provider = 'provider' in params ? params.provider : 'anthropic'

    // Only map to enum for Anthropic provider
    if (provider === 'anthropic' && params.model) {
      if (params.model.includes('sonnet')) {
        model = 'sonnet'
      } else if (params.model.includes('opus')) {
        model = 'opus'
      }
    }
    // For OpenRouter, pass model string as-is

    // Create the session with appropriate settings
    const response = await this.client!.createSession({
      query: params.query,
      title: 'title' in params ? params.title : undefined,
      workingDir:
        'workingDir' in params ? params.workingDir : (params as LaunchSessionRequest).working_dir,
      model: provider === 'openrouter' ? undefined : (model as 'opus' | 'sonnet' | undefined),
      mcpConfig: 'mcpConfig' in params ? params.mcpConfig : (params as LaunchSessionRequest).mcp_config,
      permissionPromptTool:
        'permissionPromptTool' in params
          ? params.permissionPromptTool
          : (params as LaunchSessionRequest).permission_prompt_tool,
      autoAcceptEdits: 'autoAcceptEdits' in params ? params.autoAcceptEdits : undefined,
      // Pass proxy configuration directly if using OpenRouter
      ...(provider === 'openrouter' && {
        proxyEnabled: true,
        proxyBaseUrl: 'https://openrouter.ai/api/v1',
        proxyModelOverride: model,
        proxyApiKey:
          'proxyApiKey' in params ? params.proxyApiKey : (params as LaunchSessionRequest).proxy_api_key,
      }),
      // Additional fields that might be in legacy format
      ...((params as any).template && { template: (params as any).template }),
      ...((params as any).instructions && { instructions: (params as any).instructions }),
    } as any)

    return response
    // return this.transformSession(response)
  }

  async listSessions(): Promise<Session[]> {
    await this.ensureConnected()
    const response = await this.client!.listSessions({ leafOnly: true })
    return response.map(transformSDKSession)
  }

  async getSessionLeaves(request?: {
    include_archived?: boolean
    archived_only?: boolean
  }): Promise<{ sessions: Session[] }> {
    await this.ensureConnected()
    // The SDK's listSessions with leafOnly=true is equivalent
    const response = await this.client!.listSessions({
      leafOnly: true,
      includeArchived: request?.include_archived,
      archivedOnly: request?.archived_only,
    })
    logger.debug(
      'getSessionLeaves raw response sample:',
      response[0]
        ? {
            id: response[0].id,
            dangerouslySkipPermissions: response[0].dangerouslySkipPermissions,
            dangerouslySkipPermissionsExpiresAt: response[0].dangerouslySkipPermissionsExpiresAt,
          }
        : 'no sessions',
    )
    return {
      sessions: response.map(transformSDKSession),
    }
  }

  async getSessionState(sessionId: string): Promise<SessionState> {
    await this.ensureConnected()
    const session = await this.client!.getSession(sessionId)

    // Transform to expected SessionState format
    return {
      session: transformSDKSession(session),
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
    settings: {
      auto_accept_edits?: boolean
      dangerously_skip_permissions?: boolean
      dangerously_skip_permissions_timeout_ms?: number
    },
  ): Promise<{ success: boolean }> {
    await this.ensureConnected()

    // The SDK client expects camelCase for some fields but the method signature uses snake_case
    const payload: any = {}
    if (settings.auto_accept_edits !== undefined) {
      payload.auto_accept_edits = settings.auto_accept_edits
    }
    if (settings.dangerously_skip_permissions !== undefined) {
      payload.dangerouslySkipPermissions = settings.dangerously_skip_permissions
    }
    if (settings.dangerously_skip_permissions_timeout_ms !== undefined) {
      payload.dangerouslySkipPermissionsTimeoutMs = settings.dangerously_skip_permissions_timeout_ms
    }

    logger.log('Sending updateSession request', { sessionId, payload })

    try {
      await this.client!.updateSession(sessionId, payload)
      return { success: true }
    } catch (error) {
      logger.error('updateSession failed', { error, sessionId, payload })
      throw error
    }
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

  async updateSession(
    sessionId: string,
    updates: {
      model?: string
      title?: string
      archived?: boolean
      autoAcceptEdits?: boolean
      dangerouslySkipPermissions?: boolean
      dangerouslySkipPermissionsTimeoutMs?: number
      // New proxy fields
      proxyEnabled?: boolean
      proxyBaseUrl?: string
      proxyModelOverride?: string
      proxyApiKey?: string
    },
  ): Promise<{ success: boolean }> {
    await this.ensureConnected()

    // Map to SDK client's expected format (snake_case for legacy fields, camelCase for new fields)
    const sdkUpdates: any = {}
    if (updates.model !== undefined) {
      sdkUpdates.model = updates.model
    }
    if (updates.title !== undefined) {
      sdkUpdates.title = updates.title
    }
    if (updates.archived !== undefined) {
      sdkUpdates.archived = updates.archived
    }
    if (updates.autoAcceptEdits !== undefined) {
      sdkUpdates.auto_accept_edits = updates.autoAcceptEdits
    }
    if (updates.dangerouslySkipPermissions !== undefined) {
      sdkUpdates.dangerouslySkipPermissions = updates.dangerouslySkipPermissions
    }
    if (updates.dangerouslySkipPermissionsTimeoutMs !== undefined) {
      sdkUpdates.dangerouslySkipPermissionsTimeoutMs = updates.dangerouslySkipPermissionsTimeoutMs
    }
    if (updates.proxyEnabled !== undefined) {
      sdkUpdates.proxyEnabled = updates.proxyEnabled
    }
    if (updates.proxyBaseUrl !== undefined) {
      sdkUpdates.proxyBaseUrl = updates.proxyBaseUrl
    }
    if (updates.proxyModelOverride !== undefined) {
      sdkUpdates.proxyModelOverride = updates.proxyModelOverride
    }
    if (updates.proxyApiKey !== undefined) {
      sdkUpdates.proxyApiKey = updates.proxyApiKey
    }

    await this.client!.updateSession(sessionId, sdkUpdates)
    return { success: true }
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
              logger.error('Event subscription error:', error)
              // Attempt reconnection
              if (!this.connected) {
                this.connect().catch(logger.error)
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
        logger.error('Failed to start event subscription:', error)
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

  async getDebugInfo(): Promise<import('./types').DebugInfo> {
    await this.ensureConnected()

    // Use REST API endpoint
    const baseUrl = await getDaemonUrl()
    const response = await fetch(`${baseUrl}/api/v1/debug-info`, {
      method: 'GET',
      headers: getDefaultHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Failed to get debug info: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  }

  // Private Helper Methods

  async getConfigStatus(): Promise<ConfigStatus> {
    await this.ensureConnected()
    const baseUrl = await getDaemonUrl()
    const response = await fetch(`${baseUrl}/api/v1/config/status`, {
      headers: getDefaultHeaders(),
    })
    if (!response.ok) {
      throw new Error('Failed to fetch config status')
    }
    return response.json()
  }

  async getUserSettings(): Promise<UserSettingsResponse> {
    await this.ensureConnected()
    if (!this.client) throw new Error('SDK client not initialized')

    const response = await this.client.getUserSettings()
    return response
  }

  async updateUserSettings(settings: UpdateUserSettingsRequest): Promise<UserSettingsResponse> {
    await this.ensureConnected()
    if (!this.client) throw new Error('SDK client not initialized')

    const response = await this.client.updateUserSettings(settings)
    return response
  }

  async getConfig(): Promise<ConfigResponse> {
    await this.ensureConnected()
    if (!this.client) throw new Error('SDK client not initialized')

    const response = await this.client.getConfig()
    return response
  }

  async updateConfig(settings: UpdateConfigRequest): Promise<ConfigResponse> {
    await this.ensureConnected()
    if (!this.client) throw new Error('SDK client not initialized')

    const response = await this.client.updateConfig(settings)
    return response
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
  }
}
