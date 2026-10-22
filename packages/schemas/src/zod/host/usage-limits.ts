import z from 'zod/v4'

import type { CodingAgent } from '../../../coding-agent/coding-agent'

export const USAGE_LIMIT_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const
export const UsageLimitStatusSchema = z.enum(USAGE_LIMIT_STATUSES)
export type UsageLimitStatus = z.infer<typeof UsageLimitStatusSchema>

// The largest millisecond timestamp a Date can hold; formatting anything past it throws.
const MAX_DATE_MS = 8_640_000_000_000_000
const EpochMsSchema = z.number().int().min(0).max(MAX_DATE_MS)

export const UsageLimitWindowSchema = z.object({
	used_percent: z.number().min(0),
	resets_at: EpochMsSchema.nullable(),
	status: UsageLimitStatusSchema.optional(),
})
export type UsageLimitWindow = z.infer<typeof UsageLimitWindowSchema>

export const CLAUDE_USAGE_WINDOW_IDS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const
export type ClaudeUsageWindowId = (typeof CLAUDE_USAGE_WINDOW_IDS)[number]

export const ClaudeUsageOverageSchema = z.object({
	status: UsageLimitStatusSchema,
	in_use: z.boolean(),
	disabled_reason: z.string().optional(),
	resets_at: EpochMsSchema.nullable().optional(),
})

export const ClaudeUsageLimitsSchema = z.object({
	checked_at: EpochMsSchema,
	/** False for API key, Bedrock and Vertex sessions: the subscription windows never apply. */
	available: z.boolean(),
	subscription_type: z.string().nullable(),
	/** Keyed by window id; model-scoped weekly windows use `model:<display name>`. */
	windows: z.record(z.string(), UsageLimitWindowSchema),
	overage: ClaudeUsageOverageSchema.optional(),
})
export type ClaudeUsageLimits = z.infer<typeof ClaudeUsageLimitsSchema>

export const CodingAgentUsageLimitsSchema = z.object({
	claude: ClaudeUsageLimitsSchema.optional(),
})
export type CodingAgentUsageLimits = z.infer<typeof CodingAgentUsageLimitsSchema>
type UsageLimitsAgent = keyof CodingAgentUsageLimits

const reportsUsageLimits = (agent: CodingAgent): agent is UsageLimitsAgent =>
	agent in CodingAgentUsageLimitsSchema.shape

export const usageLimitsForAgent = (
	currentAgent: CodingAgent | null | undefined,
	limits: CodingAgentUsageLimits | null | undefined,
): ClaudeUsageLimits | null =>
	currentAgent && reportsUsageLimits(currentAgent) ? (limits?.[currentAgent] ?? null) : null

export const USAGE_LIMIT_WARNING_PERCENT = 80

export const usageWindowLabel = (id: string): string => {
	switch (id) {
		case 'five_hour':
			return '5-hour'
		case 'seven_day':
			return '7-day'
		case 'seven_day_opus':
			return '7-day · Opus'
		case 'seven_day_sonnet':
			return '7-day · Sonnet'
		case 'seven_day_oauth_apps':
			return '7-day · OAuth apps'
		default:
			return id.startsWith('model:') ? `7-day · ${id.slice('model:'.length)}` : id
	}
}

/** The model family a window is scoped to, lowercased, or null when it applies to every model. */
const usageWindowModelFamily = (id: string): string | null => {
	if (id === 'seven_day_opus') return 'opus'
	if (id === 'seven_day_sonnet') return 'sonnet'
	if (!id.startsWith('model:')) return null
	return id.slice('model:'.length).trim().split(/\s+/)[0]?.toLowerCase() || null
}

/**
 * Plan-wide windows plus the windows scoped to `model` (a slug like `claude-opus-5-5` or an alias like `opus`).
 * Other models' windows are dropped, and so is every model-scoped window when the model is unknown.
 */
export const usageLimitsRelevantToModel = (
	limits: ClaudeUsageLimits | null | undefined,
	model: string | null | undefined,
): ClaudeUsageLimits | null => {
	if (!limits) return null
	const slug = model?.toLowerCase()
	const windows = Object.fromEntries(
		Object.entries(limits.windows).filter(([id]) => {
			const family = usageWindowModelFamily(id)
			return family === null || (slug?.includes(family) ?? false)
		}),
	)
	return { ...limits, windows }
}

export type UsageLimitSeverity = 'ok' | 'warning' | 'rejected'

export const usageWindowHasReset = (window: UsageLimitWindow, now: number = Date.now()): boolean =>
	window.resets_at !== null && window.resets_at <= now

export const usageWindowSeverity = (window: UsageLimitWindow, now: number = Date.now()): UsageLimitSeverity => {
	if (usageWindowHasReset(window, now)) return 'ok'
	if (window.status === 'rejected' || window.used_percent >= 100) return 'rejected'
	// Claude Code also reports `allowed_warning` on pace alone (e.g. 25% used in the first 15% of the week); ignore it.
	if (window.used_percent >= USAGE_LIMIT_WARNING_PERCENT) return 'warning'
	return 'ok'
}

/** The window that most constrains the account right now, or undefined when every window has headroom. */
export const mostConstrainedUsageWindow = (
	limits: ClaudeUsageLimits | null | undefined,
	now: number = Date.now(),
): { id: string; window: UsageLimitWindow; severity: UsageLimitSeverity } | undefined => {
	if (!limits?.available) return undefined
	let worst: { id: string; window: UsageLimitWindow; severity: UsageLimitSeverity } | undefined
	for (const [id, window] of Object.entries(limits.windows)) {
		const severity = usageWindowSeverity(window, now)
		if (severity === 'ok') continue
		if (
			!worst ||
			rank(severity) > rank(worst.severity) ||
			(severity === worst.severity && window.used_percent > worst.window.used_percent)
		) {
			worst = { id, window, severity }
		}
	}
	return worst
}

const rank = (severity: UsageLimitSeverity): number => (severity === 'rejected' ? 2 : severity === 'warning' ? 1 : 0)
