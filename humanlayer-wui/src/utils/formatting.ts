import { format, formatDistanceToNow, parseISO, isValid, intervalToDuration } from 'date-fns'

// UI formatting utilities

export function truncate(text: string, maxLength: number): string {
  const cleaned = text.replace(/[\n\r\t]+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  if (maxLength > 3) return cleaned.substring(0, maxLength - 3) + '...'
  return cleaned.substring(0, maxLength)
}

// Standard date parsing - handles both Date objects and ISO strings
function parseDate(date: Date | string): Date {
  if (typeof date === 'string') {
    return parseISO(date)
  }
  return date
}

export function formatTimestamp(date: Date | string): string {
  const d = parseDate(date)
  if (!isValid(d)) return 'Invalid date'

  // Use date-fns for relative time formatting
  let distance = formatDistanceToNow(d, { addSuffix: true })

  // Replace "less than a minute ago" with "<1 minute ago"
  if (distance === 'less than a minute ago') {
    distance = '<1 minute ago'
  }

  // Replace "about X hours ago" with "~X hours ago"
  distance = distance.replace(/^about (\d+ hours? ago)/, '~$1')

  // For dates older than 7 days, show actual date
  const daysDiff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (daysDiff > 7) {
    return format(d, 'MMM d, yyyy')
  }

  return distance
}

export function formatAbsoluteTimestamp(date: Date | string): string {
  const d = parseDate(date)
  if (!isValid(d)) return 'Invalid date'
  return format(d, 'MMMM d, yyyy h:mm a')
}

export function formatDuration(startTime: Date | string, endTime?: Date | string): string {
  const start = parseDate(startTime)
  const end = endTime ? parseDate(endTime) : new Date()

  if (!isValid(start) || !isValid(end)) return 'Invalid duration'

  const duration = intervalToDuration({ start, end })

  if (duration.hours && duration.hours > 0) {
    return `${duration.hours}h ${duration.minutes || 0}m`
  }
  if (duration.minutes && duration.minutes > 0) {
    return `${duration.minutes}m ${duration.seconds || 0}s`
  }
  return `${duration.seconds || 0}s`
}

export function formatParameters(params: Record<string, any>, maxLength: number = 100): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return ''

  const parts: string[] = []
  let totalLength = 0

  for (const [key, value] of entries) {
    const formatted = `${key}=${JSON.stringify(value)}`
    if (totalLength + formatted.length + (parts.length > 0 ? 2 : 0) > maxLength) {
      if (parts.length === 0) {
        // At least show truncated first param
        parts.push(truncate(formatted, maxLength - 3))
      }
      parts.push('...')
      break
    }
    parts.push(formatted)
    totalLength += formatted.length + (parts.length > 1 ? 2 : 0)
  }

  return parts.join(', ')
}

export function truncatePath(path: string | undefined, maxLength: number = 40): string {
  if (!path) return '-'

  // If path fits, return as-is
  if (path.length <= maxLength) return path

  // Handle home directory replacement
  const homePath = path.replace(/^(\/Users|\/home)\/[^/]+/, '~')

  // If home-replaced path fits, use it
  if (homePath.length <= maxLength) return homePath

  // Smart truncation: preserve the end of the path
  const parts = homePath.split('/')

  // If we have path segments, try to preserve the last few
  if (parts.length > 2) {
    // Keep trying to add parts from the end until we exceed maxLength
    let result = parts[parts.length - 1]
    for (let i = parts.length - 2; i >= 0; i--) {
      const testResult = parts[i] + '/' + result
      if (testResult.length + 3 > maxLength) {
        // +3 for "..."
        return '.../' + result
      }
      result = testResult
    }
    return result
  }

  // Fallback: simple end truncation ensuring at least 30 chars visible
  const minEndChars = Math.min(30, maxLength - 3)
  return '...' + homePath.slice(-minEndChars)
}

/**
 * Parse MCP tool name format: mcp__service__method
 * @param toolName - Raw MCP tool name (e.g., 'mcp__linear__create_comment')
 * @returns Parsed service and method names
 */
export function parseMcpToolName(toolName: string): { service: string; method: string } {
  const parts = toolName.split('__')
  return {
    service: parts[1] || 'unknown',
    method: parts.slice(2).join('__') || 'unknown', // Handle methods with __ in name
  }
}

/**
 * Format MCP tool name for display
 * @param toolName - Raw MCP tool name (e.g., 'mcp__linear__create_comment')
 * @returns Formatted display name (e.g., 'linear - create comment')
 */
export function formatMcpToolName(toolName: string): string {
  const { service, method } = parseMcpToolName(toolName)
  return `${service} - ${method.replace(/_/g, ' ')}`
}

/**
 * Get formatted session text for notifications
 * Prioritizes human-readable title/summary over raw query and truncates to maxLength
 * @param session - Session object with optional title, summary, and query fields
 * @param maxLength - Maximum length of the returned text (default: 40)
 * @returns Formatted session text truncated to maxLength
 */
export function getSessionNotificationText(
  session: { title?: string; summary?: string; query: string },
  maxLength: number = 40,
): string {
  const text = session.title || session.summary || session.query
  return text.trim().slice(0, maxLength)
}
