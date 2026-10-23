import { DurableStreamError, FetchError } from '@durable-streams/client'

export const isNotFoundCause = (cause: unknown) =>
	(cause instanceof FetchError && cause.status === 404) ||
	(cause instanceof DurableStreamError && (cause.status === 404 || cause.code === 'NOT_FOUND'))

// --- Durable-stream 404 ("stream not found") self-heal + circuit-breaker tuning ---
// A 404 means the stream does not exist server-side (never hydrated, or expired). The producer
// drops the failed batch and re-POSTs the next one every ~lingerMs; before this guard, onError
// only logged, so a persistent 404 became a hot loop that spammed logs + Sentry and starved the
// daemon event loop (heartbeats stopped, sessions failed). See PR description.
/** Coalesce the repeated 404 warning to at most one line per window. */
export const NOT_FOUND_LOG_THROTTLE_MS = 5_000
/** Only start re-hydrating once we've seen this many consecutive 404s (ignore one-off blips). */
export const NOT_FOUND_HEAL_AFTER_STREAK = 3
/** Give up (halt the producer) after this many re-hydration attempts make no progress. */
export const NOT_FOUND_MAX_HEAL_ATTEMPTS = 5
/** Full-jitter exponential backoff bounds between re-hydration attempts. */
export const NOT_FOUND_HEAL_BASE_DELAY_MS = 500
export const NOT_FOUND_HEAL_MAX_DELAY_MS = 10_000
/** How often the supervisor wakes to check progress / drive healing. */
export const NOT_FOUND_SUPERVISOR_TICK_MS = 1_000

export const notFoundHealDelayMs = (attempt: number): number => {
	const capped = Math.min(NOT_FOUND_HEAL_MAX_DELAY_MS, NOT_FOUND_HEAL_BASE_DELAY_MS * 2 ** (attempt - 1))
	return Math.floor(capped / 2 + (Math.random() * capped) / 2)
}

/** What the 404 supervisor should do on a given tick. Pure so the policy is unit-testable. */
export type NotFoundHealAction = 'reset' | 'wait' | 'heal' | 'halt'

export interface NotFoundHealState {
	/** Consecutive 404s seen since the last landed write. */
	notFoundStreak: number
	/** Re-hydration attempts made in the current streak. */
	healAttempts: number
	/** True while a re-hydration call is still outstanding. */
	healInFlight: boolean
	/** A write landed since the last tick (the producer offset advanced). */
	offsetAdvanced: boolean
	now: number
	/** Earliest time the next re-hydration may run (backoff floor). */
	nextHealAt: number
}

/**
 * Decide the supervisor's action for one tick:
 * - `reset` — a write landed, clear the breaker.
 * - `wait`  — streak too short, backoff not elapsed, or a heal is still in flight.
 * - `heal`  — re-hydrate the stream now.
 * - `halt`  — attempts exhausted with no progress; stop the producer.
 */
export const planNotFoundHeal = (s: NotFoundHealState): NotFoundHealAction => {
	if (s.offsetAdvanced) return 'reset'
	if (s.notFoundStreak < NOT_FOUND_HEAL_AFTER_STREAK) return 'wait'
	if (s.healInFlight || s.now < s.nextHealAt) return 'wait'
	if (s.healAttempts >= NOT_FOUND_MAX_HEAL_ATTEMPTS) return 'halt'
	return 'heal'
}
