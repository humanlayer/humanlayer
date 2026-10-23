import { describe, expect, test } from 'vitest'

import {
	type NotFoundHealState,
	notFoundHealDelayMs,
	planNotFoundHeal,
} from '../../src/effects/services/stream-producer/stream-producer.service'

// The durable-stream producer re-POSTs to a 404 ("stream not found") stream every ~lingerMs.
// planNotFoundHeal is the pure policy the supervisor uses each tick to decide whether to keep
// waiting, re-hydrate the stream, halt the producer, or reset after a write lands. Keeping it
// pure lets us pin the exact loop-breaking behaviour without timers or a live stream.

const base = (overrides: Partial<NotFoundHealState> = {}): NotFoundHealState => ({
	notFoundStreak: 0,
	healAttempts: 0,
	healInFlight: false,
	offsetAdvanced: false,
	now: 10_000,
	nextHealAt: 0,
	...overrides,
})

describe('planNotFoundHeal', () => {
	test('a landed write (offset advanced) always resets, even mid-streak', () => {
		expect(planNotFoundHeal(base({ offsetAdvanced: true, notFoundStreak: 99, healAttempts: 4 }))).toBe('reset')
	})

	test('waits while the 404 streak is still short (ignore one-off blips)', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 0 }))).toBe('wait')
		expect(planNotFoundHeal(base({ notFoundStreak: 2 }))).toBe('wait')
	})

	test('heals once the streak crosses the threshold and backoff has elapsed', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 3, now: 10_000, nextHealAt: 0 }))).toBe('heal')
	})

	test('waits while a re-hydration is still in flight', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 5, healInFlight: true }))).toBe('wait')
	})

	test('waits until the backoff floor (nextHealAt) is reached', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 5, now: 900, nextHealAt: 1_000 }))).toBe('wait')
		expect(planNotFoundHeal(base({ notFoundStreak: 5, now: 1_000, nextHealAt: 1_000 }))).toBe('heal')
	})

	test('halts once heal attempts are exhausted with no progress', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 20, healAttempts: 5 }))).toBe('halt')
	})

	test('a landed write outranks a halt-eligible state (recovery wins)', () => {
		expect(planNotFoundHeal(base({ notFoundStreak: 20, healAttempts: 5, offsetAdvanced: true }))).toBe('reset')
	})
})

describe('notFoundHealDelayMs', () => {
	test('is a positive, monotonic-ish full-jitter backoff bounded by the cap', () => {
		for (let attempt = 1; attempt <= 8; attempt++) {
			const delay = notFoundHealDelayMs(attempt)
			expect(delay).toBeGreaterThan(0)
			// Full jitter keeps every sample within [cap/2, cap]; the cap tops out at 10s.
			expect(delay).toBeLessThanOrEqual(10_000)
		}
	})

	test('early attempts stay small (first attempt under ~0.5s)', () => {
		for (let i = 0; i < 50; i++) {
			expect(notFoundHealDelayMs(1)).toBeLessThanOrEqual(500)
		}
	})
})
