import { forwardRef, useEffect, useState, useRef, useImperativeHandle } from 'react'
import { Button } from '@/components/ui/button'
import { Session, SessionStatus } from '@/lib/daemon/types'
import { Split, MessageCircleX, AlertCircle } from 'lucide-react'
import { ActionButtons } from './ActionButtons'
import { toast } from 'sonner'
import {
  getInputPlaceholder,
  getHelpText,
  getForkInputPlaceholder,
} from '@/components/internal/SessionDetail/utils/sessionStatus'
import { ResponseInputLocalStorageKey } from '@/components/internal/SessionDetail/hooks/useSessionActions'
import { StatusBar } from './StatusBar'
import { useHotkeys } from 'react-hotkeys-hook'
import { ResponseEditor } from './ResponseEditor'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { Content } from '@tiptap/react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { Card, CardContent } from '@/components/ui/card'

interface ResponseInputProps {
  session: Session
  parentSessionData?: Partial<Session>
  isResponding: boolean
  handleContinueSession: () => void
  isForkMode?: boolean
  forkTokenCount?: number | null
  forkTurnNumber?: number
  onModelChange?: () => void
  denyingApprovalId?: string | null
  isDenying?: boolean
  onDeny?: (approvalId: string, reason: string, sessionId: string) => void
  handleCancelDeny?: () => void
  sessionStatus: SessionStatus
  denyAgainstOldestApproval: () => void
  onToggleAutoAccept?: () => void
  onToggleDangerouslySkipPermissions?: () => void
  onToggleForkView?: () => void
  // Props for ActionButtons
  canFork?: boolean
  bypassEnabled?: boolean
  autoAcceptEnabled?: boolean
  isArchived?: boolean
  onToggleArchive?: () => void
  previewEventIndex?: number | null
  isActivelyProcessing?: boolean
  isDraft?: boolean
  onLaunchDraft?: () => void
  onDiscardDraft?: () => void
  isLaunchingDraft?: boolean
}

export const ResponseInput = forwardRef<{ focus: () => void; blur?: () => void }, ResponseInputProps>(
  (
    {
      denyingApprovalId,
      isDenying,
      onDeny,
      handleCancelDeny,
      denyAgainstOldestApproval,

      session,
      parentSessionData,
      isResponding,
      handleContinueSession,
      isForkMode,
      forkTokenCount,
      forkTurnNumber,
      onModelChange,
      sessionStatus,
      onToggleAutoAccept,
      onToggleDangerouslySkipPermissions,
      onToggleForkView,
      // ActionButtons props
      canFork = false,
      bypassEnabled = false,
      autoAcceptEnabled = false,
      isArchived = false,
      onToggleArchive,
      isDraft = false,
      onLaunchDraft,
      onDiscardDraft,
      isLaunchingDraft = false,
    },
    ref,
  ) => {
    const [youSure, setYouSure] = useState(false)
    const [isFocused, setIsFocused] = useState(false)
    const [isDragHover, setIsDragHover] = useState(false)
    const [debouncedCanInterrupt, setDebouncedCanInterrupt] = useState(false)
    const responseEditor = useStore(state => state.responseEditor)
    const localStorageValue = localStorage.getItem(`${ResponseInputLocalStorageKey}.${session.id}`)

    const tiptapRef = useRef<{ focus: () => void }>(null)

    // Debounce the claudeSessionId to prevent brief interrupt button flashes
    useEffect(() => {
      let timeout: ReturnType<typeof setTimeout>
      const hasClaudeSessionId = session.claudeSessionId !== undefined

      if (hasClaudeSessionId) {
        // Delay showing interrupt capability by 500ms
        timeout = setTimeout(() => {
          setDebouncedCanInterrupt(true)
        }, 500)
      } else {
        // Immediately remove interrupt capability when claudeSessionId is gone
        setDebouncedCanInterrupt(false)
      }

      return () => clearTimeout(timeout)
    }, [session.claudeSessionId])
    const getSendButtonText = () => {
      if (isDraft) return isLaunchingDraft ? 'Launching...' : 'Launch'
      if (isResponding) return 'Interrupting...'
      if (isDenying) return youSure ? 'Deny?' : 'Deny'

      const isRunning =
        session.status === SessionStatus.Running || session.status === SessionStatus.Starting
      const hasText = responseEditor && !responseEditor.isEmpty
      const canInterrupt = debouncedCanInterrupt // Use debounced value

      if (session.archived && isRunning) {
        return 'Interrupt & Unarchive'
      }
      if (session.archived) return 'Send & Unarchive'

      // When running and no text, show just "Interrupt" or disabled state
      if (isRunning && !hasText) {
        if (!canInterrupt) return 'Waiting...'
        return 'Interrupt'
      }
      // When running with text, show "Interrupt & Send" or disabled state
      if (isRunning && hasText) {
        return canInterrupt ? 'Interrupt & Send' : 'Waiting...'
      }

      return 'Send'
    }

    let initialValue = null

    if (
      initialValue === null &&
      typeof localStorageValue === 'string' &&
      localStorageValue.length > 0
    ) {
      try {
        initialValue = JSON.parse(localStorageValue)
      } catch (e) {
        logger.error('ResponseInput.useEffect() - error parsing localStorageValue', e)
      }
    }

    const handleSubmit = () => {
      logger.log('ResponseInput.handleSubmit()')

      // Handle draft launch
      if (isDraft) {
        onLaunchDraft?.()
        return
      }

      // Check if this is an interruption attempt without claudeSessionId
      const isRunning =
        session.status === SessionStatus.Running || session.status === SessionStatus.Starting
      const hasText = responseEditor && !responseEditor.isEmpty

      // Early return if no text in editor
      if (!hasText) {
        return
      }

      // Protection for "Interrupt & Send" scenario when text is present
      if (isRunning && !debouncedCanInterrupt) {
        toast.warning('Session cannot be interrupted yet', {
          description: 'Waiting for Claude to initialize the session. Please try again in a moment.',
        })
        return
      }

      if (isDenying && denyingApprovalId && !isForkMode) {
        onDeny?.(denyingApprovalId, responseEditor?.getText().trim() || '', session.id)
      } else if (sessionStatus === SessionStatus.WaitingInput && !isForkMode) {
        // Alternate situation: If we haven't triggered the denying state by clicking/keyboarding through, it's possible we're potentially attempting to submit when we actually need to be providing an approval. In these cases we need to enter a denying state relative to the oldest approval.
        denyAgainstOldestApproval()
        setYouSure(true)
      } else {
        handleContinueSession()
      }
      // Regular help text
      return getHelpText(session.status)
    }

    // Forward ref handling for both textarea and TipTap editor
    useImperativeHandle(ref, () => {
      return tiptapRef.current!
    }, [])

    useEffect(() => {
      if (isDenying && ref && typeof ref !== 'function' && ref.current) {
        ref.current.focus()
      } else {
        if (ref && typeof ref !== 'function' && ref.current && ref.current.blur) {
          ref.current.blur()
        }
      }
    }, [isDenying, ref])

    useEffect(() => {
      let unlisten: UnlistenFn | undefined
      let mounted = true
      let isSettingUp = true

      ;(async () => {
        try {
          const unlistenFn = await getCurrentWebview().onDragDropEvent(event => {
            if (!mounted) {
              return
            }

            if (event.payload.type === 'over') {
              setIsDragHover(true)
            } else if (event.payload.type === 'drop') {
              // Insert dropped files as mentions
              const filePaths = event.payload.paths as string[]
              if (responseEditor && filePaths.length > 0) {
                // Check editor health before proceeding
                if (responseEditor.isDestroyed) {
                  return
                }

                if (!(responseEditor as any).editorView) {
                  return
                }

                // Build content array with mentions
                const content: any[] = []

                filePaths.forEach((filePath, index) => {
                  const fileName = filePath.split('/').pop() || filePath

                  // Add space before mention if not first file
                  if (index > 0) {
                    content.push({ type: 'text', text: ' ' })
                  }

                  // Add the mention
                  content.push({
                    type: 'mention',
                    attrs: {
                      id: filePath, // Full path for functionality
                      label: fileName, // Display name for UI
                    },
                  })
                })

                // Add a space after all mentions
                content.push({ type: 'text', text: ' ' })

                // Insert all mentions at once
                responseEditor.chain().focus().insertContent(content).run()
              }

              setIsDragHover(false)
            } else {
              setIsDragHover(false)
            }
          })

          // Store the unlisten function if component is still mounted
          if (mounted && isSettingUp) {
            unlisten = unlistenFn
          } else {
            // Component unmounted during async setup, clean up immediately
            unlistenFn()
          }
        } finally {
          isSettingUp = false
        }
      })()

      return () => {
        mounted = false
        isSettingUp = false
        if (unlisten) {
          // Defensive try-catch for Tauri v2 race condition (ENG-2189)
          // The unlisten function may fail if the listener wasn't fully registered
          try {
            unlisten()
          } catch (error) {
            console.warn('[ResponseInput] Error during drag-drop unlisten (non-critical):', error)
          }
        }
      }
    }, [responseEditor])

    useHotkeys(
      'escape',
      () => {
        if (isDenying) {
          handleCancelDeny?.()
          setYouSure(false)
        }
      },
      { enableOnFormTags: true },
    )

    const isRunning =
      session.status === SessionStatus.Running || session.status === SessionStatus.Starting
    const hasText = responseEditor && !responseEditor.isEmpty
    const canInterrupt = debouncedCanInterrupt // Use debounced value

    // Disable when: responding OR (running without ability to interrupt) OR (not running and no text) OR launching draft
    const isDisabled =
      isResponding || (isRunning && !canInterrupt) || (!isRunning && !hasText) || isLaunchingDraft

    const isMac = navigator.platform.includes('Mac')
    // Show different keyboard shortcut based on state
    const sendKey = isRunning && !hasText ? 'Ctrl+X' : isMac ? '⌘+Enter' : 'Ctrl+Enter'

    // Determine submit button variant based on state
    let submitButtonVariant: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' =
      'default'
    if (isDraft) {
      submitButtonVariant = 'default'
    } else if (isDenying) {
      submitButtonVariant = 'destructive'
    } else if (isRunning && !hasText && canInterrupt) {
      submitButtonVariant = 'destructive'
    }

    let outerBorderColorClass = ''

    let placeholder = getInputPlaceholder(session.status)

    let borderColorClass = isFocused ? 'border-[var(--terminal-accent)]' : 'border-transparent'

    if (isDragHover) {
      borderColorClass = 'border-[var(--terminal-accent)]'
    } else if (isDenying) {
      placeholder = "Tell the agent what you'd like to do differently..."
      if (isFocused) {
        borderColorClass = 'border-[var(--terminal-error)]'
      }
    }

    if (isForkMode) {
      placeholder = getForkInputPlaceholder(session.status)
    }

    if (isDragHover) {
      outerBorderColorClass = 'border-[var(--terminal-accent)]'
    }

    const textareaOutlineClass =
      isDenying &&
      ' focus:outline-[var(--terminal-error)] focus-visible:outline-[var(--terminal-error)] focus-visible:border-[var(--terminal-error)]'

    // Get status override based on current state
    const getStatusOverride = () => {
      if (isDragHover) {
        return { text: 'DRAGGING FILE, RELEASE TO INCLUDE', className: 'text-primary' }
      }

      if (isDenying) {
        return {
          text: 'DENYING',
          className: 'text-destructive',
          icon: <MessageCircleX className="h-3 w-3" />,
        }
      }

      if (isForkMode) {
        return {
          text: (
            <>
              {forkTurnNumber !== undefined ? `FORK MODE: TURN ${forkTurnNumber}` : 'FORK MODE'}
              {' ('}
              <kbd className="px-1 py-0.5 text-xs font-mono font-medium border border-current/30 rounded">
                Esc
              </kbd>
              {' to cancel)'}
            </>
          ),
          className: 'text-[var(--terminal-accent)]',
          icon: <Split className="h-3 w-3" />,
        }
      }

      if (session.status === SessionStatus.Failed && !isForkMode) {
        return {
          text: 'FAILED',
          className: 'text-destructive',
          icon: <AlertCircle className="h-3 w-3" />,
        }
      }

      return undefined
    }

    // Always show the input for all session states
    return (
      <Card className={`py-2 ${outerBorderColorClass}`}>
        <CardContent className="px-2">
          <div className={`transition-colors border-l-2 pl-2 pr-2 ${borderColorClass}`}>
            <div className="space-y-2 flex flex-col">
              {/* Error message for failed sessions */}
              {session.status === SessionStatus.Failed && session.errorMessage && (
                <div className="flex flex-col w-full mb-4">
                  <div
                    className="text-sm text-destructive rounded-md p-2 mb-2 ml-auto flex items-center justify-end"
                    style={{ width: 'fit-content' }}
                  >
                    <AlertCircle className="h-3 w-3 mr-2 my-auto" />
                    {session.errorMessage}
                  </div>
                  <hr className="w-full border-border" />
                </div>
              )}
              {/* Status Bar with Action Buttons */}
              <div className="flex items-center justify-between gap-2">
                <StatusBar
                  session={session}
                  effectiveContextTokens={
                    isForkMode && forkTokenCount !== null && forkTokenCount !== undefined
                      ? forkTokenCount
                      : (session.effectiveContextTokens ?? parentSessionData?.effectiveContextTokens)
                  }
                  contextLimit={session.contextLimit ?? parentSessionData?.contextLimit}
                  model={session.model ?? parentSessionData?.model}
                  onModelChange={onModelChange}
                  statusOverride={getStatusOverride()}
                />
                <ActionButtons
                  sessionId={session.id}
                  canFork={canFork}
                  bypassEnabled={bypassEnabled}
                  autoAcceptEnabled={autoAcceptEnabled}
                  sessionStatus={sessionStatus}
                  isArchived={isArchived || false}
                  onToggleFork={onToggleForkView || (() => {})}
                  onToggleBypass={onToggleDangerouslySkipPermissions || (() => {})}
                  onToggleAutoAccept={onToggleAutoAccept || (() => {})}
                  onToggleArchive={onToggleArchive || (() => {})}
                />
              </div>

              {/* Existing input area */}
              <div className="flex gap-2">
                <SentryErrorBoundary
                  variant="response-editor"
                  componentName="ResponseEditor"
                  handleRefresh={() => {
                    // Clear URL params and reload to recover the editor
                    window.location.href = `/#/sessions/${session.id}`
                  }}
                  refreshButtonText="Reload Session"
                >
                  <ResponseEditor
                    ref={tiptapRef}
                    initialValue={initialValue}
                    onChange={(value: Content) => {
                      localStorage.setItem(
                        `${ResponseInputLocalStorageKey}.${session.id}`,
                        JSON.stringify(value),
                      )
                    }}
                    onSubmit={handleSubmit}
                    onToggleAutoAccept={onToggleAutoAccept}
                    onToggleDangerouslySkipPermissions={onToggleDangerouslySkipPermissions}
                    onToggleForkView={onToggleForkView}
                    disabled={isResponding}
                    placeholder={placeholder}
                    className={`flex-1 min-h-[2.5rem] ${isResponding ? 'opacity-50' : ''} ${textareaOutlineClass} ${
                      isDenying && isFocused ? 'caret-error' : isFocused ? 'caret-accent' : ''
                    }`}
                    onFocus={() => {
                      setIsFocused(true)
                    }}
                    onBlur={() => {
                      setIsFocused(false)
                    }}
                  />
                </SentryErrorBoundary>
              </div>

              {/* Keyboard shortcuts (condensed) */}
              <div className="flex items-center justify-end gap-2">
                {isDraft && (
                  <Button
                    onClick={onDiscardDraft}
                    disabled={isResponding}
                    variant="outline"
                    className="h-auto py-0.5 px-2 text-xs transition-all duration-200"
                  >
                    {/* {responseEditor && !responseEditor.isEmpty ? 'Discard' : 'Cancel'} Until we've implemented change detection we'll always discard */}
                    {'Discard'}
                  </Button>
                )}
                <Button
                  onClick={handleSubmit}
                  disabled={isDisabled}
                  variant={submitButtonVariant}
                  className="h-auto py-0.5 px-2 text-xs transition-all duration-200"
                >
                  {getSendButtonText()}
                  {!isDisabled && (
                    <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">{sendKey}</kbd>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  },
)

ResponseInput.displayName = 'ResponseInput'
