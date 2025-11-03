import { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { Archive, Split, ArchiveRestore, ShieldOff, Pencil, ChevronDown } from 'lucide-react'
import { SessionStatus } from '@/lib/daemon/types'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { EditorType } from '@/lib/preferences'

interface ActiveSessionActionButtonsProps {
  canFork: boolean
  bypassEnabled: boolean
  autoAcceptEnabled: boolean
  sessionStatus: SessionStatus
  isArchived: boolean
  workingDir?: string
  preferredEditor?: EditorType
  onToggleFork: () => void
  onToggleBypass: () => void
  onToggleAutoAccept: () => void
  onToggleArchive: () => void
  onOpenInEditor?: (editor?: EditorType) => void
}

/**
 * Action buttons for active (non-draft) sessions.
 * Shows all action buttons: fork, bypass, auto-accept, open in editor, and archive.
 */
export const ActiveSessionActionButtons: FC<ActiveSessionActionButtonsProps> = ({
  canFork,
  bypassEnabled,
  autoAcceptEnabled,
  sessionStatus,
  isArchived,
  workingDir,
  preferredEditor = 'code',
  onToggleFork,
  onToggleBypass,
  onToggleAutoAccept,
  onToggleArchive,
  onOpenInEditor,
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
            <KeyboardShortcut keyString="⌥+Y" />
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
            {autoAcceptEnabled ? 'Disable' : 'Enable'} auto-accept <KeyboardShortcut keyString="⌥+A" />
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Open in Editor button with dropdown */}
      {workingDir && onOpenInEditor && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 px-1.5 gap-0.5">
                  <Pencil className="h-3.5 w-3.5" />
                  <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p className="flex items-center gap-1">
                Open in editor <KeyboardShortcut keyString="⌘+Shift+E" />
              </p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => onOpenInEditor('cursor')}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium">Cursor</span>
                {preferredEditor === 'cursor' && (
                  <span className="ml-auto text-xs text-muted-foreground">(default)</span>
                )}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenInEditor('code')}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium">VS Code</span>
                {preferredEditor === 'code' && (
                  <span className="ml-auto text-xs text-muted-foreground">(default)</span>
                )}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenInEditor('zed')}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium">Zed</span>
                {preferredEditor === 'zed' && (
                  <span className="ml-auto text-xs text-muted-foreground">(default)</span>
                )}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenInEditor('default')}>
              <span className="flex items-center gap-2">
                <span className="text-xs font-medium">System Default</span>
                {preferredEditor === 'default' && (
                  <span className="ml-auto text-xs text-muted-foreground">(default)</span>
                )}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Archive button */}
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
    </div>
  )
}
