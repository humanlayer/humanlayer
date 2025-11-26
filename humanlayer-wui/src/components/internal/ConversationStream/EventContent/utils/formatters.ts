import {
  MCP_ERROR_COMBINED_PATTERN,
  extractMcpErrorCode,
  getMcpErrorInfo,
} from '@/constants/mcpErrors'

export interface FormatOptions {
  truncateLength?: number
  showLineCount?: boolean
}

/**
 * Information about a detected MCP error
 */
export interface McpErrorInfo {
  code: number | null
  message: string
  suggestion: string | null
}

/**
 * Format tool result content into a brief preview string
 * @returns A formatted preview string or null if no meaningful content
 */
export function formatToolResultPreview(content: string, options: FormatOptions = {}): string | null {
  const { truncateLength = 80 } = options

  if (!content.trim()) {
    return null
  }

  const lines = content.split('\n').filter(l => l.trim())

  if (lines.length === 0) {
    return null
  } else if (lines.length === 1) {
    const firstLine = lines[0]
    return firstLine.length > truncateLength
      ? `${firstLine.slice(0, truncateLength - 3)}...`
      : firstLine
  } else {
    const firstLine = lines[0]
    const truncatedFirst = firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine
    return `${truncatedFirst} ... (${lines.length} lines)`
  }
}

/**
 * Check if content contains MCP-specific error patterns
 * This should be checked BEFORE generic error detection to properly identify MCP errors
 * @param content The result content to check
 * @returns true if the content contains MCP error patterns
 */
export function hasMcpError(content: string): boolean {
  return MCP_ERROR_COMBINED_PATTERN.test(content)
}

/**
 * Extract detailed MCP error information from content
 * @param content The result content to extract error info from
 * @returns MCP error info object or null if no MCP error detected
 */
export function extractMcpError(content: string): McpErrorInfo | null {
  if (!hasMcpError(content)) {
    return null
  }

  const code = extractMcpErrorCode(content)
  const knownInfo = code !== null ? getMcpErrorInfo(code) : null

  if (knownInfo) {
    return {
      code,
      message: knownInfo.message,
      suggestion: knownInfo.suggestion,
    }
  }

  // For unknown error codes or generic MCP errors
  return {
    code,
    message: code !== null ? `MCP error ${code}` : 'MCP tool error',
    suggestion: 'Check the tool configuration and try again.',
  }
}

/**
 * Detect if tool result content contains an error
 * @param toolName The name of the tool
 * @param content The result content to check
 * @returns true if the content indicates an error
 */
export function detectToolError(toolName: string, content: string): boolean {
  const lowerContent = content.toLowerCase()

  // Check for MCP-specific errors FIRST (highest priority)
  // This catches errors like "MCP error -32603" and "tool_use_error"
  if (hasMcpError(content)) {
    return true
  }

  // Tool-specific error detection
  if (toolName === 'Edit') {
    const successPattern =
      "has been updated. Here's the result of running `cat -n` on a snippet of the edited file:"
    return !content.includes(successPattern)
  }

  if (toolName === 'Write') {
    if (content.trim() === '') {
      return false // Empty content is success for Write
    }
    return (
      lowerContent.includes('error') ||
      lowerContent.includes('failed') ||
      lowerContent.includes('file has not been read')
    )
  }

  if (toolName === 'Grep') {
    return (
      lowerContent.startsWith('grep:') ||
      lowerContent.includes('invalid regex') ||
      lowerContent.includes('invalid regular expression')
    )
  }

  // Generic error detection for other tools
  const hasErrorKeyword =
    lowerContent.includes('error:') ||
    lowerContent.includes('failed:') ||
    lowerContent.includes('failed to') ||
    lowerContent.includes('exception:') ||
    lowerContent.includes('traceback') ||
    lowerContent.includes('was blocked') ||
    lowerContent.includes('permission denied') ||
    lowerContent.includes('access denied') ||
    lowerContent.includes('not allowed') ||
    lowerContent.includes('forbidden') ||
    lowerContent.includes('file has not been read yet') ||
    lowerContent.includes('read it first') ||
    lowerContent.includes('file not found') ||
    lowerContent.includes('no such file') ||
    (lowerContent.includes('matches of the string to replace') &&
      lowerContent.includes('but replace_all is false'))

  // Exclude false positives
  const isFalsePositive =
    lowerContent.includes('no error') ||
    lowerContent.includes('error: 0') ||
    lowerContent.includes('error code 0') ||
    lowerContent.includes('error code: 0') ||
    lowerContent.includes('(0 errors') ||
    lowerContent.includes('0 errors)') ||
    lowerContent.includes('0 error(s)')

  return hasErrorKeyword && !isFalsePositive
}

/**
 * Format line count for display
 * @param content The content to count lines in
 * @param subtractSystemLines Number of system lines to subtract (e.g., system reminder messages)
 * @returns Formatted line count string
 */
export function formatLineCount(content: string, subtractSystemLines: number = 0): string {
  const lineCount = Math.max(0, content.split('\n').length - subtractSystemLines)
  return `${lineCount} lines`
}

/**
 * Format file count for display
 * @param count Number of files
 * @returns Formatted file count string
 */
export function formatFileCount(count: number): string {
  return count === 1 ? '1 file' : `${count} files`
}

/**
 * Truncate a string to a maximum length
 * @param str The string to truncate
 * @param maxLength Maximum length before truncation
 * @returns Truncated string with ellipsis if needed
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

/**
 * Get the color class for a given approval status
 * @param approvalStatus The approval status
 * @returns The color class to apply or undefined
 */
export function getApprovalStatusColor(approvalStatus?: string): string | undefined {
  switch (approvalStatus) {
    case 'pending':
      return 'text-[var(--terminal-warning)]'
    case 'approved':
    case 'resolved':
      return 'text-[var(--terminal-success)]'
    case 'denied':
      return 'text-[var(--terminal-error)]'
    default:
      return undefined
  }
}
