import { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { ShieldOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DraftActionButtonsProps {
  bypassEnabled: boolean
  autoAcceptEnabled: boolean
  onToggleBypass: () => void
  onToggleAutoAccept: () => void
}

/**
 * Action buttons for draft sessions.
 * Only shows bypass permissions and auto-accept buttons.
 * Fork and archive are not applicable to draft sessions.
 */
export const DraftActionButtons: FC<DraftActionButtonsProps> = ({
  bypassEnabled,
  autoAcceptEnabled,
  onToggleBypass,
  onToggleAutoAccept,
}) => {
  return (
    <div className="flex items-center gap-1">
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
    </div>
  )
}
