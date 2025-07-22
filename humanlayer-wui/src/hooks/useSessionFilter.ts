import { useMemo } from 'react'
import { SessionStatus, SessionInfo } from '@/lib/daemon/types'
import { fuzzySearch, FuzzyMatch } from '@/lib/fuzzy-search'

interface ParsedFilter {
  statusFilter: SessionStatus | null
  searchText: string
}

export function parseStatusFilter(query: string): ParsedFilter {
  // Check if query contains "status:" pattern
  const statusMatch = query.match(/status:(\S+)/i)

  if (!statusMatch) {
    return { statusFilter: null, searchText: query }
  }

  const statusValue = statusMatch[1]

  // Find matching SessionStatus enum value (case-insensitive)
  const matchingStatus = Object.entries(SessionStatus).find(
    ([, value]) => value.toLowerCase() === statusValue.toLowerCase(),
  )

  if (!matchingStatus) {
    return { statusFilter: null, searchText: query }
  }

  // Remove the status filter from search text
  const searchTextWithoutFilter = query.replace(statusMatch[0], '').trim()

  return {
    statusFilter: matchingStatus[1] as SessionStatus,
    searchText: searchTextWithoutFilter,
  }
}

interface UseSessionFilterOptions {
  sessions: SessionInfo[]
  query: string
  searchFields?: string[]
}

interface UseSessionFilterResult {
  filteredSessions: SessionInfo[]
  statusFilter: SessionStatus | null
  searchText: string
  matchedSessions: Map<string, FuzzyMatch> // session id -> fuzzy match data
}

export function useSessionFilter({
  sessions,
  query,
  searchFields = ['query'],
}: UseSessionFilterOptions): UseSessionFilterResult {
  return useMemo(() => {
    // Parse the filter
    const { statusFilter, searchText } = parseStatusFilter(query)

    // Apply status filter
    let filtered = sessions
    if (statusFilter) {
      filtered = sessions.filter(session => session.status === statusFilter)
    }

    // Apply fuzzy search if there's search text
    const matchedSessions = new Map<string, FuzzyMatch>()

    if (searchText) {
      const searchResults = fuzzySearch(filtered, searchText, {
        keys: searchFields,
        threshold: 0.1,
        includeMatches: true,
      })

      // Build a map of session id to match data for highlighting
      searchResults.forEach(result => {
        matchedSessions.set(result.item.id, result)
      })

      // Update filtered to only include matched sessions
      filtered = searchResults.map(result => result.item)
    }

    return {
      filteredSessions: filtered,
      statusFilter,
      searchText,
      matchedSessions,
    }
  }, [sessions, query, searchFields])
}
