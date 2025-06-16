// Daemon-specific error types

export class DaemonError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'DaemonError'
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