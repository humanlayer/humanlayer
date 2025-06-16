import { useState, useEffect, useCallback } from 'react'
import { daemonClient, SessionStatus, LaunchSessionRequest } from '@/lib/daemon'
import { SessionSummary } from '@/types/ui'
import { formatError } from '@/utils/errors'

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
      
      const response = await daemonClient.listSessions()
      
      // Transform to UI-friendly format
      const summaries: SessionSummary[] = response.sessions.map(session => ({
        id: session.id,
        runId: session.run_id,
        status: session.status,
        query: session.query,
        model: session.model || 'default',
        startTime: new Date(session.start_time),
        endTime: session.end_time ? new Date(session.end_time) : undefined,
        hasApprovals: false // Will be enriched later if needed
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
  const launchSession = useCallback(async (request: LaunchSessionRequest) => {
    try {
      const response = await daemonClient.launchSession(request)
      // Refresh the list after launching
      await fetchSessions()
      return response
    } catch (err) {
      throw new Error(formatError(err))
    }
  }, [fetchSessions])

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
    launchSession
  }
}

// Hook for a single session with details
export function useSession(sessionId: string) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSession = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await daemonClient.getSessionState(sessionId)
      setSession(response.session)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    fetchSession()
    // Poll for updates while session is running
    const interval = setInterval(() => {
      if (session?.status === 'running' || session?.status === 'starting') {
        fetchSession()
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [fetchSession, session?.status])

  return {
    session,
    loading,
    error,
    refresh: fetchSession
  }
}