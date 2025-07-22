// Daemon-specific error types

export interface ErrorDetails {
  context?: string
  stack?: string
  request?: unknown
  response?: unknown
  originalError?: Error
}

export class DaemonError extends Error {
  declare code?: string
  declare details?: ErrorDetails

  constructor(message: string, code?: string, details?: ErrorDetails) {
    super(message)
    this.name = 'DaemonError'
    this.code = code
    this.details = details
  }
}

export class ConnectionError extends DaemonError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, 'CONNECTION_ERROR', details)
    this.name = 'ConnectionError'
  }
}

export class RPCError extends DaemonError {
  constructor(message: string, code?: string, details?: ErrorDetails) {
    super(message, code || 'RPC_ERROR', details)
    this.name = 'RPCError'
  }
}
