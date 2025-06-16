import { useState, useEffect, useCallback } from 'react'
import { daemonClient } from '@/lib/daemon'
import { UnifiedApprovalRequest } from '@/types/ui'
import { enrichApprovals } from '@/utils/enrichment'
import { formatError } from '@/utils/errors'

interface UseApprovalsReturn {
  approvals: UnifiedApprovalRequest[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  // eslint-disable-next-line no-unused-vars
  approve: (callId: string, comment?: string) => Promise<void>
  // eslint-disable-next-line no-unused-vars
  deny: (callId: string, reason: string) => Promise<void>
  // eslint-disable-next-line no-unused-vars
  respond: (callId: string, response: string) => Promise<void>
}

export function useApprovals(sessionId?: string): UseApprovalsReturn {
  const [approvals, setApprovals] = useState<UnifiedApprovalRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch approvals and sessions in parallel
      const [approvalsResponse, sessionsResponse] = await Promise.all([
        daemonClient.fetchApprovals(sessionId),
        daemonClient.listSessions(),
      ])

      // Enrich approvals with session context
      const enriched = enrichApprovals(approvalsResponse.approvals, sessionsResponse.sessions)

      setApprovals(enriched)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Initial fetch
  useEffect(() => {
    fetchApprovals()
  }, [fetchApprovals])

  // Approve a function call
  const approve = useCallback(
    async (callId: string, comment?: string) => {
      try {
        await daemonClient.approveFunctionCall(callId, comment)
        // Refresh the list after approval
        await fetchApprovals()
      } catch (err) {
        throw new Error(formatError(err))
      }
    },
    [fetchApprovals],
  )

  // Deny a function call
  const deny = useCallback(
    async (callId: string, reason: string) => {
      try {
        await daemonClient.denyFunctionCall(callId, reason)
        // Refresh the list after denial
        await fetchApprovals()
      } catch (err) {
        throw new Error(formatError(err))
      }
    },
    [fetchApprovals],
  )

  // Respond to human contact
  const respond = useCallback(
    async (callId: string, response: string) => {
      try {
        await daemonClient.respondToHumanContact(callId, response)
        // Refresh the list after response
        await fetchApprovals()
      } catch (err) {
        throw new Error(formatError(err))
      }
    },
    [fetchApprovals],
  )

  return {
    approvals,
    loading,
    error,
    refresh: fetchApprovals,
    approve,
    deny,
    respond,
  }
}

// Hook for real-time updates
export function useApprovalsWithSubscription(sessionId?: string): UseApprovalsReturn {
  const base = useApprovals(sessionId)

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let isSubscribed = true

    const subscribe = async () => {
      try {
        unsubscribe = await daemonClient.subscribeToEvents(
          {
            event_types: ['approval_requested', 'approval_resolved', 'session_status_changed'],
            session_id: sessionId,
          },
          {
            onEvent: event => {
              if (!isSubscribed) return

              // Handle different event types
              switch (event.event.type) {
                case 'approval_requested':
                case 'approval_resolved':
                  // Refresh approvals when relevant events occur
                  base.refresh()
                  break
                case 'session_status_changed':
                  // Could update session status if needed
                  break
              }
            },
            onError: error => {
              console.error('Subscription error:', error)
            },
          },
        )
      } catch (err) {
        console.error('Failed to subscribe to events:', err)
        // Fall back to polling on subscription failure
        const interval = setInterval(() => {
          if (isSubscribed) {
            base.refresh()
          }
        }, 5000)

        return () => clearInterval(interval)
      }
    }

    subscribe()

    return () => {
      isSubscribed = false
      unsubscribe?.()
    }
  }, [sessionId, base.refresh])

  return base
}
