import React, { forwardRef, useCallback, useEffect, useState, useRef, useImperativeHandle } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Session, SessionStatus } from '@/lib/daemon/types'
import {
  getInputPlaceholder,
  getHelpText,
  getForkInputPlaceholder,
} from '@/components/internal/SessionDetail/utils/sessionStatus'
import { ResponseInputLocalStorageKey } from '@/components/internal/SessionDetail/hooks/useSessionActions'
import { StatusBar } from './StatusBar'
import { useHotkeys } from 'react-hotkeys-hook'
import { TiptapEditor } from './TiptapEditor'
import { useStore } from '@/AppStore'

interface ResponseInputProps {
  session: Session
  parentSessionData?: Partial<Session>
  responseInput: string
  setResponseInput: (input: string) => void
  isResponding: boolean
  handleContinueSession: () => void
  handleResponseInputKeyDown: (e: React.KeyboardEvent) => void
  isForkMode?: boolean
  forkTokenCount?: number | null
  onModelChange?: () => void
  denyingApprovalId?: string | null
  isDenying?: boolean
  onDeny?: (approvalId: string, reason: string) => void
  handleCancelDeny?: () => void
  sessionStatus: SessionStatus
  denyAgainstOldestApproval: () => void
}

export const ResponseInput = forwardRef<HTMLTextAreaElement, ResponseInputProps>(
  (
    {
      denyingApprovalId,
      isDenying,
      onDeny,
      handleCancelDeny,
      denyAgainstOldestApproval,

      session,
      parentSessionData,
      responseInput,
      setResponseInput,
      isResponding,
      handleContinueSession,
      isForkMode,
      forkTokenCount,
      onModelChange,
      sessionStatus,
    },
    ref,
  ) => {
    const [youSure, setYouSure] = useState(false)

    const tiptapRef = useRef<{ focus: () => void }>(null)
    const getSendButtonText = () => {
      if (isResponding) return 'Interrupting...'
      if (isDenying) return youSure ? 'Deny?' : 'Deny'
      if (
        session.archived &&
        (session.status === SessionStatus.Running || session.status === SessionStatus.Starting)
      ) {
        return 'Interrupt & Unarchive'
      }
      if (session.archived) return 'Send & Unarchive'
      if (session.status === SessionStatus.Running || session.status === SessionStatus.Starting)
        return 'Interrupt & Send'
      return 'Send'
    }

    const handleSubmit = () => {
      if (isDenying && denyingApprovalId) {
        onDeny?.(denyingApprovalId, responseInput.trim())
      } else if (sessionStatus === SessionStatus.WaitingInput) {
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

    if (session.status === SessionStatus.Failed && !isForkMode) {
      return (
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">{getSessionStatusText(session.status)}</span>
          {onOpenForkView && (
            <Button variant="ghost" size="sm" onClick={onOpenForkView} className="h-8 gap-2">
              <GitBranch className="h-4 w-4" />
              Fork from previous
            </Button>
          )}
        </div>
      )
    }

    const handleResponseInputKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          handleSubmit()
        }
      },
      [handleContinueSession, handleSubmit],
    )

    useEffect(() => {
      if (isDenying && ref && typeof ref !== 'function' && ref.current) {
        ref.current.focus()
      } else {
        if (ref && typeof ref !== 'function' && ref.current) {
          ref.current.blur()
        }
      }
    }, [isDenying])

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

    const isDisabled = !responseInput.trim() || isResponding
    const isMac = navigator.platform.includes('Mac')
    const sendKey = isMac ? '⌘+Enter' : 'Ctrl+Enter'

    let placeholder = getInputPlaceholder(session.status)

    if (isDenying) {
      placeholder = "Tell the agent what you'd like to do differently..."
    }

    if (isForkMode) {
      placeholder = getForkInputPlaceholder(session.status)
    }

    const textareaOutlineClass =
      isDenying &&
      ' focus:outline-[var(--terminal-error)] focus-visible:outline-[var(--terminal-error)] focus-visible:border-[var(--terminal-error)]'

    // This is a hack, was struggling to find the style associated with
    // the inserted box shadow from tailwind, there's a goofy ring-offset thing going on
    const textareaStyle = isDenying
      ? {
          boxShadow: 'var(--terminal-error)',
        }
      : {}

    // Always show the input for all session states
    return (
      <div className="space-y-3">
        {/* Status Bar */}
        <StatusBar
          session={session}
          parentSessionData={parentSessionData}
          isForkMode={isForkMode}
          forkTokenCount={forkTokenCount}
          onModelChange={onModelChange}
          isDenying={isDenying}
        />

        {/* Existing input area */}
        {isForkMode && <span className="text-sm font-medium">Fork from this message:</span>}
        <div className="flex gap-2">
          {/* <Textarea
            style={textareaStyle}
            ref={ref}
            placeholder={placeholder}
            value={responseInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setResponseInput(e.target.value)
              localStorage.setItem(`${ResponseInputLocalStorageKey}.${session.id}`, e.target.value)
            }}
            onKeyDown={handleResponseInputKeyDown}
            disabled={isResponding}
            className={`flex-1 min-h-[2.5rem] ${isResponding ? 'opacity-50' : ''} ${textareaOutlineClass}`}
          /> */}
          <TiptapEditor
            ref={tiptapRef}
            value={responseInput}
            onChange={(value: string) => {
              setResponseInput(value)
              localStorage.setItem(`${ResponseInputLocalStorageKey}.${session.id}`, value)
            }}
            onKeyDown={handleResponseInputKeyDown}
            disabled={isResponding}
            placeholder={placeholder}
            className={`flex-1 min-h-[2.5rem] ${isResponding ? 'opacity-50' : ''} ${textareaOutlineClass}`}
          />
          <Button
            onClick={handleSubmit}
            disabled={isDisabled}
            size="sm"
            variant={isDenying ? 'destructive' : 'default'}
          >
            {getSendButtonText()}
            {!isDisabled && (
              <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">{sendKey}</kbd>
            )}
          </Button>
        </div>

        {/* Keyboard shortcuts (condensed) */}
        <p className="text-xs text-muted-foreground">
          {isResponding ? 'Waiting for Claude to accept the interrupt...' : getHelpText(session.status)}
        </p>
      </div>
    )
  },
)

ResponseInput.displayName = 'ResponseInput'
