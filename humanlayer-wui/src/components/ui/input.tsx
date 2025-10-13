import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-accent placeholder:text-muted-foreground selection:bg-[var(--terminal-selection)] selection:text-foreground bg-background border-border flex h-9 w-full min-w-0 rounded-none border font-mono text-foreground px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:outline-destructive aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
