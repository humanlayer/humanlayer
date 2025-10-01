import { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { Archive, Split, ArchiveRestore, ShieldOff } from 'lucide-react'
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

  const isDraft = sessionStatus === SessionStatus.Draft

  return (
    <div className="flex items-center gap-1">
      {/* Fork button - hide for draft sessions */}
      {!isDraft && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
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
      )}

      {/* Bypass permissions toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn(
              'h-7 px-2',
              bypassEnabled && [
                'bg-[var(--terminal-error)]/15',
                'text-[var(--terminal-error)]',
                'border-[var(--terminal-error)]/40',
                'hover:bg-[var(--terminal-error)]/25',
                'hover:border-[var(--terminal-error)]',
              ],
            )}
            onClick={onToggleBypass}
          >
            <ShieldOff className="h-3.5 w-3.5" />
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
            variant="ghost"
            className={cn(
              'h-7 px-2 min-w-[38px]',
              autoAcceptEnabled && [
                'bg-[var(--terminal-warning)]/15',
                'text-[var(--terminal-warning)]',
                'border-[var(--terminal-warning)]/30',
                'hover:bg-[var(--terminal-warning)]/25',
                'hover:border-[var(--terminal-warning)]',
              ],
            )}
            onClick={onToggleAutoAccept}
          >
            <div className="w-4 h-4 text-base leading-none">⏵⏵</div>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="flex items-center gap-1">
            {autoAcceptEnabled ? 'Disable' : 'Enable'} auto-accept{' '}
            <KeyboardShortcut keyString="⇧+TAB" />
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Archive button - hide for draft sessions */}
      {!isDraft && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={'ghost'}
              className={cn('h-7 px-2', isActiveSession && 'text-warning')}
              onClick={onToggleArchive}
            >
              {isArchived ? (
                <ArchiveRestore className="h-3.5 w-3.5" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="flex items-center gap-1">
              {isArchived ? 'Unarchive' : 'Archive'} session <KeyboardShortcut keyString="e" />
              {isActiveSession && ' (requires confirmation)'}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
