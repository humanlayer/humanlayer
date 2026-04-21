import { describe, test, expect } from 'bun:test'
import {
  findSubstringIndices,
  highlightSubstringMatches,
  searchConversationEvents,
} from './conversation-search'
import type { ConversationEvent } from '@/lib/daemon/types'
import { ConversationEventType } from '@/lib/daemon/types'

describe('findSubstringIndices', () => {
  test('returns empty array for empty query', () => {
    expect(findSubstringIndices('hello world', '')).toEqual([])
  })

  test('returns empty array for empty text', () => {
    expect(findSubstringIndices('', 'foo')).toEqual([])
  })

  test('returns empty array when there is no match', () => {
    expect(findSubstringIndices('hello world', 'xyz')).toEqual([])
  })

  test('returns a single match index', () => {
    expect(findSubstringIndices('hello world', 'world')).toEqual([6])
  })

  test('returns multiple match indices', () => {
    expect(findSubstringIndices('the quick brown fox the lazy the', 'the')).toEqual([0, 20, 29])
  })

  test('is case-insensitive', () => {
    expect(findSubstringIndices('Hello WORLD hello', 'hello')).toEqual([0, 12])
  })

  test('handles overlapping searches by skipping past match', () => {
    // 'aaaa' searching 'aa' -> non-overlapping matches at 0, 2
    expect(findSubstringIndices('aaaa', 'aa')).toEqual([0, 2])
  })

  test('handles full-string match', () => {
    expect(findSubstringIndices('foo', 'foo')).toEqual([0])
  })
})

describe('highlightSubstringMatches', () => {
  test('returns empty array for empty text', () => {
    expect(highlightSubstringMatches('', 'foo')).toEqual([])
  })

  test('returns single non-match segment when query is empty', () => {
    expect(highlightSubstringMatches('hello', '')).toEqual([{ text: 'hello', isMatch: false }])
  })

  test('returns single non-match segment when no matches', () => {
    expect(highlightSubstringMatches('hello', 'xyz')).toEqual([{ text: 'hello', isMatch: false }])
  })

  test('splits into match and non-match segments', () => {
    expect(highlightSubstringMatches('abc world def', 'world')).toEqual([
      { text: 'abc ', isMatch: false },
      { text: 'world', isMatch: true },
      { text: ' def', isMatch: false },
    ])
  })

  test('handles multiple matches', () => {
    expect(highlightSubstringMatches('foo bar foo', 'foo')).toEqual([
      { text: 'foo', isMatch: true },
      { text: ' bar ', isMatch: false },
      { text: 'foo', isMatch: true },
    ])
  })

  test('handles adjacent matches', () => {
    expect(highlightSubstringMatches('foofoo', 'foo')).toEqual([
      { text: 'foo', isMatch: true },
      { text: 'foo', isMatch: true },
    ])
  })

  test('handles full-string match', () => {
    expect(highlightSubstringMatches('foo', 'foo')).toEqual([{ text: 'foo', isMatch: true }])
  })

  test('preserves original casing of matches', () => {
    expect(highlightSubstringMatches('Hello WORLD', 'world')).toEqual([
      { text: 'Hello ', isMatch: false },
      { text: 'WORLD', isMatch: true },
    ])
  })
})

function makeEvent(partial: Partial<ConversationEvent> & { id: number }): ConversationEvent {
  return {
    sessionId: 'session-1',
    sequence: partial.id,
    eventType: ConversationEventType.Message,
    createdAt: new Date(),
    ...partial,
  } as ConversationEvent
}

describe('searchConversationEvents', () => {
  test('returns empty when query is empty', () => {
    const events = [makeEvent({ id: 1, content: 'hello world' })]
    expect(searchConversationEvents(events, {}, '')).toEqual([])
  })

  test('returns empty when there are no events', () => {
    expect(searchConversationEvents([], {}, 'query')).toEqual([])
  })

  test('matches content on user/assistant messages', () => {
    const events = [
      makeEvent({ id: 1, content: 'the quick brown fox' }),
      makeEvent({ id: 2, content: 'nothing to see here' }),
    ]
    const result = searchConversationEvents(events, {}, 'quick')
    expect(result).toHaveLength(1)
    expect(result[0].eventId).toBe(1)
    expect(result[0].isToolResult).toBe(false)
    expect(result[0].matches[0].field).toBe('content')
  })

  test('matches on toolName and toolInputJson for tool call events', () => {
    const events = [
      makeEvent({
        id: 10,
        eventType: ConversationEventType.ToolCall,
        toolName: 'Bash',
        toolInputJson: '{"command":"ls /tmp"}',
        toolId: 'tool-10',
      }),
    ]
    const nameResult = searchConversationEvents(events, {}, 'Bash')
    expect(nameResult[0].matches.some(m => m.field === 'toolName')).toBe(true)

    const inputResult = searchConversationEvents(events, {}, '/tmp')
    expect(inputResult[0].matches.some(m => m.field === 'toolInputJson')).toBe(true)
  })

  test('surfaces matches in tool results as separate groups', () => {
    const toolCall = makeEvent({
      id: 20,
      eventType: ConversationEventType.ToolCall,
      toolName: 'Read',
      toolInputJson: '{}',
      toolId: 'tool-20',
    })
    const toolResult = makeEvent({
      id: 21,
      eventType: ConversationEventType.ToolResult,
      toolResultForId: 'tool-20',
      toolResultContent: 'the answer is 42',
    })
    const events = [toolCall, toolResult]
    const toolResultsByKey: Record<string, ConversationEvent> = { 'tool-20': toolResult }

    const result = searchConversationEvents(events, toolResultsByKey, 'answer')
    // One group: the tool result match
    expect(result).toHaveLength(1)
    expect(result[0].isToolResult).toBe(true)
    expect(result[0].eventId).toBe(21)
  })

  test('preserves event sequence order', () => {
    const events = [
      makeEvent({ id: 1, content: 'alpha' }),
      makeEvent({ id: 2, content: 'beta' }),
      makeEvent({ id: 3, content: 'alpha again' }),
    ]
    const result = searchConversationEvents(events, {}, 'alpha')
    expect(result.map(g => g.eventId)).toEqual([1, 3])
  })

  test('tracks parentToolUseId for sub-task events', () => {
    const events = [
      makeEvent({
        id: 100,
        eventType: ConversationEventType.ToolCall,
        toolName: 'Task',
        toolInputJson: '{}',
        toolId: 'task-100',
      }),
      makeEvent({
        id: 101,
        content: 'inside the task',
        parentToolUseId: 'task-100',
      }),
    ]
    const result = searchConversationEvents(events, {}, 'inside')
    expect(result).toHaveLength(1)
    expect(result[0].eventId).toBe(101)
    expect(result[0].parentToolUseId).toBe('task-100')
  })

  test('top-level events with empty-string parentToolUseId have no parentToolUseId', () => {
    const events = [makeEvent({ id: 1, content: 'hello', parentToolUseId: '' })]
    const result = searchConversationEvents(events, {}, 'hello')
    expect(result).toHaveLength(1)
    expect(result[0].parentToolUseId).toBeUndefined()
  })
})
