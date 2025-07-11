import { useState, useEffect, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { ConversationEvent, SessionInfo, ApprovalStatus, SessionStatus } from '@/lib/daemon/types'
import { Card, CardContent } from '@/components/ui/card'
import { useConversation } from '@/hooks/useConversation'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, Archive } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { truncate } from '@/utils/formatting'
import { daemonClient } from '@/lib/daemon/client'
import { useStore } from '@/AppStore'

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
import { useStealHotkeyScope } from '@/hooks/useStealHotkeyScope'

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

const SessionDetailHotkeysScope = 'session-detail'

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [isWideView, setIsWideView] = useState(false)
  const [isCompactView, setIsCompactView] = useState(false)
  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [isSplitView, setIsSplitView] = useState(false)
  const [forkViewOpen, setForkViewOpen] = useState(false)
  const [previewEventIndex, setPreviewEventIndex] = useState<number | null>(null)
  const [pendingForkMessage, setPendingForkMessage] = useState<ConversationEvent | null>(null)

  const isRunning = session.status === 'running'

  // Get session from store to access auto_accept_edits
  const sessionFromStore = useStore(state => state.sessions.find(s => s.id === session.id))
  const autoAcceptEdits = sessionFromStore?.auto_accept_edits ?? false

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
  })

  // Use approvals hook
  const approvals = useSessionApprovals({
    sessionId: session.id,
    events,
    focusedEventId: navigation.focusedEventId,
    setFocusedEventId: navigation.setFocusedEventId,
    setFocusSource: navigation.setFocusSource,
  })

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
    onForkCommit: handleForkCommit
  })

  // Add fork selection handler
  const handleForkSelect = useCallback((eventIndex: number | null) => {
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
      setPendingForkMessage(selectedEvent)
    }
  }, [events, actions])

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

      if (approvals.confirmingApprovalId) {
        approvals.setConfirmingApprovalId(null)
      } else if (navigation.expandedEventId) {
        navigation.setExpandedEventId(null)
      } else if (navigation.focusedEventId) {
        navigation.setFocusedEventId(null)
      } else {
        onClose()
      }
    },
    { scopes: SessionDetailHotkeysScope },
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

  // Add hotkey to open fork view (Meta+Y)
  useHotkeys('meta+y', (e) => {
    e.preventDefault()
    setForkViewOpen(!forkViewOpen)
  }, { scopes: [SessionDetailHotkeysScope] })

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
              <span>
                {session.summary || truncate(session.query, 50)}{' '}
                {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
              </span>
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
          />
        </div>
      )}
      {isCompactView && (
        <div className="flex items-start justify-between">
          <hgroup className="flex flex-col gap-0.5 flex-1">
            <h2 className="text-sm font-medium text-foreground font-mono flex items-center gap-2">
              {session.archived && <Archive className="h-3 w-3 text-muted-foreground" />}
              <span>
                {session.summary || truncate(session.query, 50)}{' '}
                {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
              </span>
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
          />
        </div>
      )}
      
      {/* Fork Mode Indicator */}
      {previewEventIndex !== null && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 mb-4 text-sm">
          <span className="text-amber-600 dark:text-amber-400">
            Fork mode: Forking conversation from message {
              events.slice(0, previewEventIndex + 1).filter(e => 
                e.event_type === 'message' && e.role === 'user'
              ).length
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
              maxEventIndex={previewEventIndex ?? undefined}
            />
            {isRunning && (
              <div className="flex flex-col gap-1 mt-2 border-t pt-2">
                <h2 className="text-sm font-medium text-muted-foreground">robot magic is happening</h2>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-4 w-1/5" />
                </div>
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
            session={session}
            responseInput={actions.responseInput}
            setResponseInput={actions.setResponseInput}
            isResponding={actions.isResponding}
            handleContinueSession={actions.handleContinueSession}
            handleResponseInputKeyDown={actions.handleResponseInputKeyDown}
            isForkMode={actions.isForkMode}
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
