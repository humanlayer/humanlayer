import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type SensitiveInputProps = React.ComponentProps<typeof Input>

/**
 * SensitiveInput is a wrapper around Input that automatically adds the `ph-no-capture` class
 * to prevent PostHog from capturing sensitive data during autocapture.
 *
 * Use this for:
 * - API keys and tokens
 * - Passwords and secrets
 * - Personal information
 * - Any other sensitive user input
 */
export const SensitiveInput = React.forwardRef<HTMLInputElement, SensitiveInputProps>(
  ({ className, ...props }, ref) => {
    return <Input ref={ref} className={cn('ph-no-capture', className)} {...props} />
  },
)

SensitiveInput.displayName = 'SensitiveInput'
