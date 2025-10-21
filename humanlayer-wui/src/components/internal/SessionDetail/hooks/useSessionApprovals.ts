import { useState, useCallback, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ConversationEvent, ApprovalStatus } from '@/lib/daemon/types'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { HotkeyScope } from '@/hooks/hotkeys/scopes'
import { useStore } from '@/AppStore'
import { ResponseInputLocalStorageKey } from './useSessionActions'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'

/*
  Much of this state-based code should be ported to Zustand.
*/

interface UseSessionApprovalsProps {
  sessionId: string
  events: ConversationEvent[]
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  setFocusSource?: (source: 'mouse' | 'keyboard' | null) => void
  scope: HotkeyScope
  onStartDeny?: () => void // Callback when denial mode is entered
}

export function useSessionApprovals({
  sessionId,
  events,
  focusedEventId,
  setFocusedEventId,
  setFocusSource,
  scope,
  onStartDeny,
}: UseSessionApprovalsProps) {
  // sessionId may be used in future for session-specific approvals
  void sessionId
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
  const [confirmingApprovalId, setConfirmingApprovalId] = useState<string | null>(null)
  const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)
  const responseEditor = useStore(state => state.responseEditor)
  const { trackEvent } = usePostHogTracking()

  // Helper to check if element is in view
  const isElementInView = useCallback((elementId: number) => {
    const container = document.querySelector('[data-conversation-container]')
    if (!container) return true

    const element = container.querySelector(`[data-event-id="${elementId}"]`)
    if (!element) return false

    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
  }, [])

  // Approval handlers
  const handleApprove = useCallback(async (approvalId: string) => {
    const startTime = Date.now()
    try {
      setApprovingApprovalId(approvalId)
      await daemonClient.approveFunctionCall(approvalId)

      // Track approval responded event
      trackEvent(POSTHOG_EVENTS.APPROVAL_RESPONDED, {
        response: 'approve',
        response_time_ms: Date.now() - startTime,
      })
    } catch (error) {
      notificationService.notifyError(error, 'Failed to approve')
    } finally {
      setApprovingApprovalId(null)
    }
  }, [trackEvent])

  const handleDeny = useCallback(
    async (approvalId: string, reason: string, sessionId: string) => {
      const startTime = Date.now()
      try {
        const res = await daemonClient.denyFunctionCall(approvalId, reason)
        console.log('handleDeny()', res)

        if (res.success) {
          responseEditor?.commands.setContent('')
          localStorage.removeItem(`${ResponseInputLocalStorageKey}.${sessionId}`)

          // Track approval responded event
          trackEvent(POSTHOG_EVENTS.APPROVAL_RESPONDED, {
            response: 'reject',
            response_time_ms: Date.now() - startTime,
          })
        } else {
          console.log('WHAT', res)
        }

        setDenyingApprovalId(null)
      } catch (error) {
        notificationService.notifyError(error, 'Failed to deny')
      }
    },
    [responseEditor, trackEvent],
  )

  const denyAgainstOldestApproval = useCallback(() => {
    const oldestApproval = events.find(
      e => e.approvalStatus === ApprovalStatus.Pending && e.approvalId && e.id !== undefined,
    )
    if (oldestApproval) {
      // Call the callback to clear fork state if needed
      onStartDeny?.()

      setDenyingApprovalId(oldestApproval.approvalId!)
      // focus the oldest approval
      setFocusedEventId(oldestApproval.id)
      setFocusSource?.('keyboard')
    }
  }, [events, setFocusedEventId, setFocusSource, onStartDeny])

  const handleStartDeny = useCallback(
    (approvalId: string) => {
      // Call the callback to clear fork state if needed
      onStartDeny?.()

      setDenyingApprovalId(approvalId)

      // Use setTimeout to ensure focus happens after all browser event handling
      // This works around the browser's default focus behavior on button clicks
      setTimeout(() => {
        responseEditor?.commands.focus()
      }, 0)
    },
    [responseEditor, onStartDeny],
  )

  const handleCancelDeny = useCallback(() => {
    setDenyingApprovalId(null)
  }, [])

  const isDenying = useMemo(() => {
    return denyingApprovalId !== null
  }, [denyingApprovalId])

  // A key to approve focused event that has pending approval
  useHotkeys(
    'a',
    () => {
      // Find any pending approval event
      const pendingApprovalEvent = events.find(
        e => e.approvalStatus === ApprovalStatus.Pending && e.approvalId && e.id !== undefined,
      )

      if (!pendingApprovalEvent || pendingApprovalEvent.id === undefined) return

      // If no event is focused, or a different event is focused, focus this pending approval
      if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
        const wasInView = isElementInView(pendingApprovalEvent.id)
        setFocusedEventId(pendingApprovalEvent.id)
        setFocusSource?.('keyboard')

        // Only set confirming state if element was out of view and we're scrolling to it
        if (!wasInView) {
          setConfirmingApprovalId(pendingApprovalEvent.approvalId!)
        }
        return
      }

      // If the pending approval is already focused
      if (focusedEventId === pendingApprovalEvent.id) {
        // If we're in confirming state, approve it
        if (confirmingApprovalId === pendingApprovalEvent.approvalId) {
          handleApprove(pendingApprovalEvent.approvalId!)
          setConfirmingApprovalId(null)
        } else {
          // If not in confirming state, approve directly
          handleApprove(pendingApprovalEvent.approvalId!)
        }
      }
    },
    {
      scopes: [scope],
    },
    [
      events,
      focusedEventId,
      confirmingApprovalId,
      handleApprove,
      isElementInView,
      setFocusedEventId,
      setFocusSource,
    ],
  )

  // D key to deny focused event that has pending approval
  useHotkeys(
    'd',
    e => {
      // Prevent the 'd' from being typed in any input that might get focused
      e.preventDefault()

      const currentFocusedEventId = events.find(e => e.id === focusedEventId)

      // Deny against currently focused event
      if (currentFocusedEventId?.approvalStatus === ApprovalStatus.Pending) {
        handleStartDeny(currentFocusedEventId.approvalId!)
        return
      }

      // Deny against first matching pending approval
      const pendingApprovalEvent = events.find(
        e => e.approvalStatus === ApprovalStatus.Pending && e.approvalId && e.id !== undefined,
      )

      if (!pendingApprovalEvent || pendingApprovalEvent.id === undefined) return

      // If no event is focused, or a different event is focused, focus this pending approval
      if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
        setFocusedEventId(pendingApprovalEvent.id)
        setFocusSource?.('keyboard')
        return
      }
    },
    {
      scopes: [scope],
    },
    [events, focusedEventId, handleStartDeny, setFocusedEventId, setFocusSource],
  )

  // Scroll deny form into view when opened
  useEffect(() => {
    if (denyingApprovalId) {
      const container = document.querySelector('[data-conversation-container]')
      // Find the event that contains this approval
      const event = events.find(e => e.approvalId === denyingApprovalId)
      if (container && event && !event.approvalStatus && event.id !== undefined) {
        const eventElement = container.querySelector(`[data-event-id="${event.id}"]`)
        if (eventElement && !isElementInView(event.id)) {
          // Scroll the deny form into view
          setTimeout(() => {
            eventElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }, 100) // Small delay to ensure form is rendered
        }
      }
    }
  }, [denyingApprovalId, events, isElementInView])

  // Focus a specific approval by ID
  const focusApprovalById = useCallback(
    (approvalId: string) => {
      const event = events.find(e => e.approvalId === approvalId)

      if (event && event.id !== undefined && event.approvalStatus === ApprovalStatus.Pending) {
        setFocusedEventId(event.id)
        setFocusSource?.('keyboard')

        // Auto-scroll if not in view
        const inView = isElementInView(event.id)

        if (!inView) {
          // Try multiple scroll attempts with increasing delays
          const scrollAttempts = [100, 300, 500]

          scrollAttempts.forEach(delay => {
            setTimeout(() => {
              const container = document.querySelector('[data-conversation-container]')
              const element = container?.querySelector(`[data-event-id="${event.id}"]`)

              if (element) {
                // Check if still not in view before scrolling
                const rect = element.getBoundingClientRect()
                const containerRect = container!.getBoundingClientRect()
                const stillNotInView =
                  rect.top < containerRect.top || rect.bottom > containerRect.bottom

                if (stillNotInView) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }
            }, delay)
          })
        }
      } else {
        // Fallback: Find the most recent pending approval
        const pendingApprovals = events.filter(
          e => e.approvalStatus === ApprovalStatus.Pending && e.approvalId && e.id !== undefined,
        )

        if (pendingApprovals.length > 0) {
          // Use the last pending approval (most recent)
          const mostRecent = pendingApprovals[pendingApprovals.length - 1]

          setFocusedEventId(mostRecent.id!)
          setFocusSource?.('keyboard')

          // Auto-scroll if not in view
          const inView = isElementInView(mostRecent.id!)

          if (!inView) {
            // Try multiple scroll attempts with increasing delays
            const scrollAttempts = [100, 300, 500]

            scrollAttempts.forEach(delay => {
              setTimeout(() => {
                const container = document.querySelector('[data-conversation-container]')
                const element = container?.querySelector(`[data-event-id="${mostRecent.id}"]`)

                if (element) {
                  // Check if still not in view before scrolling
                  const rect = element.getBoundingClientRect()
                  const containerRect = container!.getBoundingClientRect()
                  const stillNotInView =
                    rect.top < containerRect.top || rect.bottom > containerRect.bottom

                  if (stillNotInView) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }
              }, delay)
            })
          }
        }
      }
    },
    [events, setFocusedEventId, setFocusSource, isElementInView],
  )

  return {
    isDenying,
    approvingApprovalId,
    confirmingApprovalId,
    setConfirmingApprovalId,
    denyingApprovalId,
    setDenyingApprovalId,
    handleApprove,
    handleDeny,
    handleStartDeny,
    handleCancelDeny,
    denyAgainstOldestApproval,
    focusApprovalById,
  }
}
