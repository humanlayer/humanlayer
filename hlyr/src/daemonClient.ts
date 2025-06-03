import { connect, Socket } from 'net'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { join } from 'path'

interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: SubscribeRequest | Record<string, unknown>
  id: number
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: SubscribeResponse | EventNotification | { type: 'heartbeat'; message: string }
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
    type?: 'function_call' | 'human_contact'
    count?: number
    session_id?: string
    run_id?: string
    function_name?: string
    message?: string
    [key: string]: string | number | boolean | undefined
  }
}

interface EventNotification {
  event: Event
}

export class DaemonClient extends EventEmitter {
  private socketPath: string
  private socket?: Socket
  private requestId: number = 0
  private buffer: string = ''

  constructor(socketPath?: string) {
    super()
    this.socketPath = socketPath || join(homedir(), '.humanlayer', 'daemon.sock')
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(this.socketPath, () => {
        resolve()
      })

      const connectErrorHandler = (err: Error) => {
        reject(new Error(`Failed to connect to daemon: ${err.message}`))
      }
      this.socket.once('error', connectErrorHandler)

      // Remove the connect error handler once connected
      this.socket.once('connect', () => {
        this.socket.removeListener('error', connectErrorHandler)
      })

      this.socket.on('data', data => {
        this.handleData(data)
      })

      this.socket.on('close', () => {
        this.emit('close')
      })

      this.socket.on('end', () => {
        this.emit('close')
      })

      this.socket.on('error', err => {
        this.emit('error', err)
      })
    })
  }

  private handleData(data: Buffer) {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response: JsonRpcResponse = JSON.parse(line)
          this.handleResponse(response)
        } catch (err) {
          console.error('Failed to parse response:', err, 'Line:', line)
        }
      }
    }
  }

  private handleResponse(response: JsonRpcResponse) {
    // Check if it's an error
    if (response.error) {
      this.emit('error', new Error(`RPC Error ${response.error.code}: ${response.error.message}`))
      return
    }

    // Check if it's a subscription confirmation
    if (response.result && 'subscription_id' in response.result) {
      const subResponse = response.result as SubscribeResponse
      this.emit('subscribed', subResponse)
      return
    }

    // Check if it's a heartbeat
    if (response.result && response.result.type === 'heartbeat') {
      this.emit('heartbeat', response.result)
      return
    }

    // Check if it's an event notification
    if (response.result && 'event' in response.result) {
      const notification = response.result as EventNotification
      if (notification.event && notification.event.type) {
        this.emit('event', notification.event)
      }
    }
  }

  async subscribe(request: SubscribeRequest = {}): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to daemon')
    }

    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'Subscribe',
      params: request,
      id: ++this.requestId,
    }

    return new Promise((resolve, reject) => {
      const subscribeHandler = (response: SubscribeResponse) => {
        this.removeListener('subscribed', subscribeHandler)
        this.removeListener('error', errorHandler)
        resolve(response.subscription_id)
      }

      const errorHandler = (err: Error) => {
        this.removeListener('subscribed', subscribeHandler)
        this.removeListener('error', errorHandler)
        reject(err)
      }

      this.once('subscribed', subscribeHandler)
      this.once('error', errorHandler)

      this.socket!.write(JSON.stringify(req) + '\n')
    })
  }

  close() {
    if (this.socket) {
      this.socket.destroy()
      this.socket = undefined
    }
  }

  onEvent(callback: (event: Event) => void) {
    this.on('event', callback)
  }

  onClose(callback: () => void) {
    this.on('close', callback)
  }

  onError(callback: (error: Error) => void) {
    this.on('error', callback)
  }
}
