import { useState, useEffect, useCallback } from 'react'
import { daemonClient } from '@/lib/daemon'
import { Approval } from '@/lib/daemon/types'
import { formatError } from '@/utils/errors'

interface UseApprovalsReturn {
  approvals: Approval[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>

  approve: (approvalId: string, comment?: string) => Promise<void>

  deny: (approvalId: string, reason: string) => Promise<void>
}

export function useApprovals(sessionId?: string): UseApprovalsReturn {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Fetch approvals
      const approvalsResponse = await daemonClient.fetchApprovals(sessionId)

      setApprovals(approvalsResponse.approvals)
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
    async (approvalId: string, comment?: string) => {
      try {
        await daemonClient.approveFunctionCall(approvalId, comment)
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
    async (approvalId: string, reason: string) => {
      try {
        await daemonClient.denyFunctionCall(approvalId, reason)
        // Refresh the list after denial
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
        const { unlisten } = await daemonClient.subscribeToEvents(
          {
            event_types: ['new_approval', 'approval_resolved', 'session_status_changed'],
            session_id: sessionId,
          },
          {
            onEvent: event => {
              if (!isSubscribed) return

              // Handle different event types
              switch (event.event.type) {
                case 'new_approval':
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
        unsubscribe = unlisten
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
