import type { ConversationEvent } from '@/lib/daemon/types'
import { ConversationEventType } from '@/lib/daemon/types'

export type SearchMatchField = 'content' | 'toolName' | 'toolInputJson' | 'toolResultContent'

export interface SearchMatch {
  eventId: number
  field: SearchMatchField
  indices: number[]
  fieldText: string
}

export interface SearchMatchGroup {
  eventId: number
  matches: SearchMatch[]
  isToolResult: boolean
  parentToolUseId?: string
}

export function findSubstringIndices(text: string, query: string): number[] {
  if (!text || !query) return []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const indices: number[] = []
  let from = 0
  while (from <= lowerText.length - lowerQuery.length) {
    const idx = lowerText.indexOf(lowerQuery, from)
    if (idx === -1) break
    indices.push(idx)
    from = idx + lowerQuery.length
  }
  return indices
}

export function highlightSubstringMatches(
  text: string,
  query: string,
): Array<{ text: string; isMatch: boolean }> {
  if (!text) return []
  if (!query) return [{ text, isMatch: false }]

  const indices = findSubstringIndices(text, query)
  if (indices.length === 0) return [{ text, isMatch: false }]

  const segments: Array<{ text: string; isMatch: boolean }> = []
  let cursor = 0
  for (const idx of indices) {
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), isMatch: false })
    }
    segments.push({ text: text.slice(idx, idx + query.length), isMatch: true })
    cursor = idx + query.length
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false })
  }
  return segments
}

export function searchConversationEvents(
  events: ConversationEvent[],
  toolResultsByKey: Record<string, ConversationEvent>,
  query: string,
): SearchMatchGroup[] {
  if (!query) return []

  const groups: SearchMatchGroup[] = []

  for (const event of events) {
    const matches: SearchMatch[] = []
    const isToolResultEvent = event.eventType === ConversationEventType.ToolResult

    const checkField = (field: SearchMatchField, text: string | undefined | null) => {
      if (!text) return
      const indices = findSubstringIndices(text, query)
      if (indices.length > 0) {
        matches.push({ eventId: event.id, field, indices, fieldText: text })
      }
    }

    // Skip tool result events here — we gather their matches from parent tool call lookup below
    if (!isToolResultEvent) {
      checkField('content', event.content)
      if (event.eventType === ConversationEventType.ToolCall) {
        checkField('toolName', event.toolName)
        checkField('toolInputJson', event.toolInputJson)
      }
    }

    if (matches.length > 0) {
      groups.push({
        eventId: event.id,
        matches,
        isToolResult: false,
        parentToolUseId: event.parentToolUseId || undefined,
      })
    }

    // For tool call events, also surface matches from their associated tool result
    if (event.eventType === ConversationEventType.ToolCall && event.toolId) {
      const result = toolResultsByKey[event.toolId]
      if (result) {
        const resultIndices = findSubstringIndices(result.toolResultContent || '', query)
        if (resultIndices.length > 0) {
          groups.push({
            eventId: result.id,
            matches: [
              {
                eventId: result.id,
                field: 'toolResultContent',
                indices: resultIndices,
                fieldText: result.toolResultContent || '',
              },
            ],
            isToolResult: true,
            parentToolUseId: event.parentToolUseId || undefined,
          })
        }
      }
    }
  }

  return groups
}
