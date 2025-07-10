import { useRef, useCallback, useMemo } from 'react'
import { useStore } from '@/AppStore'
import { notificationService } from '@/services/NotificationService'
import { daemonClient } from '@/lib/daemon'
import { useSessionSubscriptions } from './useSubscriptions'
import {
  SessionStatus,
  type SessionStatusChangedEventData,
  type NewApprovalEventData,
} from '@/lib/daemon/types'

/**
 * Hook that subscribes to session events and handles notifications
 */
export function useSessionEventsWithNotifications(connected: boolean) {
  const updateSession = useStore(state => state.updateSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const { addNotifiedItem, isItemNotified, clearNotificationsForSession } = useStore()
  const previousStatusesRef = useRef<Map<string, SessionStatus>>(new Map())

  const handleSessionStatusChanged = useCallback(
    async (
      data: SessionStatusChangedEventData & { event_type?: string; auto_accept_edits?: boolean },
      timestamp: string,
    ) => {
      console.log('handleSessionStatusChanged()', data)

      // Handle settings updates
      if (data.event_type === 'settings_updated' && data.auto_accept_edits !== undefined) {
        updateSession(data.session_id, {
          auto_accept_edits: data.auto_accept_edits,
        })
        return
      }

      const previousStatus = previousStatusesRef.current.get(data.session_id)
      const newStatus = data.new_status as SessionStatus

      // Update the session status immediately
      updateSession(data.session_id, {
        status: newStatus,
        last_activity_at: timestamp,
      })

      // Store the new status
      previousStatusesRef.current.set(data.session_id, newStatus)

      // Clear notifications if session is no longer waiting_input
      if (newStatus !== SessionStatus.WaitingInput) {
        clearNotificationsForSession(data.session_id)
      }

      // Check if session just entered waiting_input status
      if (previousStatus !== SessionStatus.WaitingInput && newStatus === SessionStatus.WaitingInput) {
        try {
          const sessionResponse = await daemonClient.getSessionState(data.session_id)
          const session = sessionResponse.session

          // For status-based notifications, we use a temporary notification ID
          const tempNotificationId = notificationService.generateNotificationId('approval_required', {
            sessionId: data.session_id,
            approvalId: 'status-change',
          })

          if (!isItemNotified(tempNotificationId)) {
            const notificationId = await notificationService.notifyApprovalRequired(
              data.session_id,
              'status-change',
              session.query,
              session.model,
            )

            if (notificationId) {
              addNotifiedItem(notificationId)
            }
          }
        } catch (error) {
          console.error('Failed to fetch session details for notification:', error)
        }
      }

      // Check if session just completed
      if (previousStatus !== SessionStatus.Completed && newStatus === SessionStatus.Completed) {
        try {
          const sessionResponse = await daemonClient.getSessionState(data.session_id)
          const session = sessionResponse.session

          await notificationService.notify({
            type: 'session_completed',
            title: `Session Completed (${data.session_id.slice(0, 8)})`,
            body: `Completed: ${session.query}`,
            metadata: {
              sessionId: data.session_id,
              model: session.model,
            },
            // Don't make this sticky - let it auto-dismiss
            duration: undefined,
          })
        } catch (error) {
          console.error('Failed to show completion notification:', error)
        }
      }

      // Check if session just failed
      if (previousStatus !== SessionStatus.Failed && newStatus === SessionStatus.Failed) {
        try {
          const sessionResponse = await daemonClient.getSessionState(data.session_id)
          const session = sessionResponse.session

          await notificationService.notify({
            type: 'session_failed',
            title: `Session Failed (${data.session_id.slice(0, 8)})`,
            body: session.error_message || `Failed: ${session.query}`,
            metadata: {
              sessionId: data.session_id,
              model: session.model,
            },
            // Don't make this sticky - let it auto-dismiss
            duration: undefined,
            priority: 'high',
          })
        } catch (error) {
          console.error('Failed to show failure notification:', error)
        }
      }
    },
    [updateSession, clearNotificationsForSession, isItemNotified, addNotifiedItem],
  )

  const handleNewApproval = useCallback(
    async (data: NewApprovalEventData) => {
      // Refresh sessions to get latest approval counts
      refreshSessions()

      // Check if we have approval details
      if (data.approval) {
        const approval = data.approval
        let approvalId: string | undefined
        let sessionId: string | undefined

        if (approval.function_call) {
          approvalId = approval.function_call.call_id
          sessionId = approval.function_call.run_id
        } else if (approval.human_contact) {
          approvalId = approval.human_contact.call_id
          sessionId = approval.human_contact.run_id
        }

        if (approvalId && sessionId) {
          const notificationId = notificationService.generateNotificationId('approval_required', {
            sessionId,
            approvalId,
          })

          if (!isItemNotified(notificationId)) {
            try {
              const sessionResponse = await daemonClient.getSessionState(sessionId)
              const session = sessionResponse.session

              const sentNotificationId = await notificationService.notifyApprovalRequired(
                sessionId,
                approvalId,
                session.query,
                session.model,
              )

              if (sentNotificationId) {
                addNotifiedItem(sentNotificationId)
              }
            } catch (error) {
              console.error('Failed to fetch session details for approval notification:', error)
            }
          }
        }
      }
    },
    [refreshSessions, isItemNotified, addNotifiedItem],
  )

  const handleApprovalResolved = useCallback(() => {
    // Just refresh sessions to get latest approval counts/status
    refreshSessions()
  }, [refreshSessions])

  // Memoize the handlers object to prevent re-subscriptions
  const handlers = useMemo(
    () => ({
      onSessionStatusChanged: handleSessionStatusChanged,
      onNewApproval: handleNewApproval,
      onApprovalResolved: handleApprovalResolved,
    }),
    [handleSessionStatusChanged, handleNewApproval, handleApprovalResolved],
  )

  // Use the subscription hook with our handlers
  useSessionSubscriptions(connected, handlers)
}
