import React from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SessionInfo, SessionStatus } from '@/lib/daemon/types'
import { getSessionStatusText, getInputPlaceholder, getHelpText } from '../utils/sessionStatus'

interface ResponseInputProps {
  session: SessionInfo
  responseInput: string
  setResponseInput: (input: string) => void
  isResponding: boolean
  handleContinueSession: () => void
  handleResponseInputKeyDown: (e: React.KeyboardEvent) => void
  isForkMode?: boolean
}

export function ResponseInput({
  session,
  responseInput,
  setResponseInput,
  isResponding,
  handleContinueSession,
  handleResponseInputKeyDown,
  isForkMode,
}: ResponseInputProps) {
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
          <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">Cmd+Enter</kbd> to fork, <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Enter</kbd> for new line, <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Escape</kbd> to cancel fork
        </>
      )
    }
    // Regular help text
    return getHelpText(session.status)
  }

  // Only show the simple status text if session is failed
  if (session.status === SessionStatus.Failed) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted-foreground">{getSessionStatusText(session.status)}</span>
      </div>
    )
  }

  // Otherwise always show the input
  return (
    <div className="space-y-2">
      {isForkMode && (
        <span className="text-sm font-medium">Fork from this message:</span>
      )}
      <div className="flex gap-2">
        <Textarea
          placeholder={getInputPlaceholder(session.status)}
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
        {isResponding ? 'Waiting for Claude to accept the interrupt...' : getForkHelpText(isForkMode || false)}
      </p>
    </div>
  )
}
