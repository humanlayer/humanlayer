import { Button } from '@humanlayer/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown, OctagonX, Send } from 'lucide-react'

export interface QueueSplitButtonProps {
  onQueue: () => void
  onInterrupt: () => void
  onInterruptAndSend: () => void
  disabled?: boolean
  queueShortcut?: string
  interruptShortcut?: string
  interruptAndSendShortcut?: string
  className?: string
}

export function QueueSplitButton({
  onQueue,
  onInterrupt,
  onInterruptAndSend,
  disabled,
  queueShortcut = '⌘+Enter',
  interruptShortcut = 'Ctrl+C',
  interruptAndSendShortcut = 'Ctrl+Enter',
  className,
}: QueueSplitButtonProps) {
  return (
    <div
      role="group"
      aria-label="Queue actions"
      className={cn('flex items-stretch', className)}
    >
      <Button
        variant="default"
        disabled={disabled}
        onClick={onQueue}
        aria-label="Queue"
        className="h-auto py-0.5 px-2 text-xs"
      >
        <Send className="session-composer-primary-action-icon h-3.5 w-3.5 mr-1" />
        <span className="session-composer-primary-action-label">Queue</span>
        <KeyboardShortcut size="xs" className="session-composer-primary-action-shortcut ml-1">
          {queueShortcut}
        </KeyboardShortcut>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            disabled={disabled}
            aria-label="More queue actions"
            className="h-auto py-0.5 px-1.5 text-xs border-l-0"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuItem
            onSelect={onInterruptAndSend}
            className="text-destructive [&_svg]:!text-destructive focus:!bg-destructive focus:!text-background focus:[&_svg]:!text-background"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Interrupt &amp; Send</span>
            <KeyboardShortcut size="xs" className="ml-auto">
              {interruptAndSendShortcut}
            </KeyboardShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={onInterrupt}
            className="text-destructive [&_svg]:!text-destructive focus:!bg-destructive focus:!text-background focus:[&_svg]:!text-background"
          >
            <OctagonX className="h-3.5 w-3.5" />
            <span>Interrupt</span>
            <KeyboardShortcut size="xs" className="ml-auto">
              {interruptShortcut}
            </KeyboardShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
