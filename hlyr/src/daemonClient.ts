import { connect, Socket } from 'net'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { join } from 'path'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: SubscribeRequest | LaunchSessionRequest | Record<string, unknown>
  id: number
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?:
    | SubscribeResponse
    | EventNotification
    | LaunchSessionResponse
    | { type: 'heartbeat'; message: string }
    | unknown
  error?: {
    code: number
    message: string
  }
  id?: number | string | null
}

interface SubscribeRequest {
  event_types?: string[]
  session_id?: string
  run_id?: string
}

interface SubscribeResponse {
  subscription_id: string
  message: string
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

    // Legacy fields (may not be used)
    type?: 'function_call' | 'human_contact'
    count?: number
    function_name?: string
    message?: string

    // Allow other fields
    [key: string]: string | number | boolean | undefined
  }
}

interface EventNotification {
  event: Event
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
}

interface LaunchSessionResponse {
  session_id: string
  run_id: string
}

export class DaemonClient extends EventEmitter {
  private socketPath: string
  private conn?: Socket
  private requestId: number = 0

  constructor(socketPath?: string) {
    super()
    this.socketPath = socketPath || join(homedir(), '.humanlayer', 'daemon.sock')
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn = connect(this.socketPath, () => {
        resolve()
      })

      const connectErrorHandler = (err: Error) => {
        reject(new Error(`Failed to connect to daemon: ${err.message}`))
      }
      this.conn.once('error', connectErrorHandler)

      // Remove the connect error handler once connected
      this.conn.once('connect', () => {
        this.conn!.removeListener('error', connectErrorHandler)
      })
    })
  }

  // Subscribe creates a separate connection for subscriptions (like the Go client)
  async subscribe(request: SubscribeRequest = {}): Promise<EventEmitter> {
    // Create a new connection for subscription
    const subConn = await this.createSubscriptionConnection()

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'Subscribe',
      params: request,
      id: ++this.requestId,
    }

    // Send the subscription request
    await new Promise<void>((resolve, reject) => {
      subConn.write(JSON.stringify(req) + '\n', err => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Create an event emitter for this subscription
    const subscriptionEmitter = new EventEmitter()
    let buffer = ''
    let subscriptionConfirmed = false

    subConn.on('data', data => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const response: JsonRpcResponse = JSON.parse(line)

            // Skip error responses
            if (response.error) {
              continue
            }

            // Check if it's a subscription confirmation
            if (
              !subscriptionConfirmed &&
              response.result &&
              typeof response.result === 'object' &&
              'subscription_id' in response.result
            ) {
              subscriptionConfirmed = true
              subscriptionEmitter.emit('subscribed', response.result)
              continue
            }

            // Check if it's a heartbeat
            if (
              response.result &&
              typeof response.result === 'object' &&
              'type' in response.result &&
              (response.result as { type: string }).type === 'heartbeat'
            ) {
              // Skip heartbeats
              continue
            }

            // Check if it's an event notification
            if (response.result && typeof response.result === 'object' && 'event' in response.result) {
              const notification = response.result as EventNotification
              if (notification.event && notification.event.type) {
                subscriptionEmitter.emit('event', notification.event)
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    })

    subConn.on('close', () => {
      subscriptionEmitter.emit('close')
    })

    subConn.on('error', err => {
      subscriptionEmitter.emit('error', err)
    })

    // Wait for subscription confirmation with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subConn.destroy()
        reject(new Error('Timeout waiting for subscription confirmation'))
      }, 5000)

      subscriptionEmitter.once('subscribed', (_response: SubscribeResponse) => {
        clearTimeout(timeout)
        resolve(subscriptionEmitter)
      })

      subscriptionEmitter.once('error', err => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  private async createSubscriptionConnection(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const conn = connect(this.socketPath, () => {
        resolve(conn)
      })

      conn.once('error', err => {
        reject(new Error(`Failed to create subscription connection: ${err.message}`))
      })
    })
  }

  // Call sends an RPC request and waits for the response (like the Go client)
  private async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.conn) {
      throw new Error('Not connected to daemon')
    }

    const id = ++this.requestId
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    }

    // Send request
    await new Promise<void>((resolve, reject) => {
      this.conn!.write(JSON.stringify(req) + '\n', err => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Read response
    return new Promise((resolve, reject) => {
      let buffer = ''
      let timeout: NodeJS.Timeout | undefined

      const dataHandler = (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response: JsonRpcResponse = JSON.parse(line)

              // Check if this is our response
              if (response.id === id) {
                // Clear the timeout first
                if (timeout) {
                  clearTimeout(timeout)
                  timeout = undefined
                }

                // Remove the data handler
                if (this.conn) {
                  this.conn.removeListener('data', dataHandler)
                }

                if (response.error) {
                  reject(new Error(`RPC error ${response.error.code}: ${response.error.message}`))
                } else {
                  resolve(response.result as T)
                }
                return
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      this.conn!.on('data', dataHandler)

      // Set a timeout
      timeout = setTimeout(() => {
        // Clear the timeout reference
        timeout = undefined

        // Only try to remove listener if connection still exists
        if (this.conn) {
          this.conn.removeListener('data', dataHandler)
        }
        reject(new Error('RPC call timeout'))
      }, 30000)
    })
  }

  // Public methods matching the Go client interface

  async health(): Promise<{ status: string }> {
    const resp = await this.call<{ status: string }>('health')
    if (resp.status !== 'ok') {
      throw new Error(`Daemon unhealthy: ${resp.status}`)
    }
    return resp
  }

  async launchSession(req: LaunchSessionRequest): Promise<LaunchSessionResponse> {
    return this.call<LaunchSessionResponse>('launchSession', req)
  }

  async listSessions(): Promise<{ sessions: unknown[] }> {
    return this.call<{ sessions: unknown[] }>('listSessions')
  }

  async createApproval(
    runId: string,
    toolName: string,
    toolInput: unknown,
  ): Promise<{ approval_id: string }> {
    return this.call<{ approval_id: string }>('createApproval', {
      run_id: runId,
      tool_name: toolName,
      tool_input: toolInput,
    })
  }

  async fetchApprovals(sessionId: string): Promise<Approval[]> {
    const resp = await this.call<{ approvals: Approval[] }>('fetchApprovals', { session_id: sessionId })
    return resp.approvals
  }

  async getApproval(approvalId: string): Promise<Approval> {
    const resp = await this.call<{ approval: Approval }>('getApproval', { approval_id: approvalId })
    return resp.approval
  }

  async sendDecision(approvalId: string, decision: string, comment: string): Promise<void> {
    const resp = await this.call<{ success: boolean; error?: string }>('sendDecision', {
      approval_id: approvalId,
      decision,
      comment,
    })
    if (!resp.success) {
      throw new Error(`Decision failed: ${resp.error}`)
    }
  }

  close() {
    if (this.conn) {
      this.conn.destroy()
      this.conn = undefined
    }
  }

  async reconnect(): Promise<void> {
    this.close()
    await this.connect()
  }
}

// Helper function for retrying connections
export async function connectWithRetry(
  socketPath: string,
  maxRetries: number = 3,
  retryDelay: number = 1000,
): Promise<DaemonClient> {
  let lastError: Error | undefined

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const client = new DaemonClient(socketPath)
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
