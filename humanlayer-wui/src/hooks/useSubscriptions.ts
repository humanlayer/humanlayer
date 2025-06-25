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
    console.log('useSubscriptions effect running', { 
      connected, 
      isSubscribed: isSubscribedRef.current 
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
