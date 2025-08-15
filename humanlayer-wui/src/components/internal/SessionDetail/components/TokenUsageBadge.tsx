import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertCircle } from 'lucide-react'

// Threshold percentages for visual warnings
const TOKEN_USAGE_THRESHOLDS = {
  WARNING: 60, // Show warning color at 60%
  CRITICAL: 90, // Show error color at 90%
}

// Default context limit when not provided by backend
const DEFAULT_CONTEXT_LIMIT = 168000 // 200k total - 32k output reserved

interface TokenUsageBadgeProps {
  effectiveContextTokens?: number
  contextLimit?: number
  model?: string
  className?: string
}

export function TokenUsageBadge({
  effectiveContextTokens,
  contextLimit,
  className,
}: TokenUsageBadgeProps) {
  // Don't show if no token data (but allow 0 as a valid value)
  if (effectiveContextTokens === undefined || effectiveContextTokens === null) return null

  // Use provided context limit from backend, or fall back to default
  const limit = contextLimit || DEFAULT_CONTEXT_LIMIT
  const percentage = Math.round((effectiveContextTokens / limit) * 100)

  // Determine color based on thresholds
  let variant: 'default' | 'secondary' | 'destructive' = 'secondary'
  let textColorClass = ''

  if (percentage >= TOKEN_USAGE_THRESHOLDS.CRITICAL) {
    // Use destructive variant (red background with white text)
    // DO NOT set text color - let the variant's default white text show
    variant = 'destructive'
  } else if (percentage >= TOKEN_USAGE_THRESHOLDS.WARNING) {
    // Use warning color but secondary variant for orange background
    textColorClass = 'text-[var(--terminal-warning)]'
  } else {
    textColorClass = 'text-[var(--terminal-success)]'
  }

  const formattedTokens = effectiveContextTokens.toLocaleString()
  const formattedLimit = limit.toLocaleString()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className={cn('font-mono text-xs gap-1', textColorClass, className)}>
          {percentage >= TOKEN_USAGE_THRESHOLDS.CRITICAL && <AlertCircle className="h-3 w-3" />}
          <span>
            {formattedTokens}/{formattedLimit} ({percentage}%)
          </span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-mono text-xs">
          <div>Context Usage: {percentage}%</div>
          <div>Tokens Used: {formattedTokens}</div>
          <div>Context Limit: {formattedLimit}</div>
          {percentage >= TOKEN_USAGE_THRESHOLDS.WARNING && (
            <div className="mt-1 text-[var(--terminal-warning)]">⚠️ Approaching context limit</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
