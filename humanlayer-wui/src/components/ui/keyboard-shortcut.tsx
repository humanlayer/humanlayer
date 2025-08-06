import * as React from 'react'
import { cn } from '@/lib/utils'

export interface KeyboardShortcutProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
  size?: 'sm' | 'md'
}

const KeyboardShortcut = React.forwardRef<HTMLSpanElement, KeyboardShortcutProps>(
  ({ className, children, size = 'sm', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          // Base styles - emulating the chicklet appearance
          'inline-flex items-center justify-center',
          'bg-transparent', // Transparent background
          'border border-border', // Use app's border color
          'rounded-md', // Slightly rounded corners
          'font-mono font-medium', // Clean typography
          'text-muted-foreground', // Use muted text color like tooltips
          'select-none', // Prevent text selection
          // Size variants
          size === 'sm' && 'px-1.5 py-0.5 text-xs min-w-[1.25rem] h-5',
          size === 'md' && 'px-2 py-1 text-sm min-w-[1.5rem] h-6',
          className,
        )}
        {...props}
      >
        {children}
      </span>
    )
  },
)

KeyboardShortcut.displayName = 'KeyboardShortcut'

export { KeyboardShortcut }
