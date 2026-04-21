import { useEffect, useMemo } from 'react'
import type { ConversationEvent } from '@/lib/daemon/types'
import { useStore } from '@/AppStore'
import {
  searchConversationEvents,
  type SearchMatchGroup,
} from '@/lib/conversation-search'

export function useConversationSearch(
  events: ConversationEvent[],
  toolResultsByKey: Record<string, ConversationEvent>,
) {
  const isOpen = useStore(s => s.conversationSearch.isOpen)
  const query = useStore(s => s.conversationSearch.query)
  const currentMatchIndex = useStore(s => s.conversationSearch.currentMatchIndex)
  const setMatchCount = useStore(s => s.setConversationSearchMatchCount)

  const matchGroups = useMemo<SearchMatchGroup[]>(
    () => (isOpen && query ? searchConversationEvents(events, toolResultsByKey, query) : []),
    [events, toolResultsByKey, query, isOpen],
  )

  const navigableMatches = useMemo(
    () => matchGroups.filter(g => !g.isToolResult),
    [matchGroups],
  )

  useEffect(() => {
    setMatchCount(navigableMatches.length)
  }, [navigableMatches.length, setMatchCount])

  const currentMatch = currentMatchIndex >= 0 ? navigableMatches[currentMatchIndex] ?? null : null

  const matchesByEventId = useMemo(() => {
    const map = new Map<number, SearchMatchGroup>()
    matchGroups.forEach(g => map.set(g.eventId, g))
    return map
  }, [matchGroups])

  // Map tool call's toolId -> total match count inside the tool result
  const toolResultMatchCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of matchGroups) {
      if (!g.isToolResult) continue
      const resultEvent = events.find(e => e.id === g.eventId)
      if (!resultEvent?.toolResultForId) continue
      const totalHits = g.matches.reduce((sum, m) => sum + m.indices.length, 0)
      map.set(resultEvent.toolResultForId, (map.get(resultEvent.toolResultForId) || 0) + totalHits)
    }
    return map
  }, [matchGroups, events])

  // Map parentToolUseId -> total match count for events inside that task group
  const taskGroupMatchCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of matchGroups) {
      if (!g.parentToolUseId) continue
      const totalHits = g.matches.reduce((sum, m) => sum + m.indices.length, 0)
      map.set(g.parentToolUseId, (map.get(g.parentToolUseId) || 0) + totalHits)
    }
    return map
  }, [matchGroups])

  return {
    isOpen,
    query,
    currentMatchIndex,
    matchGroups,
    navigableMatches,
    currentMatch,
    matchesByEventId,
    toolResultMatchCounts,
    taskGroupMatchCounts,
    totalNavigableMatches: navigableMatches.length,
  }
}
