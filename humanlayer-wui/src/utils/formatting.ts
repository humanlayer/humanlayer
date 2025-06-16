// UI formatting utilities

export function truncate(text: string, maxLength: number): string {
  // Replace whitespace with single spaces
  const cleaned = text.replace(/[\n\r\t]+/g, ' ').trim()

  if (cleaned.length <= maxLength) {
    return cleaned
  }

  if (maxLength > 3) {
    return cleaned.substring(0, maxLength - 3) + '...'
  }
  return cleaned.substring(0, maxLength)
}

export function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  // For older dates, show actual date
  return d.toLocaleDateString()
}

export function formatDuration(startTime: Date | string, endTime?: Date | string): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime
  const end = endTime ? (typeof endTime === 'string' ? new Date(endTime) : endTime) : new Date()

  const diffMs = end.getTime() - start.getTime()
  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
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
