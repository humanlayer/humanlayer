import { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router'

import { ConversationEvent, Session, ApprovalStatus, SessionStatus } from '@/lib/daemon/types'
import { Card, CardContent } from '@/components/ui/card'
import { useConversation, useKeyboardNavigationProtection } from '@/hooks'
import { ChevronDown } from 'lucide-react'
import { daemonClient } from '@/lib/daemon/client'
import { useStore } from '@/AppStore'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

// Import extracted components
import { ConversationStream } from '../../ConversationStream/ConversationStream'
import { ToolResultModal } from './ToolResultModal'
import { TodoWidget } from './TodoWidget'
import { ActiveSessionInput } from './ActiveSessionInput'
import { SessionModeIndicator } from '../AutoAcceptIndicator'
import { ForkViewModal } from './ForkViewModal'
import { DangerouslySkipPermissionsDialog } from '../DangerouslySkipPermissionsDialog'
import { AdditionalDirectoriesDropdown } from './AdditionalDirectoriesDropdown'
import { OmniSpinner } from './OmniSpinner'

// Import hooks
import { useSessionActions } from '../hooks/useSessionActions'
import { useSessionApprovals } from '../hooks/useSessionApprovals'
import { useSessionNavigation } from '../hooks/useSessionNavigation'
import { useTaskGrouping } from '../hooks/useTaskGrouping'
import { useSessionClipboard } from '../hooks/useSessionClipboard'
import { logger } from '@/lib/logging'

interface ActiveSessionProps {
  session: Session
  onClose: () => void
}

/**
 * ActiveSession - Orchestrator component for active and archived sessions
 * This component handles all the complex logic for active sessions.
 * It does NOT handle draft sessions - those use the /sessions/draft route.
 */
export function ActiveSession({ session, onClose }: ActiveSessionProps) {
  // Determine the appropriate scope based on session state
  const detailScope = session?.archived
    ? HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED
    : HOTKEY_SCOPES.SESSION_DETAIL

  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [forkViewOpen, setForkViewOpen] = useState(false)
  const [forkPreviewData, setForkPreviewData] = useState<{
    eventIndex: number // For scrolling in ConversationStream
    message: ConversationEvent // For execution in useSessionActions
    tokenCount: number | null // For display in ActiveSessionInput
    archiveOnFork: boolean // For execution preference
  } | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [dangerousSkipPermissionsDialogOpen, setDangerousSkipPermissionsDialogOpen] = useState(false)
  const [directoriesDropdownOpen, setDirectoriesDropdownOpen] = useState(false)

  const responseEditor = useStore(state => state.responseEditor)
  const isEditingSessionTitle = useStore(state => state.isEditingSessionTitle)
  const setIsEditingSessionTitle = useStore(state => state.setIsEditingSessionTitle)

  // Keyboard navigation protection
  const { shouldIgnoreMouseEvent, startKeyboardNavigation } = useKeyboardNavigationProtection()

  // Show spinner for active states, but not for interrupted or interrupting
  const isActivelyProcessing = ['starting', 'running', 'completing'].includes(session.status)
  const confirmingArchiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Get session from store to access auto_accept_edits and dangerouslySkipPermissions
  const sessionFromStore = useStore(state => state.sessions.find(s => s.id === session.id))
  const updateSessionOptimistic = useStore(state => state.updateSessionOptimistic)
  const fetchActiveSessionDetail = useStore(state => state.fetchActiveSessionDetail)

  // Get parent session's token data to display when current session doesn't have its own yet
  const parentSession = useStore(state =>
    session.parentSessionId ? state.sessions.find(s => s.id === session.parentSessionId) : null,
  )

  // Fetch parent session if it's not in the store
  const [parentSessionData, setParentSessionData] = useState<Session | null>(null)
  useEffect(() => {
    if (session.parentSessionId && !parentSession) {
      // Parent session not in store, fetch it directly
      daemonClient
        .getSessionState(session.parentSessionId)
        .then(response => {
          console.log('[TokenDebug] Fetched parent session:', response.session)
          setParentSessionData(response.session)
        })
        .catch(error => {
          console.error('[TokenDebug] Failed to fetch parent session:', error)
        })
    } else if (parentSession) {
      // Parent session is in store, use it
      setParentSessionData(parentSession)
    }
  }, [session.parentSessionId, parentSession])

  // These computed values only apply to active sessions
  const autoAcceptEdits = useMemo(() => {
    if (!session) return false
    return sessionFromStore?.autoAcceptEdits ?? session.autoAcceptEdits ?? false
  }, [session, sessionFromStore?.autoAcceptEdits])

  const dangerouslySkipPermissions = useMemo(() => {
    if (!session) return false
    return sessionFromStore?.dangerouslySkipPermissions ?? session.dangerouslySkipPermissions ?? false
  }, [session, sessionFromStore?.dangerouslySkipPermissions])

  const dangerouslySkipPermissionsExpiresAt =
    sessionFromStore?.dangerouslySkipPermissionsExpiresAt !== undefined
      ? sessionFromStore.dangerouslySkipPermissionsExpiresAt?.toISOString()
      : session.dangerouslySkipPermissionsExpiresAt?.toISOString()

  // Get events for sidebar access
  const { events } = useConversation(session.id)

  // Use task grouping
  const { hasSubTasks, expandedTasks, toggleTaskGroup } = useTaskGrouping(events)

  // Use navigation hook
  const navigation = useSessionNavigation({
    events,
    hasSubTasks,
    expandedTasks,
    toggleTaskGroup,
    expandedToolResult,
    setExpandedToolResult,
    setExpandedToolCall,
    disabled: forkViewOpen,
    startKeyboardNavigation,
    scope: detailScope,
  })

  // Use approvals hook
  const approvals = useSessionApprovals({
    sessionId: session.id,
    events,
    focusedEventId: navigation.focusedEventId,
    setFocusedEventId: navigation.setFocusedEventId,
    setFocusSource: navigation.setFocusSource,
    scope: detailScope,
    onStartDeny: () => {
      // Clear fork state when entering denial mode
      if (forkPreviewData) {
        setForkPreviewData(null)
        responseEditor?.commands.setContent('')
      }
    },
  })

  // Use clipboard hook
  const focusedEvent = events?.find(e => e.id === navigation.focusedEventId) || null
  useSessionClipboard({
    focusedEvent,
    enabled: !expandedToolResult && !forkViewOpen,
    scope: detailScope,
  })

  // Handle approval parameter from URL
  const [searchParams, setSearchParams] = useSearchParams()
  const targetApprovalId = searchParams.get('approval')
  const processedApprovalRef = useRef<string | null>(null)

  // Track if we've scrolled to bottom for this session
  const hasScrolledToBottomRef = useRef(false)

  // Cache the conversation container to avoid repeated DOM queries
  const conversationContainerRef = useRef<HTMLElement | null>(null)

  // Handle auto-focus when navigating with approval parameter
  useEffect(() => {
    if (!targetApprovalId || events.length === 0) {
      return
    }

    if (processedApprovalRef.current === targetApprovalId) {
      return
    }

    if (approvals.focusApprovalById) {
      processedApprovalRef.current = targetApprovalId
      approvals.focusApprovalById(targetApprovalId)
      hasScrolledToBottomRef.current = true

      // Clear the parameter after focusing
      searchParams.delete('approval')
      setSearchParams(searchParams, { replace: true })
    }
  }, [targetApprovalId, events?.length > 0, approvals.focusApprovalById])

  // Add fork commit handler
  const handleForkCommit = useCallback(() => {
    setForkPreviewData(null)
    setForkViewOpen(false)
  }, [])

  // Use session actions hook
  const actions = useSessionActions({
    session,
    onClose,
    pendingForkMessage: forkPreviewData?.message || null,
    onForkCommit: handleForkCommit,
    archiveOnFork: forkPreviewData?.archiveOnFork || false,
    scope: detailScope,
  })

  // Fork preview handler
  const handleForkPreview = useCallback(
    (data: {
      eventIndex: number
      message: ConversationEvent
      tokenCount: number | null
      archiveOnFork: boolean
    }) => {
      const previousEvent = data.eventIndex > 0 ? events[data.eventIndex - 1] : null
      const forkFromSessionId = previousEvent?.sessionId || session.id

      setForkPreviewData({
        ...data,
        message: {
          ...data.message,
          sessionId: forkFromSessionId,
        },
      })
    },
    [events, session.id],
  )

  // Fork cancel handler
  const handleForkCancel = useCallback(() => {
    setForkPreviewData(null)
    responseEditor?.commands.setContent('')
  }, [responseEditor])

  // Reset scroll flag when session changes
  useEffect(() => {
    if (session.id) {
      hasScrolledToBottomRef.current = false
      conversationContainerRef.current = null
    }
  }, [session.id])

  // Enhanced auto-scroll with retry logic
  useEffect(() => {
    const hasApprovalParam = targetApprovalId !== null

    if (!hasScrolledToBottomRef.current && events?.length > 0 && !hasApprovalParam) {
      const scrollAttempts = [100, 300, 500]
      const timers: ReturnType<typeof setTimeout>[] = []

      scrollAttempts.forEach(delay => {
        const timer = setTimeout(() => {
          if (!hasScrolledToBottomRef.current) {
            let container = conversationContainerRef.current
            if (container && !document.body.contains(container)) {
              container = null
              conversationContainerRef.current = null
            }

            if (!container) {
              container = document.querySelector('[data-conversation-container]')
              if (container) {
                conversationContainerRef.current = container as HTMLElement
              }
            }

            if (container) {
              container.scrollTop = container.scrollHeight
              hasScrolledToBottomRef.current = true
              timers.forEach(t => clearTimeout(t))
            }
          }
        }, delay)
        timers.push(timer)
      })

      return () => {
        timers.forEach(t => clearTimeout(t))
      }
    }
  }, [events?.length, targetApprovalId])

  // Cleanup confirmation timeout on unmount or session change
  useEffect(() => {
    return () => {
      if (confirmingArchiveTimeoutRef.current) {
        clearTimeout(confirmingArchiveTimeoutRef.current)
        confirmingArchiveTimeoutRef.current = null
      }
    }
  }, [session.id])

  // Handle updating additional directories
  const handleUpdateAdditionalDirectories = async (directories: string[]) => {
    await daemonClient.updateSession(session.id, { additionalDirectories: directories })
    useStore.getState().updateSession(session.id, { additionalDirectories: directories })
  }

  // Check if there are pending approvals out of view
  const [hasPendingApprovalsOutOfView, setHasPendingApprovalsOutOfView] = useState(false)

  const lastTodo = events
    ?.toReversed()
    .find(e => e.eventType === 'tool_call' && e.toolName === 'TodoWrite')

  // Fork view toggle handler
  const handleToggleForkView = useCallback(() => {
    // Clear denial state if entering fork view
    if (!forkViewOpen && approvals.denyingApprovalId) {
      approvals.handleCancelDeny()
    }
    setForkViewOpen(!forkViewOpen)
  }, [forkViewOpen, approvals.denyingApprovalId, approvals.handleCancelDeny])

  // Escape key handler
  useHotkeys(
    'escape',
    ev => {
      if ((ev.target as HTMLElement)?.dataset.slot === 'dialog-close') {
        logger.warn('Ignoring onClose triggered by dialog-close in ActiveSession')
        return null
      }

      if (isEditingSessionTitle) {
        return
      }

      // Check for denying state early - whether editor is focused or not
      const isDenying = approvals.denyingApprovalId !== null

      if (responseEditor?.isFocused) {
        responseEditor.commands.blur()
        // If we're denying, don't process further - let the next ESC cancel the deny
        if (isDenying) {
          return
        }
        return
      }

      /* Everything below here implies the responseEditor is not focused */

      // Cancel denial if in denying state
      if (isDenying) {
        approvals.handleCancelDeny()
        return
      }

      // Check for fork mode
      if (forkPreviewData !== null) {
        setForkPreviewData(null)
        responseEditor?.commands.setContent('')
      } else if (confirmingArchive) {
        setConfirmingArchive(false)
        if (confirmingArchiveTimeoutRef.current) {
          clearTimeout(confirmingArchiveTimeoutRef.current)
          confirmingArchiveTimeoutRef.current = null
        }
      } else if (approvals.confirmingApprovalId) {
        approvals.setConfirmingApprovalId(null)
      } else if (navigation.focusedEventId) {
        navigation.setFocusedEventId(null)
      } else {
        onClose()
      }
    },
    {
      enableOnFormTags: true,
      scopes: [detailScope],
    },
    [
      isEditingSessionTitle,
      forkPreviewData,
      confirmingArchive,
      approvals.confirmingApprovalId,
      approvals.setConfirmingApprovalId,
      approvals.denyingApprovalId,
      approvals.handleCancelDeny,
      navigation.focusedEventId,
      navigation.setFocusedEventId,
      onClose,
      responseEditor,
    ],
  )

  // Toggle auto-accept handler
  const handleToggleAutoAccept = useCallback(async () => {
    if (!session) return

    logger.log('toggleAutoAcceptEdits', autoAcceptEdits)

    try {
      const newState = !autoAcceptEdits
      await updateSessionOptimistic(session.id, { autoAcceptEdits: newState })
    } catch (error) {
      logger.error('Failed to toggle auto-accept mode:', error)
      toast.error('Failed to toggle auto-accept mode')
    }
  }, [session, session.id, autoAcceptEdits, updateSessionOptimistic])

  // Toggle dangerously skip permissions handler
  const handleToggleDangerouslySkipPermissions = useCallback(async () => {
    if (!session) return

    let currentSession = useStore.getState().sessions.find(s => s.id === session.id)

    if (!currentSession) {
      const sessionState = await daemonClient.getSessionState(session.id)
      currentSession = sessionState.session
    }

    const currentDangerouslySkipPermissions = currentSession?.dangerouslySkipPermissions ?? false

    if (currentDangerouslySkipPermissions) {
      try {
        await updateSessionOptimistic(session.id, {
          dangerouslySkipPermissions: false,
          dangerouslySkipPermissionsExpiresAt: undefined,
        })
      } catch (error) {
        logger.error('Failed to disable dangerous skip permissions', { error })
        toast.error('Failed to disable dangerous skip permissions')
      }
    } else {
      setDangerousSkipPermissionsDialogOpen(true)
    }
  }, [session, session.id, updateSessionOptimistic])

  // Option+A handler for auto-accept edits mode
  useHotkeys(
    'alt+a, option+a',
    () => {
      handleToggleAutoAccept()
    },
    {
      preventDefault: true,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED],
    },
    [handleToggleAutoAccept],
  )

  // Option+Y handler for dangerously skip permissions mode
  useHotkeys(
    'alt+y, option+y',
    () => {
      handleToggleDangerouslySkipPermissions()
    },
    {
      preventDefault: true,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED],
    },
    [handleToggleDangerouslySkipPermissions],
  )

  // Handle dialog confirmation
  const handleDangerousSkipPermissionsConfirm = async (timeoutMinutes: number | null) => {
    if (!session) return

    try {
      const expiresAt = timeoutMinutes
        ? new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString()
        : undefined

      await updateSessionOptimistic(session.id, {
        dangerouslySkipPermissions: true,
        dangerouslySkipPermissionsExpiresAt: expiresAt ? new Date(expiresAt) : undefined,
      })
    } catch (error) {
      logger.error('Failed to enable dangerous skip permissions', { error })
      toast.error('Failed to enable dangerous skip permissions')
    }
  }

  // Track if g>e was recently pressed to prevent 'e' from firing
  const gePressedRef = useRef<number | null>(null)

  // Handle g>e navigation
  useHotkeys(
    'g>e',
    () => {
      console.log('[ActiveSession] g>e captured, blocking archive')
      gePressedRef.current = Date.now()
    },
    {
      preventDefault: true,
      scopes: [detailScope],
    },
  )

  // Archive session hotkey
  useHotkeys(
    'e',
    async () => {
      console.log('[ActiveSession] archive hotkey "e" fired')

      if (gePressedRef.current && Date.now() - gePressedRef.current < 50) {
        console.log('[ActiveSession] Blocking archive due to recent g>e press')
        return
      }

      if (confirmingArchiveTimeoutRef.current) {
        clearTimeout(confirmingArchiveTimeoutRef.current)
        confirmingArchiveTimeoutRef.current = null
      }

      const isActiveSession = (
        [SessionStatus.Starting, SessionStatus.Running, SessionStatus.WaitingInput] as SessionStatus[]
      ).includes(session.status)

      const isArchiving = !session.archived

      if (isActiveSession && !confirmingArchive) {
        setConfirmingArchive(true)
        toast.warning('Press e again to archive active session', {
          description: 'This session is still active. Press e again within 3 seconds to confirm.',
          duration: 3000,
        })

        confirmingArchiveTimeoutRef.current = setTimeout(() => {
          setConfirmingArchive(false)
          confirmingArchiveTimeoutRef.current = null
        }, 3000)
        return
      }

      try {
        await useStore.getState().archiveSession(session.id, isArchiving)
        setConfirmingArchive(false)

        toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
          description: session.summary || 'Untitled session',
          duration: 3000,
        })

        onClose()
      } catch (error) {
        toast.error('Failed to archive session', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        setConfirmingArchive(false)
      }
    },
    {
      preventDefault: true,
      scopes: [detailScope],
    },
    [session.id, session.archived, session.summary, session.status, onClose, confirmingArchive],
  )

  // Fork view hotkey (Meta+Y)
  useHotkeys(
    'meta+y, ctrl+y',
    () => {
      handleToggleForkView()
    },
    {
      preventDefault: true,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      scopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.SESSION_DETAIL_ARCHIVED],
    },
    [handleToggleForkView],
  )

  // Create archive handler
  const handleToggleArchive = useCallback(async () => {
    const isActiveSession = [
      SessionStatus.Starting,
      SessionStatus.Running,
      SessionStatus.WaitingInput,
    ].includes(session.status as any)

    const isArchiving = !session.archived

    if (isActiveSession && !confirmingArchive) {
      setConfirmingArchive(true)
      toast.warning('Press e again to archive active session', {
        description: 'This session is still active. Press e again within 3 seconds to confirm.',
        duration: 3000,
      })

      confirmingArchiveTimeoutRef.current = setTimeout(() => {
        setConfirmingArchive(false)
        confirmingArchiveTimeoutRef.current = null
      }, 3000)
      return
    }

    try {
      await useStore.getState().archiveSession(session.id, isArchiving)
      setConfirmingArchive(false)

      toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
        description: session.summary || 'Untitled session',
        duration: 3000,
      })

      onClose()
    } catch (error) {
      toast.error('Failed to archive session', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      setConfirmingArchive(false)
    }
  }, [session.id, session.archived, session.summary, session.status, onClose, confirmingArchive])

  // Vim navigation hotkeys
  useHotkeys(
    'shift+g',
    () => {
      startKeyboardNavigation()

      const container = document.querySelector('[data-conversation-container]')
      if (container) {
        container.scrollTop = container.scrollHeight
        if (navigation.navigableItems.length > 0) {
          const lastItem = navigation.navigableItems[navigation.navigableItems.length - 1]
          navigation.setFocusedEventId(lastItem.id)
          navigation.setFocusSource('keyboard')
        }
      }
    },
    {
      scopes: [detailScope],
    },
    [navigation.navigableItems, navigation.setFocusedEventId, navigation.setFocusSource],
  )

  useHotkeys(
    'g>g',
    () => {
      startKeyboardNavigation()

      const container = document.querySelector('[data-conversation-container]')
      if (container) {
        container.scrollTop = 0
        if (navigation.navigableItems.length > 0) {
          const firstItem = navigation.navigableItems[0]
          navigation.setFocusedEventId(firstItem.id)
          navigation.setFocusSource('keyboard')
        }
      }
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
      scopes: [detailScope],
    },
    [navigation.navigableItems, navigation.setFocusedEventId, navigation.setFocusSource],
  )

  // Enter key to focus text input
  useHotkeys(
    'enter',
    () => {
      if (responseEditor) {
        responseEditor.commands.focus()
      }
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
      scopes: [detailScope],
    },
  )

  // Toggle directories dropdown
  useHotkeys(
    'shift+d',
    () => {
      setDirectoriesDropdownOpen(prev => !prev)
    },
    {
      scopes: [detailScope],
      enabled: !!session.workingDir,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [session.workingDir],
  )

  // Rename session hotkey
  useHotkeys(
    'shift+r',
    e => {
      e.preventDefault()
      setIsEditingSessionTitle(true)
    },
    {
      enabled: !approvals.confirmingApprovalId && !expandedToolResult,
      scopes: [detailScope],
      preventDefault: true,
      enableOnFormTags: false,
    },
    [setIsEditingSessionTitle, approvals.confirmingApprovalId, expandedToolResult],
  )

  // Check if there are pending approvals out of view
  useEffect(() => {
    const checkPendingApprovalVisibility = () => {
      if (session.status === SessionStatus.WaitingInput) {
        const pendingEvent = events.find(e => e.approvalStatus === ApprovalStatus.Pending)
        if (pendingEvent) {
          const container = document.querySelector('[data-conversation-container]')
          const element = container?.querySelector(`[data-event-id="${pendingEvent.id}"]`)
          if (container && element) {
            const buttons = element.querySelectorAll('button')
            let approveButton = null
            buttons.forEach(btn => {
              if (btn.textContent?.includes('Approve') && btn.querySelector('kbd')) {
                approveButton = btn
              }
            })

            const targetElement = approveButton || element
            const elementRect = targetElement.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()

            const inView =
              elementRect.top < containerRect.bottom && elementRect.bottom > containerRect.top

            setHasPendingApprovalsOutOfView(!inView)
          }
        } else {
          setHasPendingApprovalsOutOfView(false)
        }
      } else {
        setHasPendingApprovalsOutOfView(false)
      }
    }

    checkPendingApprovalVisibility()

    const container = document.querySelector('[data-conversation-container]')
    if (container) {
      container.addEventListener('scroll', checkPendingApprovalVisibility)
      return () => container.removeEventListener('scroll', checkPendingApprovalVisibility)
    }
  }, [session.status, events])

  let cardVerticalPadding = 'py-3'

  if (isActivelyProcessing) {
    const cardLoadingLowerPadding = 'pb-12'
    cardVerticalPadding = `pt-3 ${cardLoadingLowerPadding}`
  }

  // Render active session UI
  return (
    <HotkeyScopeBoundary
      scope={detailScope}
      componentName={`ActiveSession-${session?.archived ? 'archived' : 'normal'}`}
    >
      <section className="flex flex-col h-full gap-3">
        {/* Header with working directory dropdown */}
        <div className="flex items-center justify-between gap-2">
          {session.workingDir && (
            <AdditionalDirectoriesDropdown
              workingDir={session.workingDir}
              directories={session.additionalDirectories || []}
              sessionStatus={session.status}
              onDirectoriesChange={handleUpdateAdditionalDirectories}
              open={directoriesDropdownOpen}
              onOpenChange={setDirectoriesDropdownOpen}
            />
          )}

          {/* Fork view modal */}
          <ForkViewModal
            events={events}
            isOpen={forkViewOpen}
            onOpenChange={open => {
              setForkViewOpen(open)
              if (!open && responseEditor) {
                setTimeout(() => {
                  responseEditor.commands.focus()
                }, 50)
              }
            }}
            sessionStatus={session.status}
            onForkPreview={handleForkPreview}
            onForkCancel={handleForkCancel}
          />
        </div>

        <div className="flex flex-1 gap-4 flex-col lg:flex-row min-h-0">
          {/* Conversation content */}
          <Card
            className={`Conversation-Card w-full relative ${cardVerticalPadding} flex flex-col min-h-0`}
          >
            <CardContent className="px-3 flex flex-col flex-1 min-h-0">
              <ConversationStream
                session={session}
                focusedEventId={navigation.focusedEventId}
                setFocusedEventId={navigation.setFocusedEventId}
                onApprove={approvals.handleApprove}
                onDeny={(approvalId: string, reason: string) =>
                  approvals.handleDeny(approvalId, reason, session.id)
                }
                approvingApprovalId={approvals.approvingApprovalId}
                denyingApprovalId={approvals.denyingApprovalId ?? undefined}
                setDenyingApprovalId={id => {
                  if (id === null) {
                    approvals.handleCancelDeny()
                  } else {
                    // Clear fork state when entering denial mode
                    if (forkPreviewData) {
                      setForkPreviewData(null)
                      responseEditor?.commands.setContent('')
                    }
                    approvals.handleStartDeny(id)
                  }
                }}
                onCancelDeny={approvals.handleCancelDeny}
                focusSource={navigation.focusSource}
                setFocusSource={navigation.setFocusSource}
                expandedToolResult={expandedToolResult}
                setExpandedToolResult={setExpandedToolResult}
                setExpandedToolCall={setExpandedToolCall}
                maxEventIndex={forkPreviewData?.eventIndex ?? undefined}
                shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
                expandedTasks={expandedTasks}
                toggleTaskGroup={toggleTaskGroup}
              />
            </CardContent>
            {isActivelyProcessing && (
              <div
                className={`absolute bottom-0 left-0 px-3 py-1.5 border-t border-border bg-secondary/30 w-full font-mono text-xs uppercase tracking-wider text-muted-foreground transition-all duration-300 ease-out ${
                  isActivelyProcessing ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
                }`}
              >
                <OmniSpinner />
              </div>
            )}
            {/* Status bar for pending approvals */}
            <div
              className={`absolute bottom-0 left-0 right-0 p-2 cursor-pointer transition-all duration-300 ease-in-out ${
                hasPendingApprovalsOutOfView
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-full pointer-events-none'
              }`}
              onClick={() => {
                const container = document.querySelector('[data-conversation-container]')
                if (container) {
                  container.scrollTop = container.scrollHeight
                }
              }}
            >
              <div className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground bg-background/60 backdrop-blur-sm border-t border-border/50 py-1 shadow-sm hover:bg-background/80 transition-colors">
                <span>Pending Approval</span>
                <ChevronDown className="w-3 h-3 animate-bounce" />
              </div>
            </div>
          </Card>

          {lastTodo && (
            <Card className="hidden lg:flex lg:w-1/5 flex-col min-h-0">
              <CardContent className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <TodoWidget event={lastTodo} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Active session input */}
        <ActiveSessionInput
          session={session}
          parentSessionData={parentSessionData || parentSession || undefined}
          isResponding={actions.isResponding}
          handleContinueSession={actions.handleContinueSession}
          isForkMode={!!forkPreviewData}
          forkTokenCount={forkPreviewData?.tokenCount}
          forkTurnNumber={
            forkPreviewData?.eventIndex !== undefined
              ? events
                  .slice(0, forkPreviewData.eventIndex)
                  .filter(e => e.eventType === 'message' && e.role === 'user').length
              : undefined
          }
          onModelChange={() => {
            fetchActiveSessionDetail(session.id)
          }}
          denyingApprovalId={approvals.denyingApprovalId ?? undefined}
          isDenying={approvals.isDenying}
          onDeny={approvals.handleDeny}
          handleCancelDeny={approvals.handleCancelDeny}
          denyAgainstOldestApproval={approvals.denyAgainstOldestApproval}
          onToggleAutoAccept={handleToggleAutoAccept}
          onToggleDangerouslySkipPermissions={handleToggleDangerouslySkipPermissions}
          onToggleForkView={handleToggleForkView}
          canFork={forkPreviewData === null && !isActivelyProcessing}
          bypassEnabled={dangerouslySkipPermissions}
          autoAcceptEnabled={autoAcceptEdits}
          isArchived={session.archived || false}
          onToggleArchive={handleToggleArchive}
        />

        {/* Session mode indicator */}
        <SessionModeIndicator
          sessionId={session.id}
          autoAcceptEdits={autoAcceptEdits}
          dangerouslySkipPermissions={dangerouslySkipPermissions}
          dangerouslySkipPermissionsExpiresAt={dangerouslySkipPermissionsExpiresAt}
          sessionStatus={session.status}
          isForkMode={!!forkPreviewData}
          forkTurnNumber={
            forkPreviewData?.eventIndex !== undefined
              ? events
                  .slice(0, forkPreviewData.eventIndex)
                  .filter(e => e.eventType === 'message' && e.role === 'user').length
              : undefined
          }
          forkTokenCount={forkPreviewData?.tokenCount}
          className="mt-2"
          onToggleAutoAccept={handleToggleAutoAccept}
          onToggleBypass={handleToggleDangerouslySkipPermissions}
        />

        {/* Tool Result Expansion Modal */}
        {(expandedToolResult || expandedToolCall) && (
          <ToolResultModal
            toolCall={expandedToolCall}
            toolResult={expandedToolResult}
            onClose={() => {
              setExpandedToolResult(null)
              setExpandedToolCall(null)
            }}
          />
        )}

        {/* Dangerously Skip Permissions Dialog */}
        <DangerouslySkipPermissionsDialog
          open={dangerousSkipPermissionsDialogOpen}
          onOpenChange={setDangerousSkipPermissionsDialogOpen}
          onConfirm={handleDangerousSkipPermissionsConfirm}
        />
      </section>
    </HotkeyScopeBoundary>
  )
}
