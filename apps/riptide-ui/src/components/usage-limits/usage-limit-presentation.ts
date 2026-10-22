import {
	type ClaudeUsageLimits,
	type UsageLimitSeverity,
	usageWindowHasReset,
} from '@humanlayer/schemas/zod/host/usage-limits'

export const USAGE_LIMITS_UNSUPPORTED_COPY = 'Usage limits are not reported for API key, Bedrock or Vertex sessions.'

const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']

export function orderedUsageWindows(limits: ClaudeUsageLimits) {
	return Object.entries(limits.windows).sort(([a], [b]) => {
		const ia = WINDOW_ORDER.indexOf(a)
		const ib = WINDOW_ORDER.indexOf(b)
		return (ia === -1 ? WINDOW_ORDER.length : ia) - (ib === -1 ? WINDOW_ORDER.length : ib) || a.localeCompare(b)
	})
}

export const severityTextClass: Record<UsageLimitSeverity, string> = {
	ok: 'text-muted-foreground',
	warning: 'text-[var(--terminal-warning)]',
	rejected: 'text-[var(--terminal-error)]',
}

export const severityFillClass: Record<UsageLimitSeverity, string> = {
	ok: 'bg-[var(--terminal-accent)]',
	warning: 'bg-[var(--terminal-warning)]',
	rejected: 'bg-[var(--terminal-error)]',
}

/** The used-up window that reset most recently, for a session still parked after the reset. */
export function lastResetUsedUpWindow(limits: ClaudeUsageLimits | null | undefined, now: number) {
	let latest: { id: string; resetsAt: number } | undefined
	for (const [id, window] of Object.entries(limits?.windows ?? {})) {
		const usedUp = window.status === 'rejected' || window.used_percent >= 100
		if (!usedUp || window.resets_at === null || !usageWindowHasReset(window, now)) continue
		if (!latest || window.resets_at > latest.resetsAt) latest = { id, resetsAt: window.resets_at }
	}
	return latest
}
