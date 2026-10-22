import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { Split } from 'lucide-react'

export interface ForkButtonProps {
  onFork: () => void
  disabled?: boolean
}

export function ForkButton({ onFork, disabled }: ForkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={onFork}
          disabled={disabled}
        >
          <Split className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1">
          Fork session <KeyboardShortcut>⌘+Y</KeyboardShortcut>
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
