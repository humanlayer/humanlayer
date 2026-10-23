import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { OctagonX } from 'lucide-react'

export interface InterruptButtonProps {
  onInterrupt: () => void
  isNarrow: boolean
  disabled?: boolean
  shortcut?: string
  className?: string
}

export function InterruptButton({
  onInterrupt,
  isNarrow,
  disabled,
  shortcut = 'Ctrl+C',
  className,
}: InterruptButtonProps) {
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={disabled}
      onClick={onInterrupt}
      className={cn(
        isNarrow ? 'h-7 px-2' : 'h-auto py-0.5 px-2 text-xs',
        className,
      )}
    >
      <OctagonX className={isNarrow ? 'h-3.5 w-3.5' : 'h-3 w-3 mr-1'} />
      {!isNarrow && (
        <>
          <span>Interrupt</span>
          <KeyboardShortcut size="xs" className="ml-1">
            {shortcut}
          </KeyboardShortcut>
        </>
      )}
    </Button>
  )
}
