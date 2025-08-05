import { useEffect } from 'react'
import { useStore } from '@/AppStore'
import { daemonClient } from '@/lib/daemon'
import { notificationService } from '@/services/NotificationService'
import { useLocation } from 'react-router-dom'
/**
 * Global monitor for yolo mode (bypassing permissions) timers.
 * Watches all sessions and automatically disables yolo mode when timers expire,
 * regardless of which session is currently being viewed.
 */
export const YoloModeMonitor = () => {
  const { sessions, updateSession } = useStore()
  const location = useLocation()

  useEffect(() => {
    // Track intervals for each session
    const intervals = new Map<string, ReturnType<typeof setInterval>>()

    // Set up monitoring for each session with active yolo mode
    sessions.forEach(session => {
      if (session.dangerously_skip_permissions && session.dangerously_skip_permissions_expires_at) {
        const checkExpiration = async () => {
          const now = new Date().getTime()
          const expiry = new Date(session.dangerously_skip_permissions_expires_at!).getTime()
          const remaining = expiry - now

          if (remaining <= 0) {
            try {
              // Update local state immediately
              updateSession(session.id, {
                dangerously_skip_permissions: false,
                dangerously_skip_permissions_expires_at: undefined,
              })

              // Update backend
              await daemonClient.updateSessionSettings(session.id, {
                dangerously_skip_permissions: false,
                dangerously_skip_permissions_timeout_ms: undefined,
              })

              // Only show notification if not currently viewing this session
              const isViewingSession = location.pathname === `/session/${session.id}`
              if (!isViewingSession) {
                // Show notification using NotificationService
                await notificationService.notify({
                  type: 'settings_changed',
                  title: 'Bypassing permissions expired',
                  body: `Session: ${session.title || session.summary || 'Untitled'}`,
                  metadata: {
                    sessionId: session.id,
                    action: 'bypassing_permissions_expired',
                  },
                  duration: 5000,
                  priority: 'normal',
                })
              }

              // Clear this interval
              const interval = intervals.get(session.id)
              if (interval) {
                clearInterval(interval)
                intervals.delete(session.id)
              }
            } catch (error) {
              console.error(`Failed to disable expired yolo mode for session ${session.id}:`, error)
            }
          }
        }

        // Check immediately
        checkExpiration()

        // Then check every second
        const interval = setInterval(checkExpiration, 1000)
        intervals.set(session.id, interval)
      }
    })

    // Cleanup function
    return () => {
      intervals.forEach(interval => clearInterval(interval))
      intervals.clear()
    }
  }, [sessions, updateSession, location.pathname])

  // This component doesn't render anything
  return null
}
