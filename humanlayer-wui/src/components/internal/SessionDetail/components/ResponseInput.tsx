import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SessionInfo } from '@/lib/daemon/types'
import {
  getSessionStatusText,
  getSessionButtonText,
  getInputPlaceholder,
  getHelpText,
} from '../utils/sessionStatus'

interface ResponseInputProps {
  session: SessionInfo
  showResponseInput: boolean
  setShowResponseInput: (show: boolean) => void
  responseInput: string
  setResponseInput: (input: string) => void
  isResponding: boolean
  handleContinueSession: () => void
  handleResponseInputKeyDown: (e: React.KeyboardEvent) => void
}

export function ResponseInput({
  session,
  showResponseInput,
  setShowResponseInput,
  responseInput,
  setResponseInput,
  isResponding,
  handleContinueSession,
  handleResponseInputKeyDown,
}: ResponseInputProps) {
  return (
    <>
      {!showResponseInput ? (
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">{getSessionStatusText(session.status)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowResponseInput(true)}
            disabled={session.status === 'failed'}
          >
            {getSessionButtonText(session.status, session.archived)}
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setResponseInput(e.target.value)}
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
              {isResponding ? 'Interrupting...' : (session.archived ? 'Send & Unarchive' : 'Send')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isResponding
              ? 'Waiting for Claude to accept the interrupt...'
              : getHelpText(session.status)}
          </p>
        </div>
      )}
    </>
  )
}
