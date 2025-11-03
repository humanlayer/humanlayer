// Error formatting utilities for UI display

import { ResponseError } from '@humanlayer/hld-sdk'

export async function formatError(error: unknown): Promise<string> {
  if (!error) return 'Unknown error'

  // Extract message from various error formats
  let message: string

  // Handle ResponseError from the SDK (must be before Error check since ResponseError extends Error)
  if (error instanceof ResponseError) {
    try {
      // Clone the response to avoid consuming the original
      const clonedResponse = error.response.clone()
      const contentType = clonedResponse.headers.get('content-type')

      if (contentType && contentType.includes('application/json')) {
        const errorBody = await clonedResponse.json()

        // Log the full error for debugging
        console.debug('Backend error response:', {
          status: error.response.status,
          code: errorBody?.error?.code,
          message: errorBody?.error?.message || errorBody?.message,
        })

        // Extract message from the structured error response
        // Format: { error: { code: "HLD-4001", message: "Session is not in draft state" } }
        if (errorBody?.error?.message) {
          message = errorBody.error.message
        } else if (errorBody?.message) {
          // Fallback for other error formats
          message = errorBody.message
        } else {
          // Fallback to the generic SDK message
          message = error.message
        }
      } else {
        // Non-JSON response, use text
        message = (await clonedResponse.text()) || error.message
      }
    } catch (e) {
      // Response body may have already been consumed or parsing failed
      console.warn('Could not parse error response body:', e)
      message = error.message
    }
  } else if (error instanceof Error) {
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
