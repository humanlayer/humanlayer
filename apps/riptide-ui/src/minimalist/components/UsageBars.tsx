import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageWindowHasReset,
	usageWindowLabel,
} from '@humanlayer/schemas/zod/host/usage-limits'

import { formatUsagePercent, formatUsageReset } from '@/components/usage-limits/format-usage-reset'
import { orderedUsageWindows, USAGE_LIMITS_UNSUPPORTED_COPY } from '@/components/usage-limits/usage-limit-presentation'

/** A host's Claude usage windows as thin grey bars; amber past 80%, as the color rules ask. */
export function UsageBars({ limits }: { limits: ClaudeUsageLimits | null | undefined }) {
	if (!limits) return <div className="note">No usage reported yet. It shows after the host's next session.</div>
	if (!limits.available) return <div className="note">{USAGE_LIMITS_UNSUPPORTED_COPY}</div>
	return (
		<div className="usage">
			{orderedUsageWindows(limits).map(([id, window]) => {
				const used = usageWindowHasReset(window) ? 0 : window.used_percent
				const reset = formatUsageReset(window.resets_at)
				return (
					<div key={id} className="usage-row" title={reset ? `Resets ${reset}` : undefined}>
						<span className="l">{usageWindowLabel(id)}</span>
						<span className={`meter${used >= 80 ? ' high' : ''}`}>
							<i style={{ width: `${Math.min(100, used)}%` }} />
						</span>
						<span className="p">{usageWindowHasReset(window) ? 'reset' : formatUsagePercent(used)}</span>
					</div>
				)
			})}
		</div>
	)
}

/** The tightest window in a few words, for pickers: "5-hour 42% used". */
export function usageSummary(limits: ClaudeUsageLimits | null | undefined): string | null {
	const worst = mostConstrainedUsageWindow(limits)
	if (!worst || usageWindowHasReset(worst.window)) return null
	return `${usageWindowLabel(worst.id)} ${formatUsagePercent(worst.window.used_percent)} used`
}
