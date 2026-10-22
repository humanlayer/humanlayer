import { describe, expect, it } from 'vitest'

import {
	ClaudeUsageLimitsSchema,
	mostConstrainedUsageWindow,
	usageLimitsForAgent,
	usageLimitsRelevantToModel,
	usageWindowSeverity,
} from '../src/zod/host/usage-limits'

const now = 1_700_000_000_000

describe('usageWindowSeverity', () => {
	it('reads a window past its reset as ok even when it was rejected', () => {
		expect(usageWindowSeverity({ used_percent: 100, resets_at: now - 1, status: 'rejected' }, now)).toBe('ok')
	})

	it('keeps a rejected window rejected until it resets', () => {
		expect(usageWindowSeverity({ used_percent: 100, resets_at: now + 1, status: 'rejected' }, now)).toBe('rejected')
	})

	it('warns from the percent alone when the status is unknown', () => {
		expect(usageWindowSeverity({ used_percent: 80, resets_at: null }, now)).toBe('warning')
	})

	it('ignores a pace warning below the warning percent', () => {
		expect(usageWindowSeverity({ used_percent: 33, resets_at: now + 1, status: 'allowed_warning' }, now)).toBe('ok')
	})
})

describe('mostConstrainedUsageWindow', () => {
	it('skips windows that have reset and picks the worst remaining one', () => {
		const worst = mostConstrainedUsageWindow(
			{
				checked_at: now,
				available: true,
				subscription_type: 'max',
				windows: {
					five_hour: { used_percent: 100, resets_at: now - 1, status: 'rejected' },
					seven_day: { used_percent: 85, resets_at: now + 1 },
				},
			},
			now,
		)
		expect(worst).toMatchObject({ id: 'seven_day', severity: 'warning' })
	})

	it('is undefined when limits are unavailable', () => {
		expect(
			mostConstrainedUsageWindow(
				{ checked_at: now, available: false, subscription_type: null, windows: {} },
				now,
			),
		).toBeUndefined()
	})
})

describe('ClaudeUsageLimitsSchema', () => {
	const limits = (resetsAt: number, checkedAt = now) => ({
		checked_at: checkedAt,
		available: true,
		subscription_type: 'max',
		windows: { five_hour: { used_percent: 90, resets_at: resetsAt } },
	})

	it('accepts a reset time a Date can format', () => {
		expect(ClaudeUsageLimitsSchema.safeParse(limits(now + 1)).success).toBe(true)
	})

	it.each([9_000_000_000_000_000, -1])('rejects reset time %s, which no Date can format', (resetsAt) => {
		expect(ClaudeUsageLimitsSchema.safeParse(limits(resetsAt)).success).toBe(false)
	})

	it('rejects a checked time no Date can format', () => {
		expect(ClaudeUsageLimitsSchema.safeParse(limits(now + 1, 9_000_000_000_000_000)).success).toBe(false)
	})
})

describe('usageLimitsRelevantToModel', () => {
	const limits = {
		checked_at: now,
		available: true,
		subscription_type: 'max',
		windows: {
			five_hour: { used_percent: 20, resets_at: now + 1 },
			seven_day: { used_percent: 30, resets_at: now + 1 },
			seven_day_opus: { used_percent: 40, resets_at: now + 1 },
			seven_day_sonnet: { used_percent: 100, resets_at: now + 1, status: 'rejected' as const },
			'model:Fable 5': { used_percent: 100, resets_at: now + 1, status: 'rejected' as const },
			'model:Opus': { used_percent: 40, resets_at: now + 1 },
		},
	}
	const windowIds = (model: string | null) => Object.keys(usageLimitsRelevantToModel(limits, model)?.windows ?? {})

	it('keeps plan windows and only the windows for the session model', () => {
		expect(windowIds('claude-opus-5-5')).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'model:Opus'])
		expect(mostConstrainedUsageWindow(usageLimitsRelevantToModel(limits, 'claude-opus-5-5'), now)).toBeUndefined()
	})

	it('matches a model-scoped window by the first word of its display name', () => {
		expect(mostConstrainedUsageWindow(usageLimitsRelevantToModel(limits, 'claude-fable-5-1'), now)).toMatchObject({
			id: 'model:Fable 5',
			severity: 'rejected',
		})
		expect(windowIds('fable')).toContain('model:Fable 5')
	})

	it('drops every model-scoped window when the model is unknown', () => {
		expect(windowIds(null)).toEqual(['five_hour', 'seven_day'])
	})

	it('passes null through', () => {
		expect(usageLimitsRelevantToModel(null, 'opus')).toBeNull()
	})
})

describe('usageLimitsForAgent', () => {
	const claude = {
		checked_at: now,
		available: true,
		subscription_type: 'max',
		windows: { five_hour: { used_percent: 100, resets_at: now + 1, status: 'rejected' as const } },
	}

	it('returns the windows the host reports for the agent', () => {
		expect(usageLimitsForAgent('claude', { claude })).toBe(claude)
	})

	it.each(['fold', 'codelayer', 'opencode'] as const)(
		'returns nothing for %s, which the host does not track',
		(agent) => {
			expect(usageLimitsForAgent(agent, { claude })).toBeNull()
		},
	)

	it('returns nothing when the agent or the limits are unknown', () => {
		expect(usageLimitsForAgent(undefined, { claude })).toBeNull()
		expect(usageLimitsForAgent('claude', null)).toBeNull()
	})
})
