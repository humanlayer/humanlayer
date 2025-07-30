import { useEffect, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import { logger } from '@/lib/logging'
import type {
  Event,
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
    logger.log('useSubscriptions effect running', {
      connected,
      isSubscribed: isSubscribedRef.current,
    })

    if (!connected) {
      logger.log('Not connected, skipping subscription')
      return
    }

    if (isSubscribedRef.current) {
      logger.log('Already subscribed, skipping')
      return
    }

    let unsubscribe: (() => void) | null = null
    let isActive = true

    const subscribe = async () => {
      // Small delay to avoid race conditions during hot reload
      await new Promise(resolve => setTimeout(resolve, 100))

      // Double-check we're still active after the delay
      if (!isActive) {
        logger.log('Component unmounted during subscription setup')
        return
      }

      try {
        logger.log('Creating new subscription...')
        // Mark as subscribed immediately to prevent duplicate subscriptions
        isSubscribedRef.current = true

        const subscription = daemonClient.subscribeToEvents({
          event_types: ['session_status_changed', 'new_approval', 'approval_resolved'],
          onEvent: (event: Event) => {
            if (!isActive) return

            switch (event.type) {
              case 'session_status_changed': {
                const data = event.data as SessionStatusChangedEventData

                // Call handler if provided
                handlersRef.current.onSessionStatusChanged?.(data, event.timestamp.toISOString())
                break
              }
              case 'new_approval': {
                const data = event.data as NewApprovalEventData

                // Call handler if provided
                handlersRef.current.onNewApproval?.(data)
                break
              }
              case 'approval_resolved': {
                const data = event.data as ApprovalResolvedEventData

                // Call handler if provided
                handlersRef.current.onApprovalResolved?.(data)
                break
              }
            }
          },
        })

        unsubscribe = subscription.unsubscribe
        logger.log('Subscription created successfully')
      } catch (err) {
        logger.error('Failed to subscribe to events:', err)
        // Reset on error to allow retry
        isSubscribedRef.current = false
        // Handler should deal with fallback behavior
      }
    }

    subscribe()

    return () => {
      logger.log('Cleanup: Unsubscribing from session events')
      isActive = false
      // Reset the ref immediately to allow re-subscription
      isSubscribedRef.current = false

      // Call unsubscribe if it exists
      if (unsubscribe) {
        logger.log('Calling unsubscribe function')
        unsubscribe()
      } else {
        logger.log('No unsubscribe function available')
      }
    }
  }, [connected]) // Only re-subscribe when connection status changes
}
