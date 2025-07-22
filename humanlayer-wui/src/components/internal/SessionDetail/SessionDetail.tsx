import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { ConversationEvent, SessionInfo, ApprovalStatus, SessionStatus } from '@/lib/daemon/types'
import { Card, CardContent } from '@/components/ui/card'
import { useConversation, useKeyboardNavigationProtection } from '@/hooks'
import { ChevronDown, Archive, Pencil } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { truncate } from '@/utils/formatting'
import { daemonClient } from '@/lib/daemon/client'
import { useStore } from '@/stores/appStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// Import extracted components
import { ConversationContent } from './views/ConversationContent'
import { ToolResultModal } from './components/ToolResultModal'
import { TodoWidget } from './components/TodoWidget'
import { ResponseInput } from './components/ResponseInput'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AutoAcceptIndicator } from './AutoAcceptIndicator'
import { ForkViewModal } from './components/ForkViewModal'

// Import hooks
import { useSessionActions } from './hooks/useSessionActions'
import { useSessionApprovals } from './hooks/useSessionApprovals'
import { useSessionNavigation } from './hooks/useSessionNavigation'
import { useTaskGrouping } from './hooks/useTaskGrouping'
import { useSessionClipboard } from './hooks/useSessionClipboard'
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

export const SessionDetailHotkeysScope = 'session-detail'

const ROBOT_VERBS = [
  'riffing',
  'vibing',
  'schlepping',
  'ideating',
  'thriving',
  'frolicking',
  'photosynthesizing',
  'prototyping',
  'finagling',
  'overcomplicating',
  'clauding',
  'generating',
  'proliferating',
  'quantizing',
  'enshrining',
  'collapsing',
  'amplifying',
  'inducting',
  'capacitizing',
  'conducting',
  'densifying',
  'diffusing',
  'attending',
  'propagating',
  'fusing',
  'gravitating',
  'potentiating',
  'radiating',
  'reflecting',
  'simplifying',
  'superconducting',
  'fixating',
  'transisting',
  'accelerating',
  'transcribing',
  'receiving',
  'adhering',
  'connecting',
  'sublimating',
  'balancing',
  'ionizing',
  'actuating',
  'mechanizing',
  'harmonizing',
]

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [isWideView, setIsWideView] = useState(false)
  const [isCompactView, setIsCompactView] = useState(false)
  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [isSplitView, setIsSplitView] = useState(false)
  const [forkViewOpen, setForkViewOpen] = useState(false)
  const [previewEventIndex, setPreviewEventIndex] = useState<number | null>(null)
  const [pendingForkMessage, setPendingForkMessage] = useState<ConversationEvent | null>(null)
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  // State for inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editValue, setEditValue] = useState('')

  // Helper functions for inline title editing
  const startEditTitle = () => {
    setIsEditingTitle(true)
    setEditValue(session.title || session.summary || '')
  }

  const saveEditTitle = async () => {
    try {
      await daemonClient.updateSessionTitle(session.id, editValue)

      // Update the session in the store
      useStore.getState().updateSession(session.id, { title: editValue })

      setIsEditingTitle(false)
      setEditValue('')
    } catch (error) {
      toast.error('Failed to update session title', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const cancelEditTitle = () => {
    setIsEditingTitle(false)
    setEditValue('')
  }

  // Keyboard navigation protection
  const { shouldIgnoreMouseEvent, startKeyboardNavigation } = useKeyboardNavigationProtection()

  const isActivelyProcessing = ['starting', 'running', 'completing'].includes(session.status)
  const responseInputRef = useRef<HTMLTextAreaElement>(null)
  const confirmingArchiveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Get session from store to access auto_accept_edits
  const sessionFromStore = useStore(state => state.sessions.find(s => s.id === session.id))
  const autoAcceptEdits = sessionFromStore?.auto_accept_edits ?? false

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

  // Add fork commit handler
  const handleForkCommit = useCallback(() => {
    // Reset preview state after successful fork
    setPreviewEventIndex(null)
    setPendingForkMessage(null)
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
    (eventIndex: number | null) => {
      if (eventIndex === null) {
        // Return to current state - clear everything
        setPreviewEventIndex(null)
        setPendingForkMessage(null)
        // Also clear the response input when selecting "Current"
        actions.setResponseInput('')
        return
      }

      // Set preview mode
      setPreviewEventIndex(eventIndex)

      // Find the selected user message
      const selectedEvent = events[eventIndex]
      if (selectedEvent?.event_type === 'message' && selectedEvent?.role === 'user') {
        // Find the session ID from the event before this one
        const previousEvent = eventIndex > 0 ? events[eventIndex - 1] : null
        const forkFromSessionId = previousEvent?.session_id || session.id

        // Store both the message content and the session ID to fork from
        setPendingForkMessage({
          ...selectedEvent,
          session_id: forkFromSessionId, // Override with the previous event's session ID
        })
      }
    },
    [events, actions],
  )

  // We no longer automatically clear preview when closing
  // This allows the preview to persist after selecting with Enter

  // Screen size detection for responsive layout
  useEffect(() => {
    const checkScreenSize = () => {
      setIsWideView(window.innerWidth >= 1024) // lg breakpoint
      // Consider compact view for heights less than 800px
      setIsCompactView(window.innerHeight < 800)
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

  // Check if there are pending approvals out of view
  const [hasPendingApprovalsOutOfView, setHasPendingApprovalsOutOfView] = useState(false)

  const lastTodo = events
    ?.toReversed()
    .find(e => e.event_type === 'tool_call' && e.tool_name === 'TodoWrite')

  // Clear focus on escape, then close if nothing focused
  // This needs special handling for confirmingApprovalId

  useHotkeys(
    'escape',
    ev => {
      if ((ev.target as HTMLElement)?.dataset.slot === 'dialog-close') {
        console.warn('Ignoring onClose triggered by dialog-close in SessionDetail')
        return null
      }

      // Don't process escape if fork view is open
      if (forkViewOpen) {
        return
      }

      // If the textarea is focused, blur it and stop processing
      if (ev.target === responseInputRef.current && responseInputRef.current) {
        responseInputRef.current.blur()
        return
      }

      if (confirmingArchive) {
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
      scopes: SessionDetailHotkeysScope,
      enableOnFormTags: true, // Enable escape key in form elements like textarea
    },
  )

  // Add Shift+Tab handler for auto-accept edits mode
  useHotkeys(
    'shift+tab',
    async () => {
      try {
        const newState = !autoAcceptEdits
        await daemonClient.updateSessionSettings(session.id, {
          autoAcceptEdits: newState,
        })

        // State will be updated via event subscription
      } catch (error) {
        console.error('Failed to toggle auto-accept mode:', error)
      }
    },
    {
      scopes: [SessionDetailHotkeysScope],
      preventDefault: true,
    },
    [session.id, autoAcceptEdits], // Dependencies
  )

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
      const isActiveSession = [
        SessionStatus.Starting,
        SessionStatus.Running,
        SessionStatus.Completing,
        SessionStatus.WaitingInput,
      ].includes(session.status)

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
      scopes: [SessionDetailHotkeysScope],
      preventDefault: true,
    },
    [session.id, session.archived, session.summary, session.status, onClose, confirmingArchive],
  )

  // Add hotkey to open fork view (Meta+Y)
  useHotkeys(
    'meta+y',
    e => {
      e.preventDefault()
      setForkViewOpen(!forkViewOpen)
    },
    { scopes: [SessionDetailHotkeysScope] },
  )

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
          navigation.setFocusedEventId(events[events.length - 1].id)
          navigation.setFocusSource('keyboard')
        }
      }
    },
    { scopes: [SessionDetailHotkeysScope] },
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
          navigation.setFocusedEventId(events[0].id)
          navigation.setFocusSource('keyboard')
        }
      }
    },
    {
      enableOnFormTags: false,
      scopes: [SessionDetailHotkeysScope],
      preventDefault: true,
    },
    [events, navigation.setFocusedEventId, navigation.setFocusSource],
  )

  // Add Enter key to focus text input
  useHotkeys(
    'enter',
    () => {
      if (responseInputRef.current && session.status !== SessionStatus.Failed) {
        responseInputRef.current.focus()
      }
    },
    {
      scopes: SessionDetailHotkeysScope,
      enableOnFormTags: false,
      preventDefault: true,
    },
  )

  useStealHotkeyScope(SessionDetailHotkeysScope)

  // Note: Most hotkeys are handled by the hooks (ctrl+x, r, p, i, a, d)
  // Only the escape key needs special handling here for confirmingApprovalId

  // Check if there are pending approvals out of view when in waiting_input status
  useEffect(() => {
    const checkPendingApprovalVisibility = () => {
      if (session.status === SessionStatus.WaitingInput) {
        const pendingEvent = events.find(e => e.approval_status === ApprovalStatus.Pending)
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

  return (
    <section className={`flex flex-col h-full ${isCompactView ? 'gap-2' : 'gap-4'}`}>
      {!isCompactView && (
        <div className="flex items-start justify-between">
          <hgroup className="flex flex-col gap-1 flex-1">
            <h2 className="text-lg font-medium text-foreground font-mono flex items-center gap-2">
              {session.archived && <Archive className="h-4 w-4 text-muted-foreground" />}
              {isEditingTitle ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    aria-label="Edit session title"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEditTitle()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEditTitle()
                      }
                    }}
                    className="h-7 text-sm font-mono"
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" onClick={saveEditTitle} className="h-7 px-2">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEditTitle} className="h-7 px-2">
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <span>
                    {session.title || session.summary || truncate(session.query, 50)}{' '}
                    {session.parent_session_id && (
                      <span className="text-muted-foreground">[continued]</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={startEditTitle}
                    className="h-5 w-5 p-0 opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </h2>
            <small
              className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
            >
              {`${session.status}${session.model ? ` / ${session.model}` : ''}`}
            </small>
            {session.working_dir && (
              <small className="font-mono text-xs text-muted-foreground">{session.working_dir}</small>
            )}
          </hgroup>
          <ForkViewModal
            events={events}
            selectedEventIndex={previewEventIndex}
            onSelectEvent={handleForkSelect}
            isOpen={forkViewOpen}
            onOpenChange={setForkViewOpen}
            sessionStatus={session.status}
          />
        </div>
      )}
      {isCompactView && (
        <div className="flex items-start justify-between">
          <hgroup className="flex flex-col gap-0.5 flex-1">
            <h2 className="text-sm font-medium text-foreground font-mono flex items-center gap-2">
              {session.archived && <Archive className="h-3 w-3 text-muted-foreground" />}
              {isEditingTitle ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEditTitle()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEditTitle()
                      }
                    }}
                    className="h-6 text-xs font-mono"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={saveEditTitle}
                    className="h-6 px-1 text-xs"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEditTitle}
                    className="h-6 px-1 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <span>
                    {session.title || session.summary || truncate(session.query, 50)}{' '}
                    {session.parent_session_id && (
                      <span className="text-muted-foreground">[continued]</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={startEditTitle}
                    className="h-4 w-4 p-0 opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </>
              )}
            </h2>
            <small
              className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
            >
              {`${session.status}${session.model ? ` / ${session.model}` : ''}`}
            </small>
          </hgroup>
          <ForkViewModal
            events={events}
            selectedEventIndex={previewEventIndex}
            onSelectEvent={handleForkSelect}
            isOpen={forkViewOpen}
            onOpenChange={setForkViewOpen}
            sessionStatus={session.status}
          />
        </div>
      )}

      {/* Fork Mode Indicator */}
      {previewEventIndex !== null && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 mb-4 text-sm">
          <span className="text-amber-600 dark:text-amber-400">
            Fork mode: Forking from turn{' '}
            {
              events
                .slice(0, previewEventIndex)
                .filter(e => e.event_type === 'message' && e.role === 'user').length
            }
          </span>
        </div>
      )}

      <div className={`flex flex-1 gap-4 ${isWideView ? 'flex-row' : 'flex-col'} min-h-0`}>
        {/* Conversation content and Loading */}
        <Card
          className={`${isWideView ? 'flex-1' : 'w-full'} relative ${isCompactView ? 'py-2' : 'py-4'} flex flex-col min-h-0`}
        >
          <CardContent className={`${isCompactView ? 'px-2' : 'px-4'} flex flex-col flex-1 min-h-0`}>
            <ConversationContent
              sessionId={session.id}
              focusedEventId={navigation.focusedEventId}
              setFocusedEventId={navigation.setFocusedEventId}
              onApprove={approvals.handleApprove}
              onDeny={approvals.handleDeny}
              approvingApprovalId={approvals.approvingApprovalId}
              confirmingApprovalId={approvals.confirmingApprovalId}
              denyingApprovalId={approvals.denyingApprovalId}
              setDenyingApprovalId={approvals.setDenyingApprovalId}
              onCancelDeny={approvals.handleCancelDeny}
              isSplitView={isSplitView}
              onToggleSplitView={() => setIsSplitView(!isSplitView)}
              focusSource={navigation.focusSource}
              setFocusSource={navigation.setFocusSource}
              setConfirmingApprovalId={approvals.setConfirmingApprovalId}
              expandedToolResult={expandedToolResult}
              setExpandedToolResult={setExpandedToolResult}
              setExpandedToolCall={setExpandedToolCall}
              maxEventIndex={previewEventIndex ?? undefined}
              shouldIgnoreMouseEvent={shouldIgnoreMouseEvent}
              expandedTasks={expandedTasks}
              toggleTaskGroup={toggleTaskGroup}
            />
            {isActivelyProcessing &&
              (() => {
                // Fancy complex spinner
                const fancySpinner = (
                  <div className="relative w-10 h-10">
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

                // Simple minimal spinner
                const simpleSpinner = (
                  <div className="relative w-10 h-10">
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

                // Ultra minimal spinner
                const minimalSpinner = (
                  <div className="relative w-10 h-10">
                    {/* Three dots rotating */}
                    <div className="absolute inset-0 animate-spin">
                      <div className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary/60" />
                      <div className="absolute bottom-1 left-2 w-1.5 h-1.5 rounded-full bg-primary/40" />
                      <div className="absolute bottom-1 right-2 w-1.5 h-1.5 rounded-full bg-primary/40" />
                    </div>
                  </div>
                )

                // Bouncing bars spinner
                const barsSpinner = (
                  <div className="relative w-10 h-10 flex items-center justify-center gap-1">
                    {/* Five bouncing bars */}
                    <div className="w-1 h-6 bg-primary/40 rounded-full animate-bounce-slow" />
                    <div className="w-1 h-8 bg-primary/60 rounded-full animate-bounce-medium" />
                    <div className="w-1 h-5 bg-primary/80 rounded-full animate-bounce-fast" />
                    <div className="w-1 h-7 bg-primary/60 rounded-full animate-bounce-medium delay-150" />
                    <div className="w-1 h-4 bg-primary/40 rounded-full animate-bounce-slow delay-300" />
                  </div>
                )

                // Select spinner based on random type
                const spinner =
                  spinnerType === 0
                    ? fancySpinner
                    : spinnerType === 1
                      ? simpleSpinner
                      : spinnerType === 2
                        ? minimalSpinner
                        : barsSpinner

                return (
                  <div className="flex items-center gap-3 mt-4 pl-4">
                    {spinner}
                    <p className="text-sm font-medium text-muted-foreground opacity-80 animate-fade-pulse">
                      {randomVerb}
                    </p>
                  </div>
                )
              })()}

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
          </CardContent>
        </Card>

        {isWideView && lastTodo && (
          <Card className="w-[20%]">
            <CardContent>
              <TodoWidget event={lastTodo} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Response input - always show but disable for non-completed sessions */}
      <Card className={isCompactView ? 'py-2' : 'py-4'}>
        <CardContent className={isCompactView ? 'px-2' : 'px-4'}>
          <ResponseInput
            ref={responseInputRef}
            session={session}
            responseInput={actions.responseInput}
            setResponseInput={actions.setResponseInput}
            isResponding={actions.isResponding}
            handleContinueSession={actions.handleContinueSession}
            handleResponseInputKeyDown={actions.handleResponseInputKeyDown}
            isForkMode={actions.isForkMode}
            onOpenForkView={() => setForkViewOpen(true)}
          />
          <AutoAcceptIndicator enabled={autoAcceptEdits} className="mt-2" />
        </CardContent>
      </Card>

      {/* Tool Result Expansion Modal */}
      {expandedToolResult && (
        <ToolResultModal
          toolCall={expandedToolCall}
          toolResult={expandedToolResult}
          onClose={() => {
            setExpandedToolResult(null)
            setExpandedToolCall(null)
          }}
        />
      )}
    </section>
  )
}

// Export wrapped component
const SessionDetailWithErrorBoundary = (props: SessionDetailProps) => (
  <ErrorBoundary>
    <SessionDetail {...props} />
  </ErrorBoundary>
)

export default SessionDetailWithErrorBoundary
