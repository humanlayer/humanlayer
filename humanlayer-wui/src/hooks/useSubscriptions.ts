import { useEffect, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import {
  isNewApprovalEvent,
  isApprovalResolvedEvent,
  isSessionStatusChangedEvent,
} from '@/lib/daemon/types'
import type {
  SessionStatusChangedEventData,
  NewApprovalEventData,
  ApprovalResolvedEventData,
  EventNotification,
  DaemonEvent,
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
    console.log('useSubscriptions effect running', {
      connected,
      isSubscribed: isSubscribedRef.current,
    })

    if (!connected) {
      console.log('Not connected, skipping subscription')
      return
    }

    if (isSubscribedRef.current) {
      console.log('Already subscribed, skipping')
      return
    }

    let unsubscribe: (() => void) | null = null
    let isActive = true

    const subscribe = async () => {
      // Small delay to avoid race conditions during hot reload
      await new Promise(resolve => setTimeout(resolve, 100))

      // Double-check we're still active after the delay
      if (!isActive) {
        console.log('Component unmounted during subscription setup')
        return
      }

      try {
        console.log('Creating new subscription...')
        // Mark as subscribed immediately to prevent duplicate subscriptions
        isSubscribedRef.current = true

        const subscription = await daemonClient.subscribeToEvents(
          {
            event_types: ['session_status_changed', 'new_approval', 'approval_resolved'],
          },
          {
            onEvent: (notification: EventNotification) => {
              if (!isActive) return

              const { event } = notification
              // Cast legacy Event to DaemonEvent for type guards
              const daemonEvent = event as unknown as DaemonEvent

              if (isSessionStatusChangedEvent(daemonEvent)) {
                console.log('Session status changed:', daemonEvent.data)
                // Call handler if provided
                handlersRef.current.onSessionStatusChanged?.(daemonEvent.data, daemonEvent.timestamp)
              } else if (isNewApprovalEvent(daemonEvent)) {
                console.log('New approval:', daemonEvent.data, notification)
                // Call handler if provided
                handlersRef.current.onNewApproval?.(daemonEvent.data)
              } else if (isApprovalResolvedEvent(daemonEvent)) {
                console.log('Approval resolved:', daemonEvent.data)
                // Call handler if provided
                handlersRef.current.onApprovalResolved?.(daemonEvent.data)
              }
            },
            onError: (error: Error) => {
              console.error('Subscription error:', error)
              // Handler should deal with fallback behavior
            },
          },
        )

        unsubscribe = subscription.unlisten
        console.log('Subscription created successfully')
      } catch (err) {
        console.error('Failed to subscribe to events:', err)
        // Reset on error to allow retry
        isSubscribedRef.current = false
        // Handler should deal with fallback behavior
      }
    }

    subscribe()

    return () => {
      console.log('Cleanup: Unsubscribing from session events')
      isActive = false
      // Reset the ref immediately to allow re-subscription
      isSubscribedRef.current = false

      // Call unsubscribe if it exists
      if (unsubscribe) {
        console.log('Calling unsubscribe function')
        unsubscribe()
      } else {
        console.log('No unsubscribe function available')
      }
    }
  }, [connected]) // Only re-subscribe when connection status changes
}
