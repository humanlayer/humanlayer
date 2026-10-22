import type { SessionModelUsage } from '@humanlayer/schemas/effect/model-usage'
import { Badge } from '@humanlayer/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'

import { type NormalizedTokenUsage, normalizeSessionModelUsage, parseSessionModelUsage } from './session-model-usage'

interface SessionCostBadgeProps {
	totalCostUsd?: number | null
	modelUsage?: SessionModelUsage | string | null
	className?: string
}

export const SESSION_COST_BADGE_ACCESSIBLE_NAME = 'Session cost and token usage'

/**
 * Formats a cost value as USD with 3 decimal places
 * e.g., 0.05 -> "$0.050", 1.234 -> "$1.234"
 */
function formatCost(cost: number): string {
	return `$${cost.toFixed(3)}`
}

/**
 * Formats token count with thousands separators
 */
function formatTokens(tokens: number | undefined | null): string {
	if (tokens === undefined || tokens === null) return '0'
	return tokens.toLocaleString()
}

function UsageBreakdown({ usage }: { usage: NormalizedTokenUsage }) {
	return (
		<div className="pl-2">
			<div>Total Tokens: {formatTokens(usage.totalTokens)}</div>
			<div>Total Input: {formatTokens(usage.totalInput)}</div>
			<div>Uncached Input: {formatTokens(usage.uncachedInput)}</div>
			<div>Cache Read: {formatTokens(usage.cacheRead)}</div>
			<div>Cache Write: {formatTokens(usage.cacheWrite)}</div>
			<div>Output: {formatTokens(usage.output)}</div>
		</div>
	)
}

export function SessionCostBadge({ totalCostUsd, modelUsage: rawModelUsage, className }: SessionCostBadgeProps) {
	// Don't show if no cost data
	if (totalCostUsd === undefined || totalCostUsd === null) return null

	// Parse modelUsage - may come as string from Electric sync
	const modelUsage = parseSessionModelUsage(rawModelUsage)
	const hasModelUsage = modelUsage && Object.keys(modelUsage).length > 0
	const normalizedUsage = hasModelUsage ? normalizeSessionModelUsage(modelUsage) : null

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge asChild variant="secondary" className={cn('font-mono text-xs', className)}>
					<button type="button" aria-label={SESSION_COST_BADGE_ACCESSIBLE_NAME}>
						{formatCost(totalCostUsd)}
					</button>
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				<div className="font-mono text-xs">
					<div>Session Cost: {formatCost(totalCostUsd)}</div>
					{normalizedUsage && (
						<div className="mt-1">
							<div>Session Total</div>
							<UsageBreakdown usage={normalizedUsage.totals} />
						</div>
					)}
					{normalizedUsage &&
						Object.entries(normalizedUsage.byModel).map(([model, usage]) => (
							<div key={model} className="mt-1">
								<div>{model}</div>
								<UsageBreakdown usage={usage} />
							</div>
						))}
				</div>
			</TooltipContent>
		</Tooltip>
	)
}
