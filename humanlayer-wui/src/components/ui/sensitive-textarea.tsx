import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type SensitiveTextareaProps = React.ComponentProps<typeof Textarea>

/**
 * SensitiveTextarea is a wrapper around Textarea that automatically adds the `ph-no-capture` class
 * to prevent PostHog from capturing sensitive data during autocapture.
 *
 * Use this for:
 * - User prompts and messages
 * - Code snippets
 * - File contents
 * - Any other sensitive user input
 */
export const SensitiveTextarea = React.forwardRef<HTMLTextAreaElement, SensitiveTextareaProps>(
  ({ className, ...props }, ref) => {
    return <Textarea ref={ref} className={cn('ph-no-capture', className)} {...props} />
  },
)

SensitiveTextarea.displayName = 'SensitiveTextarea'
