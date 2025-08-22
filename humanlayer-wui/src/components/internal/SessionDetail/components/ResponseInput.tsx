import React, { forwardRef } from 'react'
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

interface ResponseInputProps {
  session: Session
  parentSessionData?: Partial<Session>
  responseInput: string
  setResponseInput: (input: string) => void
  isResponding: boolean
  handleContinueSession: () => void
  handleResponseInputKeyDown: (e: React.KeyboardEvent) => void
  isForkMode?: boolean
  onModelChange?: () => void
  onDirectoriesChange?: (directories: string[]) => void
}

export const ResponseInput = forwardRef<HTMLTextAreaElement, ResponseInputProps>(
  (
    {
      session,
      parentSessionData,
      responseInput,
      setResponseInput,
      isResponding,
      handleContinueSession,
      handleResponseInputKeyDown,
      isForkMode,
      onModelChange,
      onDirectoriesChange,
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
    // Always show the input for all session states
    return (
      <div className="space-y-3">
        {/* Status Bar */}
        <StatusBar
          session={session}
          parentSessionData={parentSessionData}
          onModelChange={onModelChange}
          onDirectoriesChange={onDirectoriesChange}
        />

        {/* Existing input area */}
        {isForkMode && <span className="text-sm font-medium">Fork from this message:</span>}
        <div className="flex gap-2">
          <Textarea
            ref={ref}
            placeholder={
              isForkMode ? getForkInputPlaceholder(session.status) : getInputPlaceholder(session.status)
            }
            value={responseInput}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setResponseInput(e.target.value)
              localStorage.setItem(`${ResponseInputLocalStorageKey}.${session.id}`, e.target.value)
            }}
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

        {/* Keyboard shortcuts (condensed) */}
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
