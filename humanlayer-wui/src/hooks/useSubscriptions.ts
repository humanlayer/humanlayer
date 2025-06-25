import { useEffect, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import type {
  EventNotification,
  SessionStatusChangedEventData,
  NewApprovalEventData,
  ApprovalResolvedEventData,
} from '@/lib/daemon/types'

export interface SessionSubscriptionHandlers {
  onSessionStatusChanged?: (data: SessionStatusChangedEventData, timestamp: string) => void
  onNewApproval?: (data: NewApprovalEventData) => void
  onApprovalResolved?: (data: ApprovalResolvedEventData) => void
}

export function useSessionSubscriptions(
  connected: boolean = true,
  handlers: SessionSubscriptionHandlers = {},
) {
  const isSubscribedRef = useRef(false)
  const handlersRef = useRef(handlers)

  // Keep handlers ref up to date
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    if (!connected || isSubscribedRef.current) return

    let unsubscribe: (() => void) | null = null
    let isActive = true

    const subscribe = async () => {
      try {
        const subscription = await daemonClient.subscribeToEvents(
          {
            event_types: ['session_status_changed', 'new_approval', 'approval_resolved'],
          },
          {
            onEvent: (event: EventNotification) => {
              if (!isActive) return

              switch (event.event.type) {
                case 'session_status_changed': {
                  const data = event.event.data as SessionStatusChangedEventData
                  console.log('Session status changed:', data)

                  // Call handler if provided
                  handlersRef.current.onSessionStatusChanged?.(data, event.event.timestamp)
                  break
                }
                case 'new_approval': {
                  const data = event.event.data as NewApprovalEventData
                  console.log('New approval:', data, event)

                  // Call handler if provided
                  handlersRef.current.onNewApproval?.(data)
                  break
                }
                case 'approval_resolved': {
                  const data = event.event.data as ApprovalResolvedEventData
                  console.log('Approval resolved:', data)

                  // Call handler if provided
                  handlersRef.current.onApprovalResolved?.(data)
                  break
                }
              }
            },
            onError: (error: Error) => {
              console.error('Subscription error:', error)
              // Handler should deal with fallback behavior
            },
          },
        )

        unsubscribe = subscription.unlisten
        isSubscribedRef.current = true
        console.log('Subscribed to session events')
      } catch (err) {
        console.error('Failed to subscribe to events:', err)
        // Handler should deal with fallback behavior
      }
    }

    subscribe()

    return () => {
      console.log('Unsubscribing from session events')
      isActive = false
      isSubscribedRef.current = false
      unsubscribe?.()
    }
  }, [connected]) // Only re-subscribe when connection status changes
}
