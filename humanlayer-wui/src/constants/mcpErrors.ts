/**
 * MCP (Model Context Protocol) Error Constants
 *
 * This file centralizes all MCP error patterns to ensure consistent error detection
 * across the codebase and prevent pattern drift between components.
 *
 * Reference: JSON-RPC 2.0 error codes used by MCP
 * https://www.jsonrpc.org/specification#error_object
 */

/**
 * Known MCP error codes with user-friendly messages and remediation suggestions
 */
export const MCP_ERROR_CODES: Record<
  number,
  { message: string; suggestion: string }
> = {
  // Standard JSON-RPC errors
  [-32700]: {
    message: 'Parse error',
    suggestion: 'The request contains invalid JSON. Try again.',
  },
  [-32600]: {
    message: 'Invalid request',
    suggestion: 'The request format is invalid. Check the tool parameters.',
  },
  [-32601]: {
    message: 'Method not found',
    suggestion: 'This tool is not available. The MCP server may not support it.',
  },
  [-32602]: {
    message: 'Invalid params',
    suggestion: 'The parameters provided are invalid. Check the input format.',
  },
  [-32603]: {
    message: 'Internal error',
    suggestion: 'The MCP server encountered an internal error. Try again or check server logs.',
  },

  // Server errors (reserved range -32000 to -32099)
  [-32000]: {
    message: 'Server error',
    suggestion: 'The server encountered an error. Check your configuration.',
  },
  [-32001]: {
    message: 'Rate limited',
    suggestion: 'Too many requests. Wait a moment before trying again.',
  },
  [-32002]: {
    message: 'Not authorized',
    suggestion: 'Authentication required. Check your API key or credentials.',
  },
}

/**
 * Regex patterns for detecting MCP-specific errors in tool result content
 *
 * These patterns are designed to be specific enough to avoid false positives
 * while catching the common error formats from MCP servers.
 */
export const MCP_ERROR_PATTERNS = {
  // Matches "MCP error -XXXXX" format (e.g., "MCP error -32603")
  mcpErrorCode: /MCP error -?\d+/i,

  // Matches "tool_use_error" which is Claude's way of signaling tool failures
  toolUseError: /tool_use_error/i,

  // Matches "Failed to process" prefix commonly used in MCP error messages
  failedToProcess: /failed to process/i,

  // Matches JSON-RPC error format embedded in content
  jsonRpcError: /"error":\s*\{\s*"code":\s*-?\d+/,

  // Matches explicit MCP protocol errors
  mcpProtocolError: /mcp protocol error/i,

  // Matches tool execution failures
  toolExecutionFailed: /tool execution failed/i,

  // Matches connection/transport errors
  connectionError: /connection (refused|reset|timed out)/i,
}

/**
 * Combined regex pattern for quick MCP error detection
 * Use this for efficient single-pass checking
 */
export const MCP_ERROR_COMBINED_PATTERN = new RegExp(
  [
    MCP_ERROR_PATTERNS.mcpErrorCode.source,
    MCP_ERROR_PATTERNS.toolUseError.source,
    MCP_ERROR_PATTERNS.failedToProcess.source,
    MCP_ERROR_PATTERNS.jsonRpcError.source,
    MCP_ERROR_PATTERNS.mcpProtocolError.source,
    MCP_ERROR_PATTERNS.toolExecutionFailed.source,
    MCP_ERROR_PATTERNS.connectionError.source,
  ].join('|'),
  'i'
)

/**
 * Extract error code from MCP error message
 * @param content The content to search for error code
 * @returns The error code number or null if not found
 */
export function extractMcpErrorCode(content: string): number | null {
  const match = content.match(/MCP error (-?\d+)/i)
  if (match) {
    return parseInt(match[1], 10)
  }

  // Also check for JSON-RPC error format
  const jsonMatch = content.match(/"error":\s*\{\s*"code":\s*(-?\d+)/)
  if (jsonMatch) {
    return parseInt(jsonMatch[1], 10)
  }

  return null
}

/**
 * Get user-friendly error info for an MCP error code
 * @param code The MCP error code
 * @returns Error info object or null if code is unknown
 */
export function getMcpErrorInfo(code: number): { message: string; suggestion: string } | null {
  return MCP_ERROR_CODES[code] || null
}
