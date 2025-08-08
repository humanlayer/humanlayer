import { useEffect } from 'react'
import { useStore } from '@/AppStore'
import { notificationService } from '@/services/NotificationService'
import { useLocation } from 'react-router-dom'
import { logger } from '@/lib/logging'
/**
 * Global monitor for dangerous skip permissions timers.
 * Watches all sessions and automatically disables dangerous skip permissions when timers expire,
 * regardless of which session is currently being viewed.
 */
export const DangerousSkipPermissionsMonitor = () => {
  const { sessions, updateSessionOptimistic } = useStore()
  const location = useLocation()

  useEffect(() => {
    // Track intervals for each session
    const intervals = new Map<string, ReturnType<typeof setInterval>>()

    // Set up monitoring for each session with active dangerous skip permissions
    sessions.forEach(session => {
      if (session.dangerouslySkipPermissions && session.dangerouslySkipPermissionsExpiresAt) {
        const checkExpiration = async () => {
          const now = new Date().getTime()
          const expiry = new Date(session.dangerouslySkipPermissionsExpiresAt!).getTime()
          const remaining = expiry - now

          if (remaining <= 0) {
            try {
              // Use optimistic update to disable dangerous skip permissions
              await updateSessionOptimistic(session.id, {
                dangerouslySkipPermissions: false,
                dangerouslySkipPermissionsExpiresAt: undefined,
              })

              // Only show notification if not currently viewing this session
              const isViewingSession = location.pathname === `/session/${session.id}`
              if (!isViewingSession) {
                // Show notification using NotificationService
                await notificationService.notify({
                  type: 'settings_changed',
                  title: 'Dangerous skip permissions expired',
                  body: `Session: ${session.title || session.summary || 'Untitled'}`,
                  metadata: {
                    sessionId: session.id,
                    action: 'dangerous_skip_permissions_expired',
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
              logger.error(
                `Failed to disable expired dangerous skip permissions for session ${session.id}:`,
                error,
              )
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
  }, [sessions, updateSessionOptimistic, location.pathname])

  // This component doesn't render anything
  return null
}
