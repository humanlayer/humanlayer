import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { RotateCw } from 'lucide-react'

export interface IterateInNewSessionButtonProps {
  onIterateInNewSession: () => void
  isNarrow: boolean
  /** Collapse to a bare icon — only for very tight widths where even the short label doesn't fit */
  isIconOnly?: boolean
  disabled?: boolean
  shortcut?: string
  className?: string
}

export function IterateInNewSessionButton({
  onIterateInNewSession,
  isNarrow,
  isIconOnly = false,
  disabled,
  shortcut = '⌥+ENTER',
  className,
}: IterateInNewSessionButtonProps) {
  // min-h matches the send button: py-0.5 + h-5 shortcut badge + 1px borders = 26px,
  // so variants without the badge (narrow/icon-only) don't change the action row height
  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onIterateInNewSession}
      className={cn('h-auto min-h-[26px] py-0.5 px-2 text-xs', className)}
    >
      <RotateCw className={isIconOnly ? 'h-3.5 w-3.5' : 'h-3 w-3 mr-1'} />
      {/* Narrow: keep a short label so the action stays discoverable (CORE-1636) */}
      {!isIconOnly && <span>{isNarrow ? 'New Session' : 'Continue in New Session'}</span>}
      {!isNarrow && !isIconOnly && (
        <KeyboardShortcut size="xs" className="ml-1">
          {shortcut}
        </KeyboardShortcut>
      )}
    </Button>
  )

  if (!isNarrow && !isIconOnly) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>
        <p className="flex items-center gap-1">
          Continue in New Session <KeyboardShortcut>{shortcut}</KeyboardShortcut>
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
