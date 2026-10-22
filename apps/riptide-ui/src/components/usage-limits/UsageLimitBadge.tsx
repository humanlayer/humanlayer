import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageWindowLabel,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { Badge } from '@humanlayer/ui/components/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { Gauge } from 'lucide-react'

import { formatUsagePercent, formatUsageReset } from './format-usage-reset'
import { UsageLimitBars } from './UsageLimitBars'

interface UsageLimitBadgeProps {
	limits: ClaudeUsageLimits | null | undefined
	hostName?: string | null
	className?: string
}

export function UsageLimitBadge({ limits, hostName, className }: UsageLimitBadgeProps) {
	const worst = mostConstrainedUsageWindow(limits)
	if (!worst || !limits) return null
	const reset = formatUsageReset(worst.window.resets_at)
	const tone =
		worst.severity === 'rejected'
			? 'border-[var(--terminal-error)] text-[var(--terminal-error)]'
			: 'border-[var(--terminal-warning)] text-[var(--terminal-warning)]'
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="outline"
					tabIndex={0}
					aria-label={`${usageWindowLabel(worst.id)} usage limit ${formatUsagePercent(worst.window.used_percent)} used`}
					className={cn('font-mono text-[10px] gap-1 uppercase tracking-wider', tone, className)}
				>
					<Gauge aria-hidden className="h-3 w-3" />
					{usageWindowLabel(worst.id)} · {formatUsagePercent(worst.window.used_percent)}
				</Badge>
			</TooltipTrigger>
			<TooltipContent className="font-mono text-xs w-80">
				<p className="mb-2">
					Claude usage{hostName ? ` on ${hostName}` : ''}
					{reset ? ` · ${usageWindowLabel(worst.id)} resets ${reset}` : ''}
				</p>
				<UsageLimitBars limits={limits} />
			</TooltipContent>
		</Tooltip>
	)
}
