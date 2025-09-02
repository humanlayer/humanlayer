import { forwardRef, useEffect, useState, useRef, useImperativeHandle } from 'react'
import { Button } from '@/components/ui/button'
import { Session, SessionStatus } from '@/lib/daemon/types'
import {
  getInputPlaceholder,
  getHelpText,
  getForkInputPlaceholder,
} from '@/components/internal/SessionDetail/utils/sessionStatus'
import { ResponseInputLocalStorageKey } from '@/components/internal/SessionDetail/hooks/useSessionActions'
import { StatusBar } from './StatusBar'
import { useHotkeys } from 'react-hotkeys-hook'
import { ResponseEditor } from './ResponseEditor'
import { ResponseEditorErrorBoundary } from './ResponseEditorErrorBoundary'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { Content } from '@tiptap/react'

interface ResponseInputProps {
  session: Session
  parentSessionData?: Partial<Session>
  isResponding: boolean
  handleContinueSession: () => void
  isForkMode?: boolean
  forkTokenCount?: number | null
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
      onModelChange,
      sessionStatus,
      onToggleAutoAccept,
      onToggleDangerouslySkipPermissions,
      onToggleForkView,
    },
    ref,
  ) => {
    const [youSure, setYouSure] = useState(false)
    const [isFocused, setIsFocused] = useState(false)
    const responseEditor = useStore(state => state.responseEditor)
    const localStorageValue = localStorage.getItem(`${ResponseInputLocalStorageKey}.${session.id}`)

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

    if (session.status === SessionStatus.Failed && !isForkMode) {
      return (
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">Session failed</span>
        </div>
      )
    }

    useEffect(() => {
      if (isDenying && ref && typeof ref !== 'function' && ref.current) {
        ref.current.focus()
      } else {
        if (ref && typeof ref !== 'function' && ref.current && ref.current.blur) {
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

    const isDisabled = responseEditor?.isEmpty || isResponding
    const isMac = navigator.platform.includes('Mac')
    const sendKey = isMac ? '⌘+Enter' : 'Ctrl+Enter'

    let placeholder = getInputPlaceholder(session.status)

    let borderColorClass = isFocused ? 'border-[var(--terminal-accent)]' : 'border-transparent'

    if (isDenying) {
      placeholder = "Tell the agent what you'd like to do differently..."
      if (isFocused) {
        borderColorClass = 'border-[var(--terminal-error)]'
      }
    }

    if (isForkMode) {
      placeholder = getForkInputPlaceholder(session.status)
    }

    const textareaOutlineClass =
      isDenying &&
      ' focus:outline-[var(--terminal-error)] focus-visible:outline-[var(--terminal-error)] focus-visible:border-[var(--terminal-error)]'

    // Always show the input for all session states
    return (
      <div className={`transition-colors border-l-2 pl-2 pr-2 ${borderColorClass}`}>
        <div className="space-y-2">
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
          <div className="flex gap-2">
            <ResponseEditorErrorBoundary>
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
            </ResponseEditorErrorBoundary>
          </div>

          {/* Keyboard shortcuts (condensed) */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {isResponding
                ? 'Waiting for Claude to accept the interrupt...'
                : getHelpText(session.status)}
            </p>

            <Button
              onClick={handleSubmit}
              disabled={isDisabled}
              variant={isDenying ? 'destructive' : 'default'}
              className="h-auto py-0.5 px-2 text-xs"
            >
              {getSendButtonText()}
              <kbd
                className={`ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded ${isDisabled ? 'invisible' : ''}`}
              >
                {sendKey}
              </kbd>
            </Button>
          </div>
        </div>
      </div>
    )
  },
)

ResponseInput.displayName = 'ResponseInput'
