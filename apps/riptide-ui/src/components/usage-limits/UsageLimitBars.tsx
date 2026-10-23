import {
	type ClaudeUsageLimits,
	type UsageLimitSeverity,
	type UsageLimitWindow,
	usageWindowHasReset,
	usageWindowLabel,
	usageWindowSeverity,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { cn } from '@humanlayer/ui/lib/utils'

import { formatUsagePercent, formatUsageReset } from './format-usage-reset'
import {
	orderedUsageWindows,
	severityFillClass,
	severityTextClass,
	USAGE_LIMITS_UNSUPPORTED_COPY,
} from './usage-limit-presentation'

export function UsageLimitBar({
	usedPercent,
	severity,
	className,
}: {
	usedPercent: number
	severity: UsageLimitSeverity
	className?: string
}) {
	return (
		<div
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.min(100, Math.round(usedPercent))}
			className={cn('relative h-1.5 w-full overflow-hidden bg-[var(--terminal-border)]/40', className)}
		>
			<div
				className={cn('absolute inset-y-0 left-0', severityFillClass[severity])}
				style={{ width: `${Math.min(100, usedPercent)}%` }}
			/>
		</div>
	)
}

interface UsageLimitBarsProps {
	limits: ClaudeUsageLimits | null | undefined
	size?: 'md' | 'sm'
	className?: string
}

export function UsageLimitBars({ limits, size = 'md', className }: UsageLimitBarsProps) {
	if (!limits) return null
	if (!limits.available) {
		return (
			<p className={cn('font-mono text-[11px] text-muted-foreground', className)}>
				{USAGE_LIMITS_UNSUPPORTED_COPY}
			</p>
		)
	}
	const windows = orderedUsageWindows(limits)
	if (windows.length === 0) return null
	const small = size === 'sm'
	return (
		<div className={cn('grid font-mono', small ? 'gap-1 text-[9px]' : 'gap-1.5 text-[11px]', className)}>
			{windows.map(([id, window]) => {
				const severity = usageWindowSeverity(window)
				const { percent, detail } = describeWindow(window)
				return (
					<div
						key={id}
						className={cn(
							'grid items-center',
							small
								? 'grid-cols-[2.5rem_1fr_2rem] gap-1.5'
								: 'grid-cols-[7.5rem_1fr_2.75rem_9.5rem] gap-3',
						)}
					>
						<span className="truncate text-muted-foreground">
							{small ? shortLabel(id) : usageWindowLabel(id)}
						</span>
						<UsageLimitBar
							usedPercent={usageWindowHasReset(window) ? 0 : window.used_percent}
							severity={severity}
							className={small ? 'h-1' : undefined}
						/>
						<span className={cn('text-right tabular-nums', severityTextClass[severity])}>{percent}</span>
						{!small && <span className="truncate text-muted-foreground">{detail}</span>}
					</div>
				)
			})}
		</div>
	)
}

// Usage is only observed on SDK events, so a window past its reset still carries its old percent.
function describeWindow(window: UsageLimitWindow): { percent: string; detail: string } {
	const reset = formatUsageReset(window.resets_at)
	if (usageWindowHasReset(window)) return { percent: 'reset', detail: reset ? `at ${reset}` : '' }
	return { percent: formatUsagePercent(window.used_percent), detail: reset ? `resets ${reset}` : '' }
}

function shortLabel(id: string): string {
	switch (id) {
		case 'five_hour':
			return '5h'
		case 'seven_day':
			return '7d'
		case 'seven_day_opus':
			return '7d op'
		case 'seven_day_sonnet':
			return '7d so'
		case 'seven_day_oauth_apps':
			return '7d oa'
		default:
			return id.startsWith('model:') ? `7d ${id.slice('model:'.length, 'model:'.length + 2).toLowerCase()}` : id
	}
}
