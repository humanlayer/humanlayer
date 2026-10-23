import * as React from 'react'
import { cn } from '@humanlayer/ui/lib/utils'

export interface KeyboardShortcutProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
  size?: 'sm' | 'md' | 'xs'
}

const KeyboardShortcut = React.forwardRef<HTMLSpanElement, KeyboardShortcutProps>(
  ({ className, children, size = 'sm', }, ref) => {
    return (
		<kbd
      ref={ref}
			data-slot="keyboard-shortcut"
			className={cn(
				'pointer-events-none inline-flex md:h-5 sm:h-4 xs:h-3 select-none items-center gap-1',
				'rounded border bg-muted px-1.5 font-mono text-sm font-medium',
				'text-muted-foreground',
        `text-${size}`,
        className
			)}
		>
        {children}
      </kbd>
    )
  },
)

KeyboardShortcut.displayName = 'KeyboardShortcut'

export { KeyboardShortcut }
