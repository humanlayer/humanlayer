import {
	getContextWindowUsagePercentage,
	resolveEffectiveContextWindow,
} from '@humanlayer/schemas/effect/model-context'
import { Badge } from '@humanlayer/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { AlertCircle } from 'lucide-react'

// Threshold percentages for visual warnings
const TOKEN_USAGE_THRESHOLDS = {
	WARNING: 60, // Show warning color at 60%
	CRITICAL: 90, // Show error color at 90%
}

interface TokenUsageBadgeProps {
	contextWindowTokens?: number | null
	contextWindowLimit?: number | null
	provider?: string | null
	model?: string | null
	/** Show rounded counts without the percentage (`45k/168k`) — used on mobile
	 * where the pill row can't fit the full comma-separated numbers. */
	condensed?: boolean
	className?: string
}

// 999,500+ rounds to "1M"+; keeps sub-million counts in "k" so we never emit "1000k".
function formatCondensedTokenCount(count: number): string {
	if (count >= 999_500) {
		const millions = count / 1_000_000
		return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`
	}
	if (count >= 1000) return `${Math.round(count / 1000)}k`
	return `${count}`
}

export function TokenUsageBadge({
	contextWindowTokens,
	contextWindowLimit,
	provider,
	model,
	condensed = false,
	className,
}: TokenUsageBadgeProps) {
	// Don't show if no token data (but allow 0 as a valid value)
	if (contextWindowTokens === undefined || contextWindowTokens === null) return null

	const limit = resolveEffectiveContextWindow({ provider, model, runtimeContextWindow: contextWindowLimit })
	const percentage = getContextWindowUsagePercentage(provider, contextWindowTokens, limit)

	// Determine color based on thresholds
	let variant: 'default' | 'secondary' | 'destructive' = 'secondary'
	let textColorClass = ''

	if (percentage >= TOKEN_USAGE_THRESHOLDS.CRITICAL) {
		variant = 'destructive'
	} else if (percentage >= TOKEN_USAGE_THRESHOLDS.WARNING) {
		textColorClass = 'text-[var(--terminal-warning)]'
	} else {
		textColorClass = 'text-[var(--terminal-success)]'
	}

	const formattedTokens = contextWindowTokens.toLocaleString()
	const formattedLimit = limit.toLocaleString()

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant={variant} className={cn('font-mono text-xs gap-1', textColorClass, className)}>
					{percentage >= TOKEN_USAGE_THRESHOLDS.CRITICAL && <AlertCircle className="h-3 w-3" />}
					<span>
						{condensed
							? `${formatCondensedTokenCount(contextWindowTokens)}/${formatCondensedTokenCount(limit)}`
							: `${formattedTokens}/${formattedLimit} (${percentage}%)`}
					</span>
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				<div className="font-mono text-xs">
					<div>Context Usage: {percentage}%</div>
					<div>Tokens Used: {formattedTokens}</div>
					<div>Context Limit: {formattedLimit}</div>
					{percentage >= TOKEN_USAGE_THRESHOLDS.WARNING && (
						<div className="mt-1 text-[var(--terminal-warning)]">Warning: Approaching context limit</div>
					)}
				</div>
			</TooltipContent>
		</Tooltip>
	)
}
