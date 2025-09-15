import { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { ShieldCheck, ChevronsRight, Archive, Split } from 'lucide-react'
import { SessionStatus } from '@/lib/daemon/types'
import { cn } from '@/lib/utils'

interface ActionButtonsProps {
  sessionId: string
  canFork: boolean
  bypassEnabled: boolean
  autoAcceptEnabled: boolean
  sessionStatus: SessionStatus
  isArchived: boolean
  onToggleFork: () => void
  onToggleBypass: () => void
  onToggleAutoAccept: () => void
  onToggleArchive: () => void
}

export const ActionButtons: FC<ActionButtonsProps> = ({
  canFork,
  bypassEnabled,
  autoAcceptEnabled,
  sessionStatus,
  isArchived,
  onToggleFork,
  onToggleBypass,
  onToggleAutoAccept,
  onToggleArchive,
}) => {
  const isActiveSession = [
    SessionStatus.Starting,
    SessionStatus.Running,
    SessionStatus.WaitingInput,
  ].includes(sessionStatus as any)

  return (
    <div className="flex items-center gap-1">
      {/* Fork button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={canFork ? 'outline' : 'ghost'}
            className={cn('h-7 px-2', !canFork && 'opacity-50')}
            onClick={onToggleFork}
            disabled={!canFork}
          >
            <Split className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            Fork session <KeyboardShortcut keyString="⌘Y" />
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Bypass permissions toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={bypassEnabled ? 'destructive' : 'outline'}
            className="h-7 px-2"
            onClick={onToggleBypass}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            {bypassEnabled ? 'Disable' : 'Enable'} bypass permissions{' '}
            <KeyboardShortcut keyString="⌥Y" />
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Auto-accept toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={autoAcceptEnabled ? 'secondary' : 'outline'}
            className="h-7 px-2"
            onClick={onToggleAutoAccept}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            {autoAcceptEnabled ? 'Disable' : 'Enable'} auto-accept{' '}
            <KeyboardShortcut keyString="⇧+TAB" />
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Archive button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant={isArchived ? 'secondary' : 'outline'}
            className={cn('h-7 px-2', isActiveSession && 'text-warning')}
            onClick={onToggleArchive}
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            {isArchived ? 'Unarchive' : 'Archive'} session <KeyboardShortcut keyString="e" />
            {isActiveSession && ' (requires confirmation)'}
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
