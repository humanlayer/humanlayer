import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import { SessionInfo, ViewMode } from '@/lib/daemon/types'
import { formatError } from '@/utils/errors'

interface UsePaginatedSessionsOptions {
  viewMode: ViewMode
  pageSize?: number
}

interface UsePaginatedSessionsReturn {
  sessions: SessionInfo[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  totalCount: number

  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

export function usePaginatedSessions({
  viewMode,
  pageSize = 50,
}: UsePaginatedSessionsOptions): UsePaginatedSessionsReturn {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)

  // Track if we're currently fetching to prevent duplicate requests
  const fetchingRef = useRef(false)

  const fetchSessions = useCallback(
    async (reset = false) => {
      if (fetchingRef.current && !reset) return

      try {
        fetchingRef.current = true

        if (reset) {
          setLoading(true)
          setOffset(0)
        } else {
          setLoadingMore(true)
        }

        setError(null)

        const response = await daemonClient.getSessionLeaves({
          include_archived: viewMode === ViewMode.Archived,
          archived_only: viewMode === ViewMode.Archived,
          limit: pageSize,
          offset: reset ? 0 : offset,
        })

        if (reset) {
          setSessions(response.sessions)
        } else {
          setSessions(prev => [...prev, ...response.sessions])
        }

        setHasMore(response.has_more)
        setTotalCount(response.total_count)

        if (response.next_offset) {
          setOffset(response.next_offset)
        }
      } catch (err) {
        setError(formatError(err))
      } finally {
        setLoading(false)
        setLoadingMore(false)
        fetchingRef.current = false
      }
    },
    [viewMode, pageSize, offset],
  )

  // Initial fetch when viewMode changes
  useEffect(() => {
    fetchSessions(true)
  }, [viewMode]) // Don't include fetchSessions to avoid infinite loop

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return
    await fetchSessions(false)
  }, [hasMore, loadingMore, loading, fetchSessions])

  const refresh = useCallback(async () => {
    await fetchSessions(true)
  }, [fetchSessions])

  return {
    sessions,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    loadMore,
    refresh,
  }
}
