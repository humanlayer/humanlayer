import { useEffect, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import type {
  EventNotification,
  SessionStatusChangedEventData,
  ApprovalRequestedEventData,
  ApprovalResolvedEventData,
} from '@/lib/daemon/types'

export interface SessionSubscriptionHandlers {
  onSessionStatusChanged?: (data: SessionStatusChangedEventData, timestamp: string) => void
  onApprovalRequested?: (data: ApprovalRequestedEventData) => void
  onApprovalResolved?: (data: ApprovalResolvedEventData) => void
}

export function useSessionSubscriptions(
  connected: boolean = true,
  handlers: SessionSubscriptionHandlers = {},
) {
  const isSubscribedRef = useRef(false)

  useEffect(() => {
    if (!connected || isSubscribedRef.current) return

    let unsubscribe: (() => void) | null = null
    let isActive = true

    const subscribe = async () => {
      try {
        const subscription = await daemonClient.subscribeToEvents(
          {
            event_types: ['session_status_changed', 'approval_requested', 'approval_resolved'],
          },
          {
            onEvent: (event: EventNotification) => {
              if (!isActive) return

              switch (event.event.type) {
                case 'session_status_changed': {
                  const data = event.event.data as SessionStatusChangedEventData
                  console.log('Session status changed:', data)

                  // Call handler if provided
                  handlers.onSessionStatusChanged?.(data, event.event.timestamp)
                  break
                }
                case 'approval_requested': {
                  const data = event.event.data as ApprovalRequestedEventData
                  console.log('Approval requested:', data)

                  // Call handler if provided
                  handlers.onApprovalRequested?.(data)
                  break
                }
                case 'approval_resolved': {
                  const data = event.event.data as ApprovalResolvedEventData
                  console.log('Approval resolved:', data)

                  // Call handler if provided
                  handlers.onApprovalResolved?.(data)
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
      isActive = false
      isSubscribedRef.current = false
      unsubscribe?.()
    }
  }, [connected, handlers])
}
