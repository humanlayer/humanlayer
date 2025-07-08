import React, { useState, useEffect, Component, ReactNode } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

import {
  ConversationEvent,
  ConversationEventType,
  SessionInfo,
  ApprovalStatus,
  SessionStatus,
} from '@/lib/daemon/types'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConversation } from '@/hooks/useConversation'
import { Skeleton } from '@/components/ui/skeleton'
import { useStore } from '@/AppStore'
import { ChevronDown } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { daemonClient } from '@/lib/daemon/client'
import { notificationService } from '@/services/NotificationService'
import { truncate } from '@/utils/formatting'

// Import extracted components
import { ConversationContent } from './views/ConversationContent'
import { ToolResultModal } from './components/ToolResultModal'
import { TodoWidget } from './components/TodoWidget'

// TODO(1): Consider moving these helper components to a separate file
// TODO(2): Extract session status utilities to shared utils

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

// Helper functions for session status text
const getSessionStatusText = (status: string): string => {
  if (status === 'completed') return 'Continue this conversation with a new message'
  if (status === 'running' || status === 'starting')
    return 'Claude is working - you can interrupt with a new message'
  return 'Session must be completed to continue'
}

const Kbd = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <kbd className={`px-1 py-0.5 bg-muted rounded ${className}`}>{children}</kbd>
)

const getSessionButtonText = (status: string): React.ReactNode => {
  if (status === 'running' || status === 'starting')
    return (
      <>
        Interrupt & Reply <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  if (status === 'completed')
    return (
      <>
        Continue Session <Kbd className="ml-2 text-xs">R</Kbd>
      </>
    )
  return 'Not Available'
}

const getInputPlaceholder = (status: string): string => {
  if (status === 'failed') return 'Session failed - cannot continue...'
  if (status === 'running' || status === 'starting') return 'Enter message to interrupt...'
  return 'Enter your message to continue the conversation...'
}

const getHelpText = (status: string): React.ReactNode => {
  if (status === 'failed') return 'Session failed - cannot continue'
  if (status === 'running' || status === 'starting') {
    return (
      <>
        <Kbd>Enter</Kbd> to interrupt and send, <Kbd className="ml-1">Escape</Kbd> to cancel
      </>
    )
  }
  return (
    <>
      <Kbd>Enter</Kbd> to send, <Kbd className="ml-1">Escape</Kbd> to cancel
    </>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [focusedEventId, setFocusedEventId] = useState<number | null>(null)
  const [isWideView, setIsWideView] = useState(false)
  const [isCompactView, setIsCompactView] = useState(false)
  const [showResponseInput, setShowResponseInput] = useState(false)
  const [expandedToolResult, setExpandedToolResult] = useState<ConversationEvent | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<ConversationEvent | null>(null)
  const [responseInput, setResponseInput] = useState('')
  const [isResponding, setIsResponding] = useState(false)
  const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
  const [confirmingApprovalId, setConfirmingApprovalId] = useState<string | null>(null)
  const [denyingApprovalId, setDenyingApprovalId] = useState<string | null>(null)
  const [focusSource, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)
  const [isSplitView, setIsSplitView] = useState(true)
  const interruptSession = useStore(state => state.interruptSession)
  const refreshSessions = useStore(state => state.refreshSessions)
  const navigate = useNavigate()
  const isRunning = session.status === 'running'

  // Get events for sidebar access
  const { events } = useConversation(session.id)

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

  // Approval handlers
  const handleApprove = async (approvalId: string) => {
    try {
      setApprovingApprovalId(approvalId)
      await daemonClient.approveFunctionCall(approvalId)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to approve')
    } finally {
      setApprovingApprovalId(null)
    }
  }

  const handleDeny = async (approvalId: string, reason: string) => {
    try {
      await daemonClient.denyFunctionCall(approvalId, reason)
      setDenyingApprovalId(null)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to deny')
    }
  }

  // Continue session functionality
  const handleContinueSession = async () => {
    if (!responseInput.trim() || isResponding) return

    try {
      setIsResponding(true)
      // Keep the message visible while sending
      const messageToSend = responseInput.trim()

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
      setShowResponseInput(false)
    } catch (error) {
      notificationService.notifyError(error, 'Failed to continue session')
      // On error, keep the message so user can retry
    } finally {
      setIsResponding(false)
    }
  }

  const handleResponseInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleContinueSession()
    } else if (e.key === 'Escape') {
      setShowResponseInput(false)
      setResponseInput('')
    }
  }

  // Navigate to parent session
  const handleNavigateToParent = () => {
    if (session.parent_session_id) {
      navigate(`/sessions/${session.parent_session_id}`)
    }
  }

  // Clear focus on escape, then close if nothing focused
  useHotkeys('escape', () => {
    if (confirmingApprovalId) {
      setConfirmingApprovalId(null)
    } else if (focusedEventId) {
      setFocusedEventId(null)
    } else {
      onClose()
    }
  })

  // Ctrl+X to interrupt session
  useHotkeys('ctrl+x', () => {
    if (session.status === 'running' || session.status === 'starting') {
      interruptSession(session.id)
    }
  })

  // R key to show response input (for completed, running, or starting sessions)
  useHotkeys('r', event => {
    if (session.status !== 'failed' && !showResponseInput) {
      event.preventDefault()
      setShowResponseInput(true)
    }
  })

  // P key to navigate to parent session
  useHotkeys('p', () => {
    if (session.parent_session_id) {
      handleNavigateToParent()
    }
  })

  // I key to expand tool result when focused on a tool call
  useHotkeys('i', () => {
    if (focusedEventId) {
      const focusedEvent = events.find(e => e.id === focusedEventId)
      if (focusedEvent?.event_type === ConversationEventType.ToolCall && focusedEvent.tool_id) {
        const toolResult = events.find(
          e =>
            e.event_type === ConversationEventType.ToolResult &&
            e.tool_result_for_id === focusedEvent.tool_id,
        )
        if (toolResult) {
          setExpandedToolResult(toolResult)
          setExpandedToolCall(focusedEvent)
        }
      }
    }
  })

  // A key to approve focused event that has pending approval
  useHotkeys('a', () => {
    // Find any pending approval event
    const pendingApprovalEvent = events.find(e => e.approval_status === 'pending' && e.approval_id)

    if (!pendingApprovalEvent) return

    // If no event is focused, or a different event is focused, focus this pending approval
    if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
      const container = document.querySelector('[data-conversation-container]')
      const element = container?.querySelector(`[data-event-id="${pendingApprovalEvent.id}"]`)
      let wasInView = true
      if (container && element) {
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        wasInView = elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
      }
      setFocusedEventId(pendingApprovalEvent.id)
      setFocusSource?.('keyboard')
      // Only set confirming state if element was out of view and we're scrolling to it
      if (!wasInView) {
        setConfirmingApprovalId(pendingApprovalEvent.approval_id!)
      }
      return
    }

    // If the pending approval is already focused
    if (focusedEventId === pendingApprovalEvent.id) {
      // If we're in confirming state, approve it
      if (confirmingApprovalId === pendingApprovalEvent.approval_id) {
        handleApprove(pendingApprovalEvent.approval_id!)
        setConfirmingApprovalId(null)
      } else {
        // If not in confirming state, approve directly
        handleApprove(pendingApprovalEvent.approval_id!)
      }
    }
  })

  // D key to deny focused event that has pending approval
  useHotkeys('d', e => {
    // Find any pending approval event
    const pendingApprovalEvent = events.find(e => e.approval_status === 'pending' && e.approval_id)

    if (!pendingApprovalEvent) return

    // Prevent the 'd' from being typed in any input that might get focused
    e.preventDefault()

    // If no event is focused, or a different event is focused, focus this pending approval
    if (!focusedEventId || focusedEventId !== pendingApprovalEvent.id) {
      setFocusedEventId(pendingApprovalEvent.id)
      setFocusSource?.('keyboard')
      return
    }

    // If the pending approval is already focused, show the deny form
    if (focusedEventId === pendingApprovalEvent.id) {
      setDenyingApprovalId(pendingApprovalEvent.approval_id!)
    }
  })

  // Check if there are pending approvals out of view when in waiting_input status
  useEffect(() => {
    if (session.status === SessionStatus.WaitingInput) {
      const pendingEvent = events.find(e => e.approval_status === ApprovalStatus.Pending)
      if (pendingEvent) {
        const container = document.querySelector('[data-conversation-container]')
        const element = container?.querySelector(`[data-event-id="${pendingEvent.id}"]`)
        if (container && element) {
          const elementRect = element.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          const inView =
            elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom
          setHasPendingApprovalsOutOfView(!inView)
        }
      } else {
        setHasPendingApprovalsOutOfView(false)
      }
    } else {
      setHasPendingApprovalsOutOfView(false)
    }
  }, [session.status, events])

  return (
    <section className={`flex flex-col h-full ${isCompactView ? 'gap-2' : 'gap-4'}`}>
      {!isCompactView && (
        <hgroup className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground font-mono">
            {session.summary || truncate(session.query, 50)}{' '}
            {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
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
      )}
      {isCompactView && (
        <hgroup className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium text-foreground font-mono">
            {session.summary || truncate(session.query, 50)}{' '}
            {session.parent_session_id && <span className="text-muted-foreground">[continued]</span>}
          </h2>
          <small
            className={`font-mono text-xs uppercase tracking-wider ${getStatusTextClass(session.status)}`}
          >
            {`${session.status}${session.model ? ` / ${session.model}` : ''}`}
          </small>
        </hgroup>
      )}
      <div className={`flex flex-1 gap-4 ${isWideView ? 'flex-row' : 'flex-col'} min-h-0`}>
        {/* Conversation content and Loading */}
        <Card
          className={`${isWideView ? 'flex-1' : 'w-full'} relative ${isCompactView ? 'py-2' : 'py-4'} flex flex-col min-h-0`}
        >
          <CardContent className={`${isCompactView ? 'px-2' : 'px-4'} flex flex-col flex-1 min-h-0`}>
            <ConversationContent
              sessionId={session.id}
              focusedEventId={focusedEventId}
              setFocusedEventId={setFocusedEventId}
              onApprove={handleApprove}
              onDeny={handleDeny}
              approvingApprovalId={approvingApprovalId}
              confirmingApprovalId={confirmingApprovalId}
              denyingApprovalId={denyingApprovalId}
              setDenyingApprovalId={setDenyingApprovalId}
              onCancelDeny={() => setDenyingApprovalId(null)}
              isSplitView={isSplitView}
              onToggleSplitView={() => setIsSplitView(!isSplitView)}
              focusSource={focusSource}
              setFocusSource={setFocusSource}
              setConfirmingApprovalId={setConfirmingApprovalId}
              expandedToolResult={expandedToolResult}
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
          {!showResponseInput ? (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm text-muted-foreground">
                {getSessionStatusText(session.status)}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowResponseInput(true)}
                disabled={session.status === 'failed'}
              >
                {getSessionButtonText(session.status)}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Continue conversation:</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder={getInputPlaceholder(session.status)}
                  value={responseInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setResponseInput(e.target.value)
                  }
                  onKeyDown={handleResponseInputKeyDown}
                  autoFocus
                  disabled={isResponding || session.status === 'failed'}
                  className={`flex-1 ${isResponding ? 'opacity-50' : ''}`}
                />
                <Button
                  onClick={handleContinueSession}
                  disabled={!responseInput.trim() || isResponding || session.status === 'failed'}
                  size="sm"
                >
                  {isResponding ? 'Interrupting...' : 'Send'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {isResponding
                  ? 'Waiting for Claude to accept the interrupt...'
                  : getHelpText(session.status)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tool Result Expansion Modal */}
      <ToolResultModal
        toolCall={expandedToolCall}
        toolResult={expandedToolResult}
        onClose={() => {
          setExpandedToolResult(null)
          setExpandedToolCall(null)
        }}
      />
    </section>
  )
}

// Simple error boundary component
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SessionDetail Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 space-y-4">
          <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            variant="outline"
          >
            Reload
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

// Export wrapped component
const SessionDetailWithErrorBoundary = (props: SessionDetailProps) => (
  <ErrorBoundary>
    <SessionDetail {...props} />
  </ErrorBoundary>
)

export default SessionDetailWithErrorBoundary
