import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { Archive, ArchiveRestore } from 'lucide-react'

export interface ArchiveButtonProps {
  isArchived: boolean
  isActiveSession: boolean
  onToggle: () => void
  /**
   * Keycaps shown in the tooltip, one `<kbd>` per entry (e.g. `['⌘', 'E']`).
   * Defaults to the plain `e` binding.
   */
  shortcutKeys?: readonly string[] | undefined
}

export function ArchiveButton({ isArchived, isActiveSession, onToggle, shortcutKeys = ['e'] }: ArchiveButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2',
            isActiveSession && !isArchived && [
              'text-[var(--terminal-warning)]',
              'hover:bg-[var(--terminal-warning)]/25',
              'hover:border-[var(--terminal-warning)]',
            ]
          )}
          onClick={onToggle}
        >
          {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1">
          {isArchived ? 'Unarchive' : 'Archive'} session{' '}
          {shortcutKeys.map((keycap) => (
            <KeyboardShortcut key={keycap}>{keycap}</KeyboardShortcut>
          ))}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
