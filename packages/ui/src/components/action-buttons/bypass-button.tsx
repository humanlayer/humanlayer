import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { ShieldOff } from 'lucide-react'

export interface BypassButtonProps {
  enabled: boolean
  onToggle: () => void
  disabled?: boolean
  disabledTooltip?: string
}

export function BypassButton({ enabled, onToggle, disabled, disabledTooltip }: BypassButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label="Bypass permissions"
          aria-pressed={enabled}
          className={cn(
            'h-7 px-2',
            disabled && 'pointer-events-none',
            enabled && [
              'bg-[var(--terminal-error)]/15',
              'text-[var(--terminal-error)]',
              'border-[var(--terminal-error)]/40',
              'hover:bg-[var(--terminal-error)]/25',
              'hover:border-[var(--terminal-error)]',
            ],
          )}
          onClick={onToggle}
        >
          <ShieldOff className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1">
          {disabled ? (
            (disabledTooltip ?? 'Bypass permissions unavailable')
          ) : (
            <>
              {enabled ? 'Disable' : 'Enable'} bypass permissions <KeyboardShortcut>⌥+Y</KeyboardShortcut>
            </>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
