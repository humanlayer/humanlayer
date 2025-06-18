import { useEffect, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import { useStore } from '@/AppStore'
import type {
  EventNotification,
  SessionStatusChangedEventData,
  SessionStatus,
} from '@/lib/daemon/types'

export function useSessionSubscriptions(connected: boolean = true) {
  const updateSession = useStore(state => state.updateSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const isSubscribedRef = useRef(false)

  useEffect(() => {
    if (!connected || isSubscribedRef.current) return

    let unsubscribe: (() => void) | null = null
    let isActive = true

    const subscribe = async () => {
      try {
        unsubscribe = await daemonClient.subscribeToEvents(
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

                  // Update the session status immediately
                  updateSession(data.session_id, {
                    status: data.new_status as SessionStatus,
                    last_activity_at: event.event.timestamp,
                  })
                  break
                }
                case 'approval_requested':
                case 'approval_resolved': {
                  // Refresh sessions to get latest approval counts/status
                  refreshSessions()
                  break
                }
              }
            },
            onError: (error: Error) => {
              console.error('Subscription error:', error)
              // Fall back to periodic refresh on subscription failure
              if (isActive) {
                const interval = setInterval(() => {
                  if (isActive) {
                    refreshSessions()
                  }
                }, 5000)

                return () => clearInterval(interval)
              }
            },
          },
        )

        isSubscribedRef.current = true
        console.log('Subscribed to session events')
      } catch (err) {
        console.error('Failed to subscribe to events:', err)
        // Fall back to periodic refresh
        if (isActive) {
          const interval = setInterval(() => {
            if (isActive) {
              refreshSessions()
            }
          }, 5000)

          return () => clearInterval(interval)
        }
      }
    }

    subscribe()

    return () => {
      isActive = false
      isSubscribedRef.current = false
      unsubscribe?.()
    }
  }, [connected, updateSession, refreshSessions])
}
