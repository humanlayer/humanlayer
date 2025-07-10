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
  const distance = formatDistanceToNow(d, { addSuffix: true })

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
  const homePath = path.replace(/^\/Users\/[^/]+/, '~')
  
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
      if (testResult.length + 3 > maxLength) { // +3 for "..."
        return '.../' + result
      }
      result = testResult
    }
    return result
  }
  
  // Fallback: simple end truncation ensuring at least 30 chars visible
  const minEndChars = Math.min(30, maxLength - 3)
  return '...' + homePath.slice(-(minEndChars))
}
