import { useState, useCallback, useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import { Session, ConversationEvent, ViewMode } from '@/lib/daemon/types'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { useStore } from '@/AppStore'
import { HotkeyScope } from '@/hooks/hotkeys/scopes'
import { logger } from '@/lib/logging'
import { checkUnsupportedCommand } from '@/constants/unsupportedCommands'
import { toast } from 'sonner'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'

interface UseSessionActionsProps {
  session: Session
  onClose: () => void
  pendingForkMessage?: ConversationEvent | null
  onForkCommit?: () => void
  archiveOnFork?: boolean // Add this
  scope: HotkeyScope
}

export const ResponseInputLocalStorageKey = 'response-input'

export function useSessionActions({
  session,
  pendingForkMessage,
  onForkCommit,
  archiveOnFork = false, // Add with default
  scope,
}: UseSessionActionsProps) {
  const [isResponding, setIsResponding] = useState(false)
  const [forkFromSessionId, setForkFromSessionId] = useState<string | null>(null)
  const { trackEvent } = usePostHogTracking()

  const interruptSession = useStore(state => state.interruptSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const archiveSession = useStore(state => state.archiveSession)
  const setViewMode = useStore(state => state.setViewMode)
  const trackNavigationFrom = useStore(state => state.trackNavigationFrom)
  const updateActiveSessionDetail = useStore(state => state.updateActiveSessionDetail)
  const responseEditor = useStore(state => state.responseEditor)
  const navigate = useNavigate()

  // Update response input when fork message is selected
  useEffect(() => {
    if (pendingForkMessage) {
      responseEditor?.commands.setContent(pendingForkMessage.content || '')
      // Set the session ID to fork from (the one before this message)
      setForkFromSessionId(pendingForkMessage.sessionId || null)
    } else {
      // Clear fork state when pendingForkMessage is null (e.g., when selecting "Current")
      setForkFromSessionId(null)
    }
  }, [pendingForkMessage, responseEditor])

  // Continue session functionality
  const handleContinueSession = useCallback(async () => {
    logger.log('handleContinueSession()')
    const sessionConversation = useStore.getState().activeSessionDetail?.conversation

    // Get the editor content and process mentions to use full paths
    let responseInput = ''
    if (responseEditor) {
      const json = responseEditor.getJSON()

      const processNode = (node: any): string => {
        if (node.type === 'text') {
          return node.text || ''
        } else if (node.type === 'mention' || node.type === 'slash-command') {
          // Use the full path (id) instead of the display label
          return node.attrs.id || node.attrs.label || ''
        } else if (node.type === 'paragraph' && node.content) {
          return node.content.map(processNode).join('')
        } else if (node.content) {
          return node.content.map(processNode).join('\n')
        }
        return ''
      }

      if (json.content) {
        responseInput = json.content.map(processNode).join('\n')
      }
    }

    if (!responseInput?.trim() || isResponding) return

    try {
      setIsResponding(true)
      const messageToSend = responseInput.trim()

      // Check for unsupported commands
      const unsupportedCmd = checkUnsupportedCommand(messageToSend)
      if (unsupportedCmd) {
        // Show error toast
        toast.error(unsupportedCmd.message, {
          description: unsupportedCmd.alternative,
          duration: 8000,
          closeButton: true,
        })

        // Don't send the message
        setIsResponding(false)
        return
      }

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

      const response = await daemonClient.continueSession(targetSessionId, messageToSend)

      if (!response.new_session_id) {
        throw new Error('No new session ID returned from continueSession')
      }

      const nextSession = await daemonClient.getSessionState(response.new_session_id)

      updateActiveSessionDetail(nextSession.session)

      // Track session continued event
      trackEvent(POSTHOG_EVENTS.SESSION_CONTINUED, {
        model: session.model || session.proxyModelOverride || undefined,
        provider: session.proxyEnabled
          ? session.proxyBaseUrl?.includes('baseten')
            ? 'baseten'
            : 'openrouter'
          : 'anthropic',
      })

      // Clear fork state
      setForkFromSessionId(null)

      // Track fork event if this was a fork operation
      if (forkFromSessionId) {
        trackEvent(POSTHOG_EVENTS.SESSION_FORKED, {
          archive_on_fork: archiveOnFork,
        })
      }

      // Notify parent of fork commit
      if (forkFromSessionId && onForkCommit) {
        onForkCommit()
      }

      // Always navigate to the new session - the backend handles queuing
      navigate(`/sessions/${response.new_session_id || session.id}`, {
        state: {
          continuationSession: nextSession,
          continuationConversation: sessionConversation,
        },
      })

      // Archive source session if fork was successful and preference is enabled
      if (forkFromSessionId && archiveOnFork && !session.archived) {
        const archiveToast = toast.loading('Archiving source session...', {
          duration: Infinity,
        })

        try {
          await archiveSession(session.id, true)
          toast.success('Source session archived', {
            id: archiveToast,
            duration: 3000,
          })
        } catch (error) {
          logger.error('Failed to archive source session after fork:', error)
          toast.error('Failed to archive source session', {
            id: archiveToast,
            description: 'The fork was successful but archiving failed. You can archive manually.',
            duration: 5000,
            closeButton: true,
          })
          // Don't throw - fork was successful, archive failure is non-blocking
        }
      }

      // Refresh the session list to ensure UI reflects current state
      await refreshSessions()

      // Reset form state only after success
      responseEditor?.commands.setContent('')
      localStorage.removeItem(`${ResponseInputLocalStorageKey}.${session.id}`)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to continue session')
      // On error, keep the message so user can retry
    } finally {
      setIsResponding(false)
    }
  }, [
    responseEditor,
    isResponding,
    session.id,
    session.archived,
    session.model,
    session.proxyModelOverride,
    session.proxyEnabled,
    session.proxyBaseUrl,
    navigate,
    refreshSessions,
    archiveSession,
    trackNavigationFrom,
    forkFromSessionId,
    onForkCommit,
    archiveOnFork,
    setViewMode,
    updateActiveSessionDetail,
    trackEvent,
  ])

  // Navigate to parent session
  const handleNavigateToParent = useCallback(() => {
    if (session.parentSessionId) {
      navigate(`/sessions/${session.parentSessionId}`)
    }
  }, [session.parentSessionId, navigate])

  // Keyboard shortcuts
  // Note: Escape key is handled in SessionDetail to manage confirmingApprovalId state

  // Ctrl+X to interrupt session
  useHotkeys(
    'ctrl+x',
    () => {
      if (session.status === 'running' || session.status === 'starting') {
        if (!session.claudeSessionId) {
          toast.warning('Session cannot be interrupted yet', {
            description: 'Waiting for Claude to initialize the session. Please try again in a moment.',
          })
          return
        }
        interruptSession(session.id)
      }
    },
    {
      scopes: [scope],
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      preventDefault: true,
    },
  )

  // R key - no longer needed since input is always visible
  // Keeping the hotkey registration but making it a no-op to avoid breaking anything

  // P key to navigate to parent session
  useHotkeys(
    'p',
    () => {
      if (session.parentSessionId) {
        handleNavigateToParent()
      }
    },
    { scopes: [scope] },
  )

  return {
    isResponding,
    handleContinueSession,
    handleNavigateToParent,
    isForkMode: !!forkFromSessionId,
    interruptSession,
  }
}
