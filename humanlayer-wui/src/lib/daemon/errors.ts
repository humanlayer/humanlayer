// Daemon-specific error types

export class DaemonError extends Error {
  declare code?: string
  declare details?: any

  constructor(message: string, code?: string, details?: any) {
    super(message)
    this.name = 'DaemonError'
    this.code = code
    this.details = details
  }
}

export class ConnectionError extends DaemonError {
  constructor(message: string, details?: any) {
    super(message, 'CONNECTION_ERROR', details)
    this.name = 'ConnectionError'
  }
}

export class RPCError extends DaemonError {
  constructor(message: string, code?: string, details?: any) {
    super(message, code || 'RPC_ERROR', details)
    this.name = 'RPCError'
  }
}
