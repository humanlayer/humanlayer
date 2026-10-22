import { Effect, Option, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
	claudeUsageLimitsFromSnapshot,
	HostUsageLimits,
	HostUsageLimitsLive,
	rateLimitRejectionParksTurnUntilReset,
	mergeClaudeRateLimitEvent,
} from './host-usage-limits'

const now = 1_700_000_000_000

describe('mergeClaudeRateLimitEvent', () => {
	it('normalizes a window event to percent and milliseconds', () => {
		const limits = mergeClaudeRateLimitEvent(
			undefined,
			{ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.83, resetsAt: 1_700_000_500 },
			now,
		)
		expect(limits.windows.five_hour).toEqual({
			used_percent: 83,
			resets_at: 1_700_000_500_000,
			status: 'allowed_warning',
		})
		expect(limits.available).toBe(true)
		expect(limits.checked_at).toBe(now)
	})

	it('reads a reset time sent in milliseconds as milliseconds and reports the unit change', () => {
		const warn = vi.fn()
		const limits = mergeClaudeRateLimitEvent(
			undefined,
			{
				status: 'rejected',
				rateLimitType: 'five_hour',
				utilization: 1,
				resetsAt: 1_700_000_500_000,
				overageStatus: 'rejected',
				overageResetsAt: 1_700_000_900_000,
			},
			now,
			warn,
		)
		expect(limits.windows.five_hour?.resets_at).toBe(1_700_000_500_000)
		expect(limits.overage?.resets_at).toBe(1_700_000_900_000)
		expect(warn).toHaveBeenCalledWith({ resetsAt: 1_700_000_500_000 }, expect.any(String))
	})

	it('keeps windows the event does not mention', () => {
		const first = mergeClaudeRateLimitEvent(
			undefined,
			{ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.41, resetsAt: 1_700_100_000 },
			now,
		)
		const second = mergeClaudeRateLimitEvent(
			first,
			{ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 1_700_000_500 },
			now + 1,
		)
		expect(second.windows.seven_day?.used_percent).toBe(41)
		expect(second.windows.five_hour?.status).toBe('rejected')
	})

	it('records overage state from an overage event', () => {
		const limits = mergeClaudeRateLimitEvent(
			undefined,
			{
				status: 'rejected',
				rateLimitType: 'overage',
				overageStatus: 'rejected',
				overageDisabledReason: 'out_of_credits',
				overageResetsAt: 1_700_000_900,
			},
			now,
		)
		expect(limits.overage).toEqual({
			status: 'rejected',
			in_use: false,
			disabled_reason: 'out_of_credits',
			resets_at: 1_700_000_900_000,
		})
		expect(limits.windows).toEqual({})
	})
})

describe('rateLimitRejectionParksTurnUntilReset', () => {
	it('parks on rejected without overage', () => {
		expect(rateLimitRejectionParksTurnUntilReset({ status: 'rejected', rateLimitType: 'five_hour' })).toBe(true)
	})
	it('does not park when overage keeps the turn running', () => {
		expect(
			rateLimitRejectionParksTurnUntilReset({
				status: 'rejected',
				rateLimitType: 'five_hour',
				overageStatus: 'allowed',
			}),
		).toBe(false)
		expect(
			rateLimitRejectionParksTurnUntilReset({
				status: 'rejected',
				rateLimitType: 'five_hour',
				isUsingOverage: true,
			}),
		).toBe(false)
	})
	it('does not park on a warning', () => {
		expect(rateLimitRejectionParksTurnUntilReset({ status: 'allowed_warning', rateLimitType: 'five_hour' })).toBe(
			false,
		)
	})
})

describe('claudeUsageLimitsFromSnapshot', () => {
	it('marks limits unavailable for API key sessions', () => {
		const limits = claudeUsageLimitsFromSnapshot(
			undefined,
			{ rate_limits_available: false, rate_limits: null, subscription_type: null },
			now,
		)
		expect(limits).toEqual({ checked_at: now, available: false, subscription_type: null, windows: {} })
	})

	it('reads every window in percent and ISO time, including model-scoped ones', () => {
		const limits = claudeUsageLimitsFromSnapshot(
			undefined,
			{
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: {
					five_hour: { utilization: 83, resets_at: '2023-11-14T22:21:40.000Z' },
					seven_day: { utilization: 41, resets_at: null },
					seven_day_opus: null,
					model_scoped: [{ display_name: 'Fable', utilization: 12, resets_at: null }],
				},
			},
			now,
		)
		expect(limits.subscription_type).toBe('max')
		expect(limits.windows.five_hour).toEqual({
			used_percent: 83,
			resets_at: Date.parse('2023-11-14T22:21:40.000Z'),
		})
		expect(limits.windows.seven_day).toEqual({ used_percent: 41, resets_at: null })
		expect(limits.windows.seven_day_opus).toBeUndefined()
		expect(limits.windows['model:Fable']).toEqual({ used_percent: 12, resets_at: null })
	})

	it('reads only the plan windows, not credit balances or internal buckets', () => {
		const warn = vi.fn()
		const limits = claudeUsageLimitsFromSnapshot(
			undefined,
			{
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: {
					five_hour: { utilization: 10, resets_at: null },
					nimbus_quill: { utilization: 0, resets_at: null },
					omelette_promotional: { utilization: 100, resets_at: null },
					member_dashboard_available: false,
					limits: [{ kind: 'session', percent: 10 }],
					extra_usage: { is_enabled: true, monthly_limit: 100, used_credits: 5, utilization: 5 },
				} as never,
			},
			now,
			warn,
		)
		expect(Object.keys(limits.windows)).toEqual(['five_hour'])
		expect(warn).not.toHaveBeenCalled()
	})

	it('skips a window with an unexpected shape and reports it, keeping the good windows', () => {
		const warn = vi.fn()
		const limits = claudeUsageLimitsFromSnapshot(
			undefined,
			{
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: { five_hour: { utilization: 10, resets_at: null }, seven_day: 'nonsense' } as never,
			},
			now,
			warn,
		)
		expect(limits.windows.five_hour).toEqual({ used_percent: 10, resets_at: null })
		expect(limits.windows.seven_day).toBeUndefined()
		expect(warn).toHaveBeenCalledWith(expect.objectContaining({ key: 'seven_day' }), expect.any(String))
	})

	it('warns when a window utilization is far past its cap, a sign the units changed', () => {
		const warn = vi.fn()
		// 83 as a fraction would mean the SDK started sending percent where a fraction is expected.
		mergeClaudeRateLimitEvent(
			undefined,
			{ status: 'allowed', rateLimitType: 'five_hour', utilization: 83 },
			now,
			warn,
		)
		expect(warn).toHaveBeenCalledWith(expect.objectContaining({ percent: 8300 }), expect.any(String))
	})

	it('drops a rejected status once the snapshot shows headroom again', () => {
		const parked = mergeClaudeRateLimitEvent(
			undefined,
			{ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 1_700_000_500 },
			now,
		)
		const refreshed = claudeUsageLimitsFromSnapshot(
			parked,
			{
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: { five_hour: { utilization: 3, resets_at: null } },
			},
			now + 1,
		)
		expect(refreshed.windows.five_hour).toEqual({ used_percent: 3, resets_at: 1_700_000_500_000 })
	})
	it('drops a warning status carried from an event once the snapshot shows headroom', () => {
		const warned = mergeClaudeRateLimitEvent(
			undefined,
			{ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.85 },
			now,
		)
		const refreshed = claudeUsageLimitsFromSnapshot(
			warned,
			{
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: { seven_day: { utilization: 10, resets_at: null } },
			},
			now + 1,
		)
		expect(refreshed.windows.seven_day?.status).toBeUndefined()
	})
})

describe('HostUsageLimits service', () => {
	it('is empty until an observation arrives, then exposes it as the current snapshot', () =>
		Effect.gen(function* () {
			const usageLimits = yield* HostUsageLimits
			expect(yield* usageLimits.current).toBeUndefined()
			yield* usageLimits.applyClaudeRateLimitEvent({
				status: 'allowed',
				rateLimitType: 'five_hour',
				utilization: 0.2,
			})
			expect((yield* usageLimits.current)?.claude?.windows.five_hour?.used_percent).toBe(20)
		}).pipe(Effect.provide(HostUsageLimitsLive), Effect.runPromise))

	it('exposes the latest observation on the changes stream', () =>
		Effect.gen(function* () {
			const usageLimits = yield* HostUsageLimits
			yield* usageLimits.applyClaudeRateLimitEvent({
				status: 'allowed',
				rateLimitType: 'five_hour',
				utilization: 0.5,
			})
			const latest = Option.getOrNull(yield* usageLimits.changes.pipe(Stream.take(1), Stream.runHead))
			expect(latest?.claude?.windows.five_hour?.used_percent).toBe(50)
		}).pipe(Effect.provide(HostUsageLimitsLive), Effect.runPromise))

	it('keeps the last good observation when an update fails schema validation', () =>
		Effect.gen(function* () {
			const usageLimits = yield* HostUsageLimits
			yield* usageLimits.applyClaudeRateLimitEvent({
				status: 'allowed',
				rateLimitType: 'five_hour',
				utilization: 0.2,
			})
			yield* usageLimits.applyClaudeUsageSnapshot({
				rate_limits_available: true,
				subscription_type: 'max',
				rate_limits: { five_hour: { utilization: -5, resets_at: null } },
			})
			expect((yield* usageLimits.current)?.claude?.windows.five_hour?.used_percent).toBe(20)
		}).pipe(Effect.provide(HostUsageLimitsLive), Effect.runPromise))
})
