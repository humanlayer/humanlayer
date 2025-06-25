import { useState, useEffect, useCallback } from 'react'
import { daemonClient, LaunchSessionRequest } from '@/lib/daemon'
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
        sessionId: response.session_id,
        runId: response.run_id,
      }
    },
  }
}

// Hook for a single session with details
export function useSession(sessionId: string | undefined) {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  if (!sessionId) {
    return {
      session: null,
      loading: false,
      error: 'No session ID provided',
    }
  }

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

    // Subscribe to session updates
    let unlisten: (() => void) | null = null
    let subscriptionId: string | null = null
    let isActive = true
    let isSubscribing = false

    const subscribe = async () => {
      // Prevent multiple simultaneous subscriptions
      if (isSubscribing || !isActive) return
      isSubscribing = true

      try {
        console.log('useSession: Subscribing to events for session:', sessionId)
        const subscription = await daemonClient.subscribeToEvents(
          {
            event_types: ['session_status_changed', 'new_approval'],
            session_id: sessionId,
          },
          {
            onEvent: event => {
              console.log('useSession.onEvent() - received event:', event)

              if (!isActive) return

              console.log('useSession.onEvent() - event.event.type:', event.event.type)

              if (
                event.event.type === 'session_status_changed' ||
                event.event.type === 'new_approval'
              ) {
                // Refresh session details when status changes or new approvals arrive
                fetchSession()
              }
            },
            onError: error => {
              console.error('Session subscription error:', error)
              // Fall back to polling for running sessions
              if (isActive && (session?.status === 'running' || session?.status === 'starting')) {
                const interval = setInterval(() => {
                  if (isActive) {
                    fetchSession()
                  }
                }, 3000)

                setTimeout(() => clearInterval(interval), 30000) // Stop polling after 30s
              }
            },
          },
        )

        // Only set these if we're still active (component hasn't unmounted)
        if (isActive) {
          unlisten = subscription.unlisten
          subscriptionId = subscription.subscriptionId
          console.log('useSession: Subscription created', { sessionId, subscriptionId })
        } else {
          // Component unmounted while subscribing, clean up immediately
          subscription.unlisten()
          await daemonClient.unsubscribeFromEvents(subscription.subscriptionId).catch(error => {
            console.error('Failed to unsubscribe from events:', error)
          })
        }
      } catch (err) {
        console.error('Failed to subscribe to session events:', err)
      } finally {
        isSubscribing = false
      }
    }

    subscribe()

    return () => {
      isActive = false
      console.log('useSession: Cleanup - unsubscribing from events', { sessionId, subscriptionId })

      // First stop listening to events
      unlisten?.()

      // Then unsubscribe from the backend to close the connection
      if (subscriptionId) {
        daemonClient.unsubscribeFromEvents(subscriptionId).catch(error => {
          console.error('Failed to unsubscribe from events:', error)
        })
      }
    }
  }, [fetchSession, sessionId])

  return {
    session,
    loading,
    error,
    refresh: fetchSession,
  }
}
