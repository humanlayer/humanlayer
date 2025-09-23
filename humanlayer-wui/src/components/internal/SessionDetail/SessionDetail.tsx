import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router'

import { ConversationEvent, Session, ApprovalStatus, SessionStatus } from '@/lib/daemon/types'
import { Card, CardContent } from '@/components/ui/card'
import { useConversation, useKeyboardNavigationProtection } from '@/hooks'
import { ChevronDown } from 'lucide-react'
import { daemonClient } from '@/lib/daemon/client'
import { useStore } from '@/AppStore'

// Import extracted components
import { ConversationStream } from '../ConversationStream/ConversationStream'
import { ToolResultModal } from './components/ToolResultModal'
import { TodoWidget } from './components/TodoWidget'
import { ResponseInput } from './components/ResponseInput'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import { SessionModeIndicator } from './AutoAcceptIndicator'
import { ForkViewModal } from './components/ForkViewModal'
import { DangerouslySkipPermissionsDialog } from './DangerouslySkipPermissionsDialog'
import { AdditionalDirectoriesDropdown } from './components/AdditionalDirectoriesDropdown'

// Import hooks
import { useSessionActions } from './hooks/useSessionActions'
import { useSessionApprovals } from './hooks/useSessionApprovals'
import { useSessionNavigation } from './hooks/useSessionNavigation'
import { useTaskGrouping } from './hooks/useTaskGrouping'
import { useSessionClipboard } from './hooks/useSessionClipboard'
import { logger } from '@/lib/logging'

interface SessionDetailProps {
  session: Session
  onClose: () => void
}

// SessionDetail uses its own scope so it can be properly disabled when modals are open
export const SessionDetailHotkeysScope = 'session-detail'

const ROBOT_VERBS = [
  'accelerating',
  'actuating',
  'adhering',
  'aggregating',
  'amplifying',
  'anthropomorphizing',
  'attending',
  'balancing',
  'bamboozling',
  'capacitizing',
  'clauding',
  'collapsing',
  'conducting',
  'defragmenting',
  'densifying',
  'diffusing',
  'enchanting',
  'enshrining',
  'extrapolating',
  'finagling',
  'fixating',
  'frolicking',
  'fusing',
  'generating',
  'gravitating',
  'harmonizing',
  'hyperthreading',
  'hypothecating',
  'ideating',
  'inducting',
  'ionizing',
  'layering',
  'mechanizing',
  'overclocking',
  'overcomplicating',
  'philosophizing',
  'photosynthesizing',
  'potentiating',
  'proliferating',
  'propagating',
  'prototyping',
  'quantizing',
  'radiating',
  'recalibrating',
  'receiving',
  'reflecting',
  'riffing',
  'schlepping',
  'shapeshifting',
  'simplifying',
  'sublimating',
  'superconducting',
  'synergizing',
  'thriving',
  'transcribing',
  'transisting',
  'triangulating',
  'vibing',
  'zooming',
]

function OmniSpinner({ randomVerb, spinnerType }: { randomVerb: string; spinnerType: number }) {
  // Select spinner based on random type
  const FancySpinner = (
    <div className="relative w-2 h-2">
      {/* Outermost orbiting particles */}
      <div className="absolute inset-0 animate-spin-slow">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary/40 animate-pulse" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary/40 animate-pulse delay-75" />
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-primary/40 animate-pulse delay-150" />
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-primary/40 animate-pulse delay-300" />
      </div>

      {/* Outer gradient ring */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/0 via-primary/30 to-primary/0 animate-spin" />

      {/* Mid rotating ring with gradient */}
      <div className="absolute inset-1 rounded-full">
        <div className="absolute inset-0 rounded-full bg-gradient-conic from-primary/10 via-primary/50 to-primary/10 animate-spin-reverse" />
      </div>

      {/* Inner wave ring */}
      <div className="absolute inset-2 rounded-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-transparent to-primary/30 animate-wave" />
      </div>

      {/* Morphing core */}
      <div className="absolute inset-3 animate-morph">
        <div className="absolute inset-0 rounded-full bg-gradient-radial from-primary/60 to-primary/20 blur-sm" />
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/40 to-transparent" />
      </div>

      {/* Center glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="absolute w-2 h-2 rounded-full bg-primary/80 animate-ping" />
          <div className="relative w-2 h-2 rounded-full bg-primary animate-pulse-bright" />
        </div>
      </div>

      {/* Random glitch effect */}
      <div className="absolute inset-0 rounded-full opacity-20 animate-glitch" />
    </div>
  )

  const SimpleSpinner = (
    <div className="relative w-2 h-2">
      {/* Single spinning ring */}
      <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary/60 animate-spin" />

      {/* Pulsing center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
      </div>

      {/* Simple gradient overlay */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/10 to-transparent" />
    </div>
  )

  const MinimalSpinner = (
    <div className="relative w-10 h-10">
      {/* Three dots rotating */}
      <div className="absolute inset-0 animate-spin">
        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary/60" />
        <div className="absolute bottom-1 left-2 w-1.5 h-1.5 rounded-full bg-primary/40" />
        <div className="absolute bottom-1 right-2 w-1.5 h-1.5 rounded-full bg-primary/40" />
      </div>
    </div>
  )

  const BarsSpinner = (
    <div className="relative w-10 h-2 flex items-center justify-center gap-1">
      {/* Five bouncing bars */}
      <div className="w-1 h-2 bg-primary/40 rounded-full animate-bounce-slow" />
      <div className="w-1 h-3 bg-primary/60 rounded-full animate-bounce-medium" />
      <div className="w-1 h-2 bg-primary/80 rounded-full animate-bounce-fast" />
      <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce-medium delay-150" />
      <div className="w-1 h-2 bg-primary/40 rounded-full animate-bounce-slow delay-300" />
    </div>
  )

  const spinners = [FancySpinner, SimpleSpinner, MinimalSpinner, BarsSpinner]

  return (
    <div className="flex items-center gap-3 ">
      {spinners[spinnerType]}
      <p className="text-muted-foreground opacity-80 animate-fade-pulse">{randomVerb}</p>
    </div>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const { enableScope, disableScope } = useHotkeysContext()
  const [isWideView, setIsWideView] = useState(false)
  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [forkViewOpen, setForkViewOpen] = useState(false)
  const [previewEventIndex, setPreviewEventIndex] = useState<number | null>(null)
  const [pendingForkMessage, setPendingForkMessage] = useState<ConversationEvent | null>(null)
  const [forkTokenCount, setForkTokenCount] = useState<number | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [dangerousSkipPermissionsDialogOpen, setDangerousSkipPermissionsDialogOpen] = useState(false)
  const [directoriesDropdownOpen, setDirectoriesDropdownOpen] = useState(false)

  const responseEditor = useStore(state => state.responseEditor)
  const isEditingSessionTitle = useStore(state => state.isEditingSessionTitle)
  const setIsEditingSessionTitle = useStore(state => state.setIsEditingSessionTitle)

  // Keyboard navigation protection
  const { shouldIgnoreMouseEvent, startKeyboardNavigation } = useKeyboardNavigationProtection()

  const isActivelyProcessing = ['starting', 'running', 'completing'].includes(session.status)
  const confirmingArchiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Get session from store to access auto_accept_edits and dangerouslySkipPermissions
  // Always prioritize store values as they are the source of truth for runtime state
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

  // Debug logging for token data
  useEffect(() => {
    console.log('[TokenDebug] Session token state:', {
      sessionId: session.id,
      parentSessionId: session.parentSessionId,
      sessionTokens: session.effectiveContextTokens,
      parentTokens: parentSessionData?.effectiveContextTokens,
      fallbackTokens: session.effectiveContextTokens ?? parentSessionData?.effectiveContextTokens,
      sessionFromStore: sessionFromStore?.effectiveContextTokens,
      parentFromStore: parentSession,
      parentFetched: parentSessionData,
    })
  }, [
    session.id,
    session.effectiveContextTokens,
    parentSessionData?.effectiveContextTokens,
    sessionFromStore?.effectiveContextTokens,
  ])

  // Use store values if available, otherwise fall back to session prop
  // Store values take precedence because they reflect real-time updates
  const autoAcceptEdits =
    sessionFromStore?.autoAcceptEdits !== undefined
      ? sessionFromStore.autoAcceptEdits
      : (session.autoAcceptEdits ?? false)

  const dangerouslySkipPermissions =
    sessionFromStore?.dangerouslySkipPermissions !== undefined
      ? sessionFromStore.dangerouslySkipPermissions
      : (session.dangerouslySkipPermissions ?? false)

  const dangerouslySkipPermissionsExpiresAt =
    sessionFromStore?.dangerouslySkipPermissionsExpiresAt !== undefined
      ? sessionFromStore.dangerouslySkipPermissionsExpiresAt?.toISOString()
      : session.dangerouslySkipPermissionsExpiresAt?.toISOString()

  // Enable SessionDetail scope when mounted
  useEffect(() => {
    enableScope(SessionDetailHotkeysScope)
    return () => {
      disableScope(SessionDetailHotkeysScope)
    }
  }, [enableScope, disableScope])

  // Debug logging
  useEffect(() => {
    logger.log('Session permissions state', {
      sessionId: session.id,
      dangerouslySkipPermissions,
      dangerouslySkipPermissionsExpiresAt,
      sessionFromStore: sessionFromStore
        ? {
            id: sessionFromStore.id,
            dangerouslySkipPermissions: sessionFromStore.dangerouslySkipPermissions,
            dangerouslySkipPermissionsExpiresAt: sessionFromStore.dangerouslySkipPermissionsExpiresAt,
          }
        : 'not found',
      sessionProp: {
        dangerouslySkipPermissions: session.dangerouslySkipPermissions,
        dangerouslySkipPermissionsExpiresAt: session.dangerouslySkipPermissionsExpiresAt,
      },
    })
  }, [
    session.id,
    dangerouslySkipPermissions,
    dangerouslySkipPermissionsExpiresAt,
    sessionFromStore?.dangerouslySkipPermissions,
  ])

  // Generate random verb that changes every 10-20 seconds
  const [randomVerb, setRandomVerb] = useState(() => {
    const verb = ROBOT_VERBS[Math.floor(Math.random() * ROBOT_VERBS.length)]
    return verb.charAt(0).toUpperCase() + verb.slice(1)
  })

  // Randomly choose spinner type on mount (0: fancy, 1: simple, 2: bars)
  const spinnerType = useMemo(() => {
    const types = [0, 1, 3] // Excluding 2 (minimal)
    return types[Math.floor(Math.random() * types.length)]
  }, [])

  useEffect(() => {
    if (!isActivelyProcessing) return

    const changeVerb = () => {
      const verb = ROBOT_VERBS[Math.floor(Math.random() * ROBOT_VERBS.length)]
      setRandomVerb(verb.charAt(0).toUpperCase() + verb.slice(1))
    }

    let intervalId: ReturnType<typeof setTimeout>

    // Function to schedule next change
    const scheduleNextChange = () => {
      const delay = 2000 + Math.random() * 18000 // 2-20 seconds
      intervalId = setTimeout(() => {
        changeVerb()
        scheduleNextChange() // Schedule the next change
      }, delay)
    }

    // Start the first scheduled change
    scheduleNextChange()

    // Cleanup
    return () => {
      if (intervalId) clearTimeout(intervalId)
    }
  }, [isActivelyProcessing])

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
    disabled: forkViewOpen, // Disable navigation when fork view is open
    startKeyboardNavigation,
  })

  // Use approvals hook
  const approvals = useSessionApprovals({
    sessionId: session.id,
    events,
    focusedEventId: navigation.focusedEventId,
    setFocusedEventId: navigation.setFocusedEventId,
    setFocusSource: navigation.setFocusSource,
  })

  // Use clipboard hook
  const focusedEvent = events.find(e => e.id === navigation.focusedEventId) || null
  useSessionClipboard(focusedEvent, !expandedToolResult && !forkViewOpen)

  // Handle approval parameter from URL
  const [searchParams, setSearchParams] = useSearchParams()
  const targetApprovalId = searchParams.get('approval')
  const processedApprovalRef = useRef<string | null>(null)

  // Handle auto-focus when navigating with approval parameter
  useEffect(() => {
    // Only run when we actually have an approval ID to focus
    if (!targetApprovalId || events.length === 0) {
      return
    }

    // Skip if we've already processed this approval ID
    if (processedApprovalRef.current === targetApprovalId) {
      return
    }

    if (approvals.focusApprovalById) {
      // Mark as processed before calling to prevent re-runs
      processedApprovalRef.current = targetApprovalId

      // Use the hook's focus method for consistency
      // This will try to match the specific approval, or fallback to most recent pending
      approvals.focusApprovalById(targetApprovalId)

      // Clear the parameter after focusing
      searchParams.delete('approval')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetApprovalId, events.length > 0, approvals.focusApprovalById]) // Minimal deps to prevent constant re-runs

  // Add fork commit handler
  const handleForkCommit = useCallback(() => {
    // Reset preview state after successful fork
    setPreviewEventIndex(null)
    setPendingForkMessage(null)
    setForkTokenCount(null)
    setForkViewOpen(false)
  }, [])

  // Use session actions hook
  const actions = useSessionActions({
    session,
    onClose,
    pendingForkMessage,
    onForkCommit: handleForkCommit,
  })

  // Add fork selection handler
  const handleForkSelect = useCallback(
    async (eventIndex: number | null) => {
      if (eventIndex === null) {
        // Return to current state - clear everything
        setPreviewEventIndex(null)
        setPendingForkMessage(null)
        setForkTokenCount(null)
        // Also clear the response input when selecting "Current"
        responseEditor?.commands.setContent('')
        return
      }

      // Set preview mode
      setPreviewEventIndex(eventIndex)

      // Find the selected user message
      const selectedEvent = events[eventIndex]
      if (selectedEvent?.eventType === 'message' && selectedEvent?.role === 'user') {
        // Find the session ID from the event before this one
        const previousEvent = eventIndex > 0 ? events[eventIndex - 1] : null
        const forkFromSessionId = previousEvent?.sessionId || session.id

        // Store both the message content and the session ID to fork from
        setPendingForkMessage({
          ...selectedEvent,
          sessionId: forkFromSessionId, // Override with the previous event's session ID
        })

        // Fetch session data to get token count
        try {
          const forkSessionData = await daemonClient.getSessionState(forkFromSessionId)
          setForkTokenCount(forkSessionData.session.effectiveContextTokens ?? null)
        } catch (error) {
          console.error('[Fork] Failed to fetch session token data:', error)
          // Set to null on error but don't block fork functionality
          setForkTokenCount(null)
        }
      }
    },
    [events, actions, session.id],
  )

  // We no longer automatically clear preview when closing
  // This allows the preview to persist after selecting with Enter

  // Screen size detection for responsive layout
  useEffect(() => {
    const checkScreenSize = () => {
      setIsWideView(window.innerWidth >= 1024) // lg breakpoint
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  // Scroll to bottom when session opens
  useEffect(() => {
    // Scroll to bottom of conversation
    const container = document.querySelector('[data-conversation-container]')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [session.id]) // Re-run when session changes

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
    // Update the local store and refresh session data
    useStore.getState().updateSession(session.id, { additionalDirectories: directories })
  }

  // Check if there are pending approvals out of view
  const [hasPendingApprovalsOutOfView, setHasPendingApprovalsOutOfView] = useState(false)

  const lastTodo = events
    ?.toReversed()
    .find(e => e.eventType === 'tool_call' && e.toolName === 'TodoWrite')

  // Clear focus on escape, then close if nothing focused
  // This needs special handling for confirmingApprovalId

  useHotkeys(
    'escape',
    ev => {
      if ((ev.target as HTMLElement)?.dataset.slot === 'dialog-close') {
        logger.warn('Ignoring onClose triggered by dialog-close in SessionDetail')
        return null
      }

      // Don't process escape if editing session title
      if (isEditingSessionTitle) {
        return
      }

      // Don't process escape if modals are open
      if (forkViewOpen) {
        return
      }

      // Don't process escape if dangerous skip permissions dialog is open
      if (dangerousSkipPermissionsDialogOpen) {
        return
      }

      // Don't process escape if directories dropdown is open
      if (directoriesDropdownOpen) {
        return
      }

      // Don't process escape if tool result modal is open
      if (expandedToolResult) {
        return
      }

      if (responseEditor?.isFocused) {
        responseEditor.commands.blur()
        return
      }

      // Check for fork mode first
      if (previewEventIndex !== null) {
        // Clear fork mode
        setPreviewEventIndex(null)
        setPendingForkMessage(null)
        setForkTokenCount(null)
        responseEditor?.commands.setContent('')
      } else if (confirmingArchive) {
        setConfirmingArchive(false)
        // Clear timeout if exists
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
      enableOnFormTags: true, // Enable escape key in form elements like textarea
      scopes: SessionDetailHotkeysScope,
    },
    [
      isEditingSessionTitle,
      previewEventIndex,
      confirmingArchive,
      forkViewOpen,
      dangerousSkipPermissionsDialogOpen,
      expandedToolResult,
      approvals.confirmingApprovalId,
      approvals.setConfirmingApprovalId,
      navigation.focusedEventId,
      navigation.setFocusedEventId,
      onClose,
      // actions.setResponseInput,
    ],
  )

  // Get hotkeys context for modal scope checking
  const { activeScopes } = useHotkeysContext()

  // Create reusable handler for toggling auto-accept
  const handleToggleAutoAccept = useCallback(async () => {
    logger.log('toggleAutoAcceptEdits', autoAcceptEdits)
    try {
      const newState = !autoAcceptEdits
      await updateSessionOptimistic(session.id, { autoAcceptEdits: newState })
    } catch (error) {
      logger.error('Failed to toggle auto-accept mode:', error)
      toast.error('Failed to toggle auto-accept mode')
    }
  }, [session.id, autoAcceptEdits, updateSessionOptimistic])

  // Create reusable handler for toggling dangerously skip permissions
  const handleToggleDangerouslySkipPermissions = useCallback(async () => {
    // Check if any modal scopes are active
    const modalScopes = ['tool-result-modal', 'fork-view-modal', 'dangerously-skip-permissions-dialog']
    const hasModalOpen = activeScopes.some(scope => modalScopes.includes(scope))

    // Don't trigger if other modals are open
    if (hasModalOpen || dangerousSkipPermissionsDialogOpen) {
      return
    }

    // Get the current value from the store directly to avoid stale closure
    const currentSessionFromStore = useStore.getState().sessions.find(s => s.id === session.id)
    const currentDangerouslySkipPermissions =
      currentSessionFromStore?.dangerouslySkipPermissions ?? false

    if (currentDangerouslySkipPermissions) {
      // Disable dangerous skip permissions
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
      // Show confirmation dialog
      setDangerousSkipPermissionsDialogOpen(true)
    }
  }, [session.id, activeScopes, dangerousSkipPermissionsDialogOpen, updateSessionOptimistic])

  // Add Shift+Tab handler for auto-accept edits mode
  useHotkeys(
    'shift+tab',
    handleToggleAutoAccept,
    {
      preventDefault: true,
      scopes: SessionDetailHotkeysScope,
    },
    [handleToggleAutoAccept],
  )

  // Add Option+Y handler for dangerously skip permissions mode
  useHotkeys(
    'alt+y',
    handleToggleDangerouslySkipPermissions,
    {
      preventDefault: true,
      scopes: SessionDetailHotkeysScope,
    },
    [handleToggleDangerouslySkipPermissions],
  )

  // Handle dialog confirmation
  const handleDangerousSkipPermissionsConfirm = async (timeoutMinutes: number | null) => {
    try {
      // Immediately update the store for instant UI feedback
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

  // Add hotkey to archive session ('e' key)
  useHotkeys(
    'e',
    async () => {
      // TODO(3): The timeout clearing logic (using confirmingArchiveTimeoutRef) is duplicated in multiple places.
      // Consider refactoring this into a helper function to reduce repetition.

      // Clear any existing timeout
      if (confirmingArchiveTimeoutRef.current) {
        clearTimeout(confirmingArchiveTimeoutRef.current)
        confirmingArchiveTimeoutRef.current = null
      }

      // Check if session is active (requires confirmation)
      const isActiveSession = (
        [SessionStatus.Starting, SessionStatus.Running, SessionStatus.WaitingInput] as SessionStatus[]
      ).includes(session.status)

      const isArchiving = !session.archived

      if (isActiveSession && !confirmingArchive) {
        // First press - show warning
        setConfirmingArchive(true)
        // TODO(3): Consider using a Dialog instead of toast for archive confirmation.
        // This would improve accessibility (mouse users can click buttons) and avoid
        // complexity around timeout management. The current toast approach works but
        // isn't ideal for all users.
        toast.warning('Press e again to archive active session', {
          description: 'This session is still active. Press e again within 3 seconds to confirm.',
          duration: 3000,
        })

        // Set timeout to reset confirmation state
        confirmingArchiveTimeoutRef.current = setTimeout(() => {
          setConfirmingArchive(false)
          confirmingArchiveTimeoutRef.current = null
        }, 3000)
        return
      }

      // Either second press for active session or immediate archive for completed/failed
      try {
        await useStore.getState().archiveSession(session.id, isArchiving)

        // Clear confirmation state
        setConfirmingArchive(false)

        // Show success notification matching list view behavior
        toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
          description: session.summary || 'Untitled session',
          duration: 3000,
        })

        // Navigate back to session list
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
      scopes: SessionDetailHotkeysScope,
    },
    [session.id, session.archived, session.summary, session.status, onClose, confirmingArchive],
  )

  // Create reusable handler for toggling fork view
  const handleToggleForkView = useCallback(() => {
    // Check if any modal scopes are active
    const modalScopes = ['tool-result-modal', 'dangerously-skip-permissions-dialog']
    const hasModalOpen = activeScopes.some(scope => modalScopes.includes(scope))

    // Don't trigger if other modals are open
    if (hasModalOpen) {
      return
    }

    setForkViewOpen(!forkViewOpen)
  }, [activeScopes, forkViewOpen])

  // Add hotkey to open fork view (Meta+Y)
  useHotkeys(
    'meta+y',
    e => {
      e.preventDefault()
      handleToggleForkView()
    },
    {
      scopes: SessionDetailHotkeysScope,
    },
    [handleToggleForkView],
  )

  // Create archive handler
  const handleToggleArchive = useCallback(async () => {
    // Check if session is active (requires confirmation)
    const isActiveSession = [
      SessionStatus.Starting,
      SessionStatus.Running,
      SessionStatus.WaitingInput,
    ].includes(session.status as any)

    const isArchiving = !session.archived

    if (isActiveSession && !confirmingArchive) {
      // First press - show warning
      setConfirmingArchive(true)
      toast.warning('Press e again to archive active session', {
        description: 'This session is still active. Press e again within 3 seconds to confirm.',
        duration: 3000,
      })

      // Set timeout to reset confirmation state
      confirmingArchiveTimeoutRef.current = setTimeout(() => {
        setConfirmingArchive(false)
        confirmingArchiveTimeoutRef.current = null
      }, 3000)
      return
    }

    // Either second press for active session or immediate archive for completed/failed
    try {
      await useStore.getState().archiveSession(session.id, isArchiving)

      // Clear confirmation state
      setConfirmingArchive(false)

      // Show success notification matching list view behavior
      toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
        description: session.summary || 'Untitled session',
        duration: 3000,
      })

      // Navigate back to session list
      onClose()
    } catch (error) {
      toast.error('Failed to archive session', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      setConfirmingArchive(false)
    }
  }, [session.id, session.archived, session.summary, session.status, onClose, confirmingArchive])

  // Add Shift+G hotkey to scroll to bottom
  useHotkeys(
    'shift+g',
    () => {
      startKeyboardNavigation()

      const container = document.querySelector('[data-conversation-container]')
      if (container) {
        container.scrollTop = container.scrollHeight
        // Focus the last event
        if (events.length > 0) {
          const lastEvent = events[events.length - 1]
          if (lastEvent.id !== undefined) {
            navigation.setFocusedEventId(lastEvent.id)
            navigation.setFocusSource('keyboard')
          }
        }
      }
    },
    {
      scopes: SessionDetailHotkeysScope,
    },
    [events, navigation.setFocusedEventId, navigation.setFocusSource],
  )

  // Add 'gg' to jump to top of conversation (vim-style)
  useHotkeys(
    'g>g',
    () => {
      startKeyboardNavigation()

      const container = document.querySelector('[data-conversation-container]')
      if (container) {
        container.scrollTop = 0
        // Focus the first event
        if (events.length > 0) {
          const firstEvent = events[0]
          if (firstEvent.id !== undefined) {
            navigation.setFocusedEventId(firstEvent.id)
            navigation.setFocusSource('keyboard')
          }
        }
      }
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
      scopes: SessionDetailHotkeysScope,
    },
    [events, navigation.setFocusedEventId, navigation.setFocusSource],
  )

  // Add Enter key to focus text input
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
      scopes: SessionDetailHotkeysScope,
    },
  )

  // Toggle directories dropdown hotkey
  useHotkeys(
    'shift+d',
    () => {
      setDirectoriesDropdownOpen(prev => !prev)
    },
    {
      scopes: SessionDetailHotkeysScope,
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
      scopes: SessionDetailHotkeysScope,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [setIsEditingSessionTitle, approvals.confirmingApprovalId, expandedToolResult],
  )

  // Don't steal scope here - SessionDetail is the base layer
  // Only modals opening on top should steal scope

  // Note: Most hotkeys are handled by the hooks (ctrl+x, r, p, i, a, d)
  // Only the escape key needs special handling here for confirmingApprovalId

  // Check if there are pending approvals out of view when in waiting_input status
  useEffect(() => {
    const checkPendingApprovalVisibility = () => {
      if (session.status === SessionStatus.WaitingInput) {
        const pendingEvent = events.find(e => e.approvalStatus === ApprovalStatus.Pending)
        if (pendingEvent) {
          const container = document.querySelector('[data-conversation-container]')
          const element = container?.querySelector(`[data-event-id="${pendingEvent.id}"]`)
          if (container && element) {
            // Check if the approve/deny buttons are visible
            // Look for buttons containing the approval keyboard shortcuts
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

            // Consider the buttons in view if they're at least partially visible
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

    // Initial check
    checkPendingApprovalVisibility()

    // Add scroll listener
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

  return (
    <section className="flex flex-col h-full gap-3">
      {/* Unified header with working directory */}
      <div className="flex items-center justify-between gap-2">
        {/* Working directory info */}
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
          selectedEventIndex={previewEventIndex}
          onSelectEvent={handleForkSelect}
          isOpen={forkViewOpen}
          onOpenChange={open => {
            setForkViewOpen(open)
            // Focus the input when closing the fork modal
            // Use longer delay to ensure it happens after all dialog cleanup
            if (!open && responseEditor) {
              setTimeout(() => {
                responseEditor.commands.focus()
              }, 50)
            }
          }}
          sessionStatus={session.status}
        />
      </div>

      <div className={`flex flex-1 gap-4 ${isWideView ? 'flex-row' : 'flex-col'} min-h-0`}>
        {/* Conversation content and Loading */}
        <Card
          className={`Conversation-Card w-full relative ${cardVerticalPadding} flex flex-col min-h-0`}
        >
          <CardContent className="px-3 flex flex-col flex-1 min-h-0">
            <ConversationStream
              sessionId={session.id}
              focusedEventId={navigation.focusedEventId}
              setFocusedEventId={navigation.setFocusedEventId}
              onApprove={approvals.handleApprove}
              onDeny={(approvalId: string, reason: string) =>
                approvals.handleDeny(approvalId, reason, session.id)
              }
              approvingApprovalId={approvals.approvingApprovalId}
              denyingApprovalId={approvals.denyingApprovalId ?? undefined}
              setDenyingApprovalId={approvals.setDenyingApprovalId}
              onCancelDeny={approvals.handleCancelDeny}
              focusSource={navigation.focusSource}
              setFocusSource={navigation.setFocusSource}
              expandedToolResult={expandedToolResult}
              setExpandedToolResult={setExpandedToolResult}
              setExpandedToolCall={setExpandedToolCall}
              maxEventIndex={previewEventIndex ?? undefined}
              shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
              expandedTasks={expandedTasks}
              toggleTaskGroup={toggleTaskGroup}
            />
          </CardContent>
          {isActivelyProcessing && (
            <div
              className={`absolute bottom-0 left-0 px-3 py-1.5 border-t border-border bg-secondary/30 w-full font-mono text-sm uppercase tracking-wider text-muted-foreground transition-all duration-300 ease-out ${
                isActivelyProcessing ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
              }`}
            >
              <OmniSpinner randomVerb={randomVerb} spinnerType={spinnerType} />
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

        {isWideView && lastTodo && (
          <Card className="w-[20%] flex flex-col min-h-0">
            <CardContent className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <TodoWidget event={lastTodo} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Response input - always show but disable for non-completed sessions */}
      <Card className="py-2">
        <CardContent className="px-2">
          <ResponseInput
            denyingApprovalId={approvals.denyingApprovalId ?? undefined}
            isDenying={approvals.isDenying}
            onDeny={approvals.handleDeny}
            handleCancelDeny={approvals.handleCancelDeny}
            denyAgainstOldestApproval={approvals.denyAgainstOldestApproval}
            session={session}
            parentSessionData={parentSessionData || parentSession || undefined}
            isResponding={actions.isResponding}
            handleContinueSession={actions.handleContinueSession}
            isForkMode={actions.isForkMode}
            forkTokenCount={forkTokenCount}
            forkTurnNumber={
              previewEventIndex !== null
                ? events
                    .slice(0, previewEventIndex)
                    .filter(e => e.eventType === 'message' && e.role === 'user').length
                : undefined
            }
            onModelChange={() => {
              // Refresh session data if needed
              fetchActiveSessionDetail(session.id)
            }}
            sessionStatus={session.status}
            onToggleAutoAccept={handleToggleAutoAccept}
            onToggleDangerouslySkipPermissions={handleToggleDangerouslySkipPermissions}
            onToggleForkView={handleToggleForkView}
            // ActionButtons props
            canFork={previewEventIndex === null && !isActivelyProcessing}
            bypassEnabled={dangerouslySkipPermissions}
            autoAcceptEnabled={autoAcceptEdits}
            isArchived={session.archived || false}
            onToggleArchive={handleToggleArchive}
            previewEventIndex={previewEventIndex}
            isActivelyProcessing={isActivelyProcessing}
          />
          {/* Session mode indicator - shows fork, dangerous skip permissions or auto-accept */}
          <SessionModeIndicator
            sessionId={session.id}
            autoAcceptEdits={autoAcceptEdits}
            dangerouslySkipPermissions={dangerouslySkipPermissions}
            dangerouslySkipPermissionsExpiresAt={dangerouslySkipPermissionsExpiresAt}
            isForkMode={previewEventIndex !== null}
            forkTurnNumber={
              previewEventIndex !== null
                ? events
                    .slice(0, previewEventIndex)
                    .filter(e => e.eventType === 'message' && e.role === 'user').length
                : undefined
            }
            forkTokenCount={forkTokenCount}
            className="mt-2"
            onToggleAutoAccept={handleToggleAutoAccept}
            onToggleBypass={handleToggleDangerouslySkipPermissions}
          />
        </CardContent>
      </Card>

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
  )
}

// Export wrapped component
const SessionDetailWithErrorBoundary = (props: SessionDetailProps) => {
  // const navigate = useNavigate()

  return (
    <SentryErrorBoundary
      variant="session-detail"
      componentName="SessionDetail"
      handleRefresh={() => {
        window.location.href = `/#/sessions/${props.session.id}`
      }}
      refreshButtonText="Reload Session"
    >
      <SessionDetail {...props} />
    </SentryErrorBoundary>
  )
}

export default SessionDetailWithErrorBoundary
