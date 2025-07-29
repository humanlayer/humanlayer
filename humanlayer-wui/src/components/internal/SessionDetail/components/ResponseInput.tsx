import React, { forwardRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Session, SessionStatus } from '@/lib/daemon/types'
import {
  getSessionStatusText,
  getInputPlaceholder,
  getHelpText,
  getForkInputPlaceholder,
} from '../utils/sessionStatus'
import { GitBranch } from 'lucide-react'

interface ResponseInputProps {
  session: Session
  responseInput: string
  setResponseInput: (input: string) => void
  isResponding: boolean
  handleContinueSession: () => void
  handleResponseInputKeyDown: (e: React.KeyboardEvent) => void
  isForkMode?: boolean
  onOpenForkView?: () => void
}

export const ResponseInput = forwardRef<HTMLTextAreaElement, ResponseInputProps>(
  (
    {
      session,
      responseInput,
      setResponseInput,
      isResponding,
      handleContinueSession,
      handleResponseInputKeyDown,
      isForkMode,
      onOpenForkView,
    },
    ref,
  ) => {
    const getSendButtonText = () => {
      if (isResponding) return 'Interrupting...'
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

    // Get help text for fork mode
    const getForkHelpText = (isFork: boolean): React.ReactNode => {
      if (isFork) {
        return (
          <>
            <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">Cmd+Enter</kbd> to fork,{' '}
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Enter</kbd> for new line,{' '}
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Escape</kbd> to cancel fork
          </>
        )
      }
      // Regular help text
      return getHelpText(session.status)
    }
    // Only show the simple status text if session is failed AND not in fork mode
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

    // Otherwise always show the input
    return (
      <div className="space-y-2">
        {isForkMode && <span className="text-sm font-medium">Fork from this message:</span>}
        <div className="flex gap-2">
          <Textarea
            ref={ref}
            placeholder={
              isForkMode ? getForkInputPlaceholder(session.status) : getInputPlaceholder(session.status)
            }
            value={responseInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setResponseInput(e.target.value)}
            onKeyDown={handleResponseInputKeyDown}
            disabled={isResponding}
            className={`flex-1 min-h-[2.5rem] ${isResponding ? 'opacity-50' : ''}`}
          />
          <Button
            onClick={handleContinueSession}
            disabled={!responseInput.trim() || isResponding}
            size="sm"
          >
            {getSendButtonText()}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {isResponding
            ? 'Waiting for Claude to accept the interrupt...'
            : getForkHelpText(isForkMode || false)}
        </p>
      </div>
    )
  },
)

ResponseInput.displayName = 'ResponseInput'
