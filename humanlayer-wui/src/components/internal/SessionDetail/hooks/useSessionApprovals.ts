import { useState, useCallback, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ConversationEvent, ApprovalStatus } from '@/lib/daemon/types'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { SessionDetailHotkeysScope } from '../SessionDetail'

/*
  Much of this state-based code should be ported to Zustand.
*/

interface UseSessionApprovalsProps {
  sessionId: string
  events: ConversationEvent[]
  focusedEventId: number | null
  setFocusedEventId: (id: number | null) => void
  setFocusSource?: (source: 'mouse' | 'keyboard' | null) => void
}

export function useSessionApprovals({
  sessionId,
  events,
  focusedEventId,
  setFocusedEventId,
  setFocusSource,
}: UseSessionApprovalsProps) {
  // sessionId may be used in future for session-specific approvals
  void sessionId
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
  const [confirmingApprovalId, setConfirmingApprovalId] = useState<string | null>(null)
  const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)

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
    try {
      setApprovingApprovalId(approvalId)
      await daemonClient.approveFunctionCall(approvalId)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to approve')
    } finally {
      setApprovingApprovalId(null)
    }
  }, [])

  const handleDeny = useCallback(async (approvalId: string, reason: string) => {
    try {
      await daemonClient.denyFunctionCall(approvalId, reason)
      setDenyingApprovalId(null)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to deny')
    }
  }, [])

  const denyAgainstOldestApproval = useCallback(() => {
    const oldestApproval = events.find(
      e => e.approvalStatus === ApprovalStatus.Pending && e.approvalId && e.id !== undefined,
    )
    if (oldestApproval) {
      setDenyingApprovalId(oldestApproval.approvalId!)
      // focus the oldest approval
      setFocusedEventId(oldestApproval.id)
      setFocusSource?.('keyboard')
    }
  }, [events, setFocusedEventId, setFocusSource])

  const handleStartDeny = useCallback((approvalId: string) => {
    setDenyingApprovalId(approvalId)
  }, [])

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
      scopes: SessionDetailHotkeysScope,
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
      scopes: SessionDetailHotkeysScope,
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
  }
}
