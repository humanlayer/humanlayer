import { type ComponentProps, type KeyboardEventHandler, useCallback } from 'react'
import { Pencil } from 'lucide-react'
import type { EffortLevel } from '@humanlayer/ai/config'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { cn } from '../lib/utils'

export interface EffortSelectorProps {
  effort?: string | null
  onEffortChange: (next: string) => void
  levels: readonly EffortLevel[]
  selectorOpen?: boolean
  onSelectorOpenChange?: (open: boolean) => void
  contentSide?: ComponentProps<typeof DropdownMenuContent>['side']
  disabled?: boolean
}

export function EffortSelector({
  effort,
  onEffortChange,
  levels,
  selectorOpen,
  onSelectorOpenChange,
  contentSide,
  disabled,
}: EffortSelectorProps) {
  const handleTriggerKeyDown = useCallback<KeyboardEventHandler<HTMLButtonElement>>(
    (event) => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.stopPropagation()
      }
    },
    [],
  )

  return (
    // Suppress the tooltip while the dropdown is open — otherwise it overlaps
    // the menu and interferes with mouse selection.
    <Tooltip open={selectorOpen ? false : undefined}>
      <TooltipTrigger asChild>
        <div>
          <DropdownMenu open={selectorOpen} onOpenChange={onSelectorOpenChange}>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onKeyDown={handleTriggerKeyDown}
                className={cn(
                  'h-6 px-2 py-0 text-xs font-mono uppercase tracking-wider',
                  'border-muted-foreground/20 transition-colors duration-200',
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:border-muted-foreground/40 hover:text-primary hover:bg-primary/10',
                )}
              >
                {effort ?? 'EFFORT'}
                {!disabled && <Pencil className="h-3 w-3 ml-1.5 opacity-50" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side={contentSide}>
              <DropdownMenuRadioGroup value={effort ?? ''} onValueChange={onEffortChange}>
                {levels.map((level) => (
                  <DropdownMenuRadioItem
                    key={level}
                    value={level}
                    className="font-mono uppercase text-xs tracking-wider"
                  >
                    {level}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipTrigger>
      <TooltipContent>Effort: {effort ?? 'none'}</TooltipContent>
    </Tooltip>
  )
}
