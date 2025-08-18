import { EventEmitter } from 'events'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id: number
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: {
    code: number
    message: string
  }
  id?: number | string | null
}

interface Event {
  type: 'new_approval' | 'approval_resolved' | 'session_status_changed'
  timestamp: string
  data: {
    // Common fields
    session_id?: string
    run_id?: string

    // new_approval event fields
    approval_id?: string
    tool_name?: string

    // approval_resolved event fields
    approved?: boolean
    response_text?: string

    // session_status_changed event fields
    old_status?: string
    new_status?: string
    parent_session_id?: string

    // Allow other fields
    [key: string]: string | number | boolean | undefined
  }
}

export interface Approval {
  id: string
  run_id: string
  session_id: string
  status: 'pending' | 'approved' | 'denied'
  created_at: string
  responded_at?: string
  tool_name: string
  tool_input: unknown
  comment?: string
}

interface LaunchSessionRequest {
  query: string
  title?: string
  model?: string
  mcp_config?: unknown
  permission_prompt_tool?: string
  working_dir?: string
  max_turns?: number
  system_prompt?: string
  append_system_prompt?: string
  allowed_tools?: string[]
  disallowed_tools?: string[]
  custom_instructions?: string
  verbose?: boolean
  dangerously_skip_permissions?: boolean
  dangerously_skip_permissions_timeout?: number
}

interface LaunchSessionResponse {
  session_id: string
  run_id: string
}

export class DaemonHttpClient extends EventEmitter {
  private baseURL: string
  private requestId: number = 0

  constructor(daemonURL?: string) {
    super()
    this.baseURL = daemonURL || process.env.HUMANLAYER_DAEMON_URL || 'http://localhost:7777'
  }

  async connect(): Promise<void> {
    // Test connection with health endpoint
    try {
      const response = await fetch(`${this.baseURL}/api/v1/health`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      if (data.status !== 'ok') {
        throw new Error(`Daemon unhealthy: ${data.status}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to connect to daemon at ${this.baseURL}: ${error.message}`)
      }
      throw error
    }
  }

  // Subscribe using Server-Sent Events (SSE)
  async subscribe(request: { event_types?: string[]; session_id?: string } = {}): Promise<EventEmitter> {
    const subscriptionEmitter = new EventEmitter()

    // Build query parameters
    const params = new URLSearchParams()
    if (request.session_id) {
      params.append('session_id', request.session_id)
    }
    if (request.event_types && request.event_types.length > 0) {
      request.event_types.forEach(type => params.append('event_types', type))
    }

    const url = `${this.baseURL}/api/v1/stream/events?${params.toString()}`

    // Create EventSource for SSE
    const EventSource = require('eventsource')
    const eventSource = new EventSource(url)

    eventSource.onopen = () => {
      subscriptionEmitter.emit('subscribed', { subscription_id: 'sse', message: 'Connected to SSE stream' })
    }

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'heartbeat') {
          // Skip heartbeats
          return
        }
        // Emit the event
        subscriptionEmitter.emit('event', data)
      } catch (err) {
        // Ignore parse errors
      }
    }

    eventSource.onerror = (err: Event) => {
      subscriptionEmitter.emit('error', new Error(`SSE error: ${err.type}`))
      eventSource.close()
      subscriptionEmitter.emit('close')
    }

    // Add method to close the connection
    ;(subscriptionEmitter as any).close = () => {
      eventSource.close()
    }

    return subscriptionEmitter
  }

  // Helper for JSON-RPC over HTTP (for backward compatibility)
  private async callRpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    }

    const response = await fetch(`${this.baseURL}/api/v1/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result: JsonRpcResponse = await response.json()

    if (result.error) {
      throw new Error(`RPC error ${result.error.code}: ${result.error.message}`)
    }

    return result.result as T
  }

  // REST API methods

  async health(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseURL}/api/v1/health`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  }

  async launchSession(req: LaunchSessionRequest): Promise<LaunchSessionResponse> {
    const response = await fetch(`${this.baseURL}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to launch session: ${response.status} ${errorText}`)
    }

    const data = await response.json()
    return {
      session_id: data.id,
      run_id: data.run_id || '', // REST API might not return run_id
    }
  }

  async listSessions(): Promise<{ sessions: unknown[] }> {
    const response = await fetch(`${this.baseURL}/api/v1/sessions`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    return { sessions: data.sessions || [] }
  }

  async createApproval(
    runId: string,
    toolName: string,
    toolInput: unknown,
  ): Promise<{ approval_id: string }> {
    const response = await fetch(`${this.baseURL}/api/v1/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        run_id: runId,
        tool_name: toolName,
        tool_input: toolInput,
      }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    return { approval_id: data.id }
  }

  async fetchApprovals(sessionId: string): Promise<Approval[]> {
    const response = await fetch(`${this.baseURL}/api/v1/approvals?session_id=${sessionId}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    return data.approvals || []
  }

  async getApproval(approvalId: string): Promise<Approval> {
    const response = await fetch(`${this.baseURL}/api/v1/approvals/${approvalId}`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  }

  async sendDecision(approvalId: string, decision: string, comment: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/v1/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        decision: decision === 'approve' ? 'approved' : 'denied',
        comment,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Decision failed: ${response.status} ${errorText}`)
    }
  }

  close() {
    // Nothing to close for HTTP client
  }

  async reconnect(): Promise<void> {
    // Just test the connection again
    await this.connect()
  }
}

// Helper function for retrying connections
export async function connectWithRetry(
  daemonURL: string,
  maxRetries: number = 3,
  retryDelay: number = 1000,
): Promise<DaemonHttpClient> {
  let lastError: Error | undefined

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const client = new DaemonHttpClient(daemonURL)
      await client.connect()

      // Test the connection
      await client.health()
      return client
    } catch (err) {
      lastError = err as Error
      if (i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw new Error(`Failed to connect to daemon after ${maxRetries + 1} attempts: ${lastError?.message}`)
}