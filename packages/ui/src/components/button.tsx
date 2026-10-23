import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@humanlayer/ui/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-mono font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 hover:[&_kbd]:text-accent outline-none focus-visible:ring-[3px] uppercase tracking-wider border",
  {
    variants: {
      variant: {
        default:
          'bg-accent/20 text-accent border-accent hover:bg-accent hover:text-background focus-visible:border-ring focus-visible:ring-ring/50',
        destructive:
          'bg-background text-destructive border-destructive hover:bg-destructive hover:text-background focus-visible:border-destructive focus-visible:ring-destructive/50',
        outline:
          'bg-transparent text-accent border-accent hover:bg-accent hover:text-background focus-visible:border-ring focus-visible:ring-ring/50',
        secondary:
          'bg-secondary text-secondary-foreground border-border hover:bg-border hover:text-secondary-foreground focus-visible:border-border focus-visible:ring-border/50',
        ghost:
          'bg-transparent text-accent border-transparent hover:bg-accent/10 hover:border-accent focus-visible:border-ring focus-visible:ring-ring/50',
        link: 'text-accent underline-offset-4 hover:underline border-transparent bg-transparent focus-visible:border-ring focus-visible:ring-ring/50',
        'loud-success-cta':
          'bg-transparent text-[var(--terminal-success)] border-[var(--terminal-success)] hover:bg-[var(--terminal-success)]/10 hover:border-[var(--terminal-success)] focus-visible:border-[var(--terminal-success)] focus-visible:ring-[var(--terminal-success)]/50 animate-pulse-success',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        xs: 'h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      // Native buttons default to type="submit" inside forms, which makes any
      // un-typed Button an implicit submit button. Default to "button" on the
      // native branch only; asChild consumers (links etc.) are untouched.
      type={asChild ? type : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
