import { useState, useEffect, useCallback } from 'react'
import { daemonClient, LaunchSessionRequest } from '@/lib/daemon'
import { SessionSummary } from '@/types/ui'
import { formatError } from '@/utils/errors'
import { useStore } from '@/AppStore'

interface UseSessionsReturn {
  sessions: SessionSummary[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  launchSession: (request: LaunchSessionRequest) => Promise<{ sessionId: string; runId: string }>
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await daemonClient.getSessionLeaves()

      // Transform to UI-friendly format
      const summaries: SessionSummary[] = response.sessions.map(session => ({
        id: session.id,
        runId: session.run_id,
        status: session.status,
        query: session.query,
        model: session.model || 'default',
        startTime: new Date(session.start_time),
        endTime: session.end_time ? new Date(session.end_time) : undefined,
        hasApprovals: false, // Will be enriched later if needed
      }))

      // Sort by start time (newest first)
      summaries.sort((a, b) => b.startTime.getTime() - a.startTime.getTime())

      setSessions(summaries)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Launch a new session
  const launchSession = useCallback(
    async (request: LaunchSessionRequest) => {
      try {
        const response = await daemonClient.launchSession(request)
        // Refresh the list after launching
        await fetchSessions()
        return response
      } catch (err) {
        throw new Error(formatError(err))
      }
    },
    [fetchSessions],
  )

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
    launchSession: async (request: LaunchSessionRequest) => {
      const response = await launchSession(request)
      return {
        sessionId: response.id,
        runId: response.run_id,
      }
    },
  }
}

// Hook for a single session with details - now reads from Zustand store
export function useSession(sessionId: string | undefined) {
  const activeSessionDetail = useStore(state => state.activeSessionDetail)
  const fetchActiveSessionDetail = useStore(state => state.fetchActiveSessionDetail)
  const clearActiveSessionDetail = useStore(state => state.clearActiveSessionDetail)

  const fetchSession = useCallback(async () => {
    if (!sessionId) return
    await fetchActiveSessionDetail(sessionId)
  }, [sessionId, fetchActiveSessionDetail])

  useEffect(() => {
    // Fetch session details when sessionId changes
    if (sessionId) {
      fetchSession()
    }

    // Clear active session detail when component unmounts
    return () => {
      clearActiveSessionDetail()
    }
  }, [sessionId])

  if (!sessionId) {
    return {
      session: null,
      loading: false,
      error: 'No session ID provided',
    }
  }

  return {
    session: activeSessionDetail?.session || null,
    loading: activeSessionDetail?.loading || false,
    error: activeSessionDetail?.error || null,
    refresh: fetchSession,
  }
}
