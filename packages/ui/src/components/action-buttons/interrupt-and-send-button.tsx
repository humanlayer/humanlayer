import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { Send } from 'lucide-react'

export interface InterruptAndSendButtonProps {
  onInterruptAndSend: () => void
  isNarrow: boolean
  disabled?: boolean
  shortcut?: string
  className?: string
}

export function InterruptAndSendButton({
  onInterruptAndSend,
  isNarrow,
  disabled,
  shortcut = 'Ctrl+Enter',
  className,
}: InterruptAndSendButtonProps) {
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={disabled}
      onClick={onInterruptAndSend}
      className={cn(
        isNarrow ? 'h-7 px-2' : 'h-auto py-0.5 px-2 text-xs',
        className,
      )}
    >
      <Send className={isNarrow ? 'h-3.5 w-3.5' : 'h-3 w-3 mr-1'} />
      {!isNarrow && (
        <>
          <span>Interrupt &amp; Send</span>
          <KeyboardShortcut size="xs" className="ml-1">
            {shortcut}
          </KeyboardShortcut>
        </>
      )}
    </Button>
  )
}
