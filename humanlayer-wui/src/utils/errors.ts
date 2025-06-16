// Error formatting utilities for UI display

export function formatError(error: unknown): string {
  if (!error) return 'Unknown error'

  // Extract message from various error formats
  let message: string
  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'object' && 'message' in error) {
    message = String((error as any).message)
  } else {
    message = String(error)
  }

  // Handle specific error patterns
  if (message.includes('call already has a response')) {
    return 'Approval already responded to'
  }

  if (message.includes('409 Conflict')) {
    return 'Conflict: Resource already exists'
  }

  if (message.includes('404 Not Found')) {
    return 'Resource not found'
  }

  if (message.includes('500 Internal Server Error')) {
    return 'Server error occurred'
  }

  if (message.includes('Failed to connect')) {
    return 'Cannot connect to daemon. Is it running?'
  }

  // Remove stack traces and technical details
  const firstLine = message.split('\n')[0]

  // Remove common prefixes
  const cleaned = firstLine
    .replace(/^Error:\s*/i, '')
    .replace(/^RPC error:\s*/i, '')
    .replace(/^JSON-RPC error:\s*/i, '')

  return cleaned
}
