import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { SkipForward } from 'lucide-react'

export interface AutoAdvanceButtonProps {
  enabled: boolean
  onToggle: () => void
  nextStepName: string
}

export function AutoAdvanceButton({ enabled, onToggle, nextStepName }: AutoAdvanceButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2',
            enabled && [
              'bg-[var(--terminal-success)]/15',
              'text-[var(--terminal-success)]',
              'border-[var(--terminal-success)]/30',
              'hover:bg-[var(--terminal-success)]/25',
              'hover:border-[var(--terminal-success)]',
            ],
          )}
          onClick={onToggle}
        >
          <SkipForward className="h-3.5 w-3.5" fill="currentColor" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1">
          Advance to {nextStepName} when finished{' '}
          <KeyboardShortcut>⌥+⇧+A</KeyboardShortcut>
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
