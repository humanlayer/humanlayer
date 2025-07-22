import React, { useState, useCallback, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import { SessionInfo, ConversationEvent, ViewMode } from '@/lib/daemon/types'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { useStore } from '@/stores/appStore'

interface UseSessionActionsProps {
  session: SessionInfo
  onClose: () => void
  pendingForkMessage?: ConversationEvent | null
  onForkCommit?: () => void
}

export function useSessionActions({
  session,
  pendingForkMessage,
  onForkCommit,
}: UseSessionActionsProps) {
  const [responseInput, setResponseInput] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [forkFromSessionId, setForkFromSessionId] = useState<string | null>(null)

  const interruptSession = useStore(state => state.interruptSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const archiveSession = useStore(state => state.archiveSession)
  const setViewMode = useStore(state => state.setViewMode)
  const trackNavigationFrom = useStore(state => state.trackNavigationFrom)
  const navigate = useNavigate()

  // Update response input when fork message is selected
  useEffect(() => {
    if (pendingForkMessage) {
      setResponseInput(pendingForkMessage.content || '')
      // Set the session ID to fork from (the one before this message)
      setForkFromSessionId(pendingForkMessage.session_id)
    }
  }, [pendingForkMessage])

  // Continue session functionality
  const handleContinueSession = useCallback(async () => {
    if (!responseInput.trim() || isResponding) return

    try {
      setIsResponding(true)
      const messageToSend = responseInput.trim()

      // Use fork session ID if available, otherwise current session
      const targetSessionId = forkFromSessionId || session.id

      // Track navigation BEFORE the continue call for interrupt cases
      // This ensures we suppress the completion notification that happens
      // during the interrupt phase of "interrupt & continue"
      trackNavigationFrom(session.id)

      // Unarchive the session if it's archived
      if (session.archived) {
        await archiveSession(session.id, false)
        // Switch to normal view mode when resuming an archived session
        setViewMode(ViewMode.Normal)
      }

      const response = await daemonClient.continueSession({
        session_id: targetSessionId,
        query: messageToSend,
      })

      // Clear fork state
      setForkFromSessionId(null)

      // Notify parent of fork commit
      if (forkFromSessionId && onForkCommit) {
        onForkCommit()
      }

      // Always navigate to the new session - the backend handles queuing
      navigate(`/sessions/${response.session_id}`)

      // Refresh the session list to ensure UI reflects current state
      await refreshSessions()

      // Reset form state only after success
      setResponseInput('')
    } catch (error) {
      notificationService.notifyError(error, 'Failed to continue session')
      // On error, keep the message so user can retry
    } finally {
      setIsResponding(false)
    }
  }, [
    responseInput,
    isResponding,
    session.id,
    session.archived,
    navigate,
    refreshSessions,
    archiveSession,
    trackNavigationFrom,
    forkFromSessionId,
    onForkCommit,
  ])

  const handleResponseInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleContinueSession()
      }
    },
    [handleContinueSession],
  )

  // Navigate to parent session
  const handleNavigateToParent = useCallback(() => {
    if (session.parent_session_id) {
      navigate(`/sessions/${session.parent_session_id}`)
    }
  }, [session.parent_session_id, navigate])

  // Keyboard shortcuts
  // Note: Escape key is handled in SessionDetail to manage confirmingApprovalId state

  // Ctrl+X to interrupt session
  useHotkeys('ctrl+x', () => {
    if (session.status === 'running' || session.status === 'starting') {
      interruptSession(session.id)
    }
  })

  // R key - no longer needed since input is always visible
  // Keeping the hotkey registration but making it a no-op to avoid breaking anything

  // P key to navigate to parent session
  useHotkeys('p', () => {
    if (session.parent_session_id) {
      handleNavigateToParent()
    }
  })

  return {
    responseInput,
    setResponseInput,
    isResponding,
    handleContinueSession,
    handleResponseInputKeyDown,
    handleNavigateToParent,
    isForkMode: !!forkFromSessionId,
  }
}
