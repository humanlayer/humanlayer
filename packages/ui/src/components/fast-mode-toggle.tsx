import { Zap } from 'lucide-react'
import { cn } from '../lib/utils'
import { Toggle } from './toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export interface FastModeToggleProps {
  enabled: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  className?: string
}

export function FastModeToggle({ enabled, onToggle, disabled, className }: FastModeToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          variant="outline"
          size="sm"
          pressed={enabled}
          onPressedChange={onToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              if (!disabled) onToggle(!enabled)
            }
          }}
          disabled={disabled}
          className={cn(
            'h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider',
            enabled &&
              !disabled && [
                'bg-[var(--terminal-warning)]/15',
                'text-[var(--terminal-warning)]',
                'border-[var(--terminal-warning)]/30',
                'hover:bg-[var(--terminal-warning)]/25',
                'hover:text-[var(--terminal-warning)]',
                'hover:border-[var(--terminal-warning)]',
                'data-[state=on]:bg-[var(--terminal-warning)]/15',
                'data-[state=on]:text-[var(--terminal-warning)]',
              ],
            className,
          )}
          aria-label={`Fast Mode: ${enabled ? 'Enabled' : 'Disabled'}`}
        >
          <Zap className={cn('h-3 w-3', enabled && !disabled && 'fill-current')} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>Fast Mode: {enabled ? 'Enabled' : 'Disabled'}</TooltipContent>
    </Tooltip>
  )
}
