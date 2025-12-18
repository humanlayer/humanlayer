export interface FormatOptions {
  truncateLength?: number
  showLineCount?: boolean
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
 * Detect if tool result content contains an error
 * @param toolName The name of the tool
 * @param content The result content to check
 * @returns true if the content indicates an error
 */
export function detectToolError(toolName: string, content: string): boolean {
  const lowerContent = content.toLowerCase()

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
 * Strip system reminder from content
 * @param content The content to strip system reminder from
 * @returns The content without the system reminder
 */

export function stripSystemReminder(content: string): string {
  const reminderStart = content.indexOf('<system-reminder>')
  if (reminderStart === -1) {
    return content
  }

  return content.slice(0, reminderStart).trimEnd()
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
