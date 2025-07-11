import React, { useState, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import { SessionInfo } from '@/lib/daemon/types'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { useStore } from '@/AppStore'

interface UseSessionActionsProps {
  session: SessionInfo
  onClose: () => void
}

export function useSessionActions({ session }: UseSessionActionsProps) {
  const [responseInput, setResponseInput] = useState('')
  const [isResponding, setIsResponding] = useState(false)

  const interruptSession = useStore(state => state.interruptSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const archiveSession = useStore(state => state.archiveSession)
  const navigate = useNavigate()

  // Continue session functionality
  const handleContinueSession = useCallback(async () => {
    if (!responseInput.trim() || isResponding) return

    try {
      setIsResponding(true)
      const messageToSend = responseInput.trim()

      // Unarchive the session if it's archived
      if (session.archived) {
        await archiveSession(session.id, false)
      }

      const response = await daemonClient.continueSession({
        session_id: session.id,
        query: messageToSend,
      })

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
  ])

  const handleResponseInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleContinueSession()
      } else if (e.key === 'Escape') {
        // Clear the input on escape
        setResponseInput('')
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
  }
}
