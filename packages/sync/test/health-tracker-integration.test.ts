import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { CollectionHealthTracker } from '../src/health-tracker.ts'
import { createTrackedFetchClient } from '../src/tracked-fetch.ts'

/**
 * Construct a tracker that degrades on the FIRST error (errorThreshold: 1), so a single
 * 5XX/network failure flips to query mode. These integration tests focus on the
 * fetch ↔ tracker wiring; the error-threshold gating is covered in health-tracker.test.ts.
 */
function makeTracker(opts: { collections: string[]; recoveryThreshold?: number; errorThreshold?: number }) {
	return new CollectionHealthTracker({ errorThreshold: 1, ...opts })
}

// ============================================================================
// Helpers: mock fetch builders
// ============================================================================

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
	originalFetch = globalThis.fetch
})

afterEach(() => {
	globalThis.fetch = originalFetch
})

/**
 * Install a mock fetch that always returns the given status code.
 */
function installMockFetch(status: number): void {
	globalThis.fetch = vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch
}

/**
 * Install a mock fetch that returns statuses from the provided sequence.
 * Cycles back to the start when the sequence is exhausted.
 */
function installSequenceFetch(statuses: number[]): void {
	let callIndex = 0
	globalThis.fetch = vi.fn(async () => {
		const status = statuses[callIndex % statuses.length]!
		callIndex++
		return new Response(null, { status })
	}) as unknown as typeof fetch
}

// ============================================================================
// Integration: full failover / recovery lifecycle
// ============================================================================

describe('CollectionHealthTracker + createTrackedFetchClient integration', () => {
	describe('failover lifecycle', () => {
		test('Electric 5XX triggers failover to query mode', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			expect(tracker.getMode('sessions')).toBe('electric')

			installMockFetch(503)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			const response = await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(response.status).toBe(503)
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('Electric 2XX does not change mode when already in electric', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })

			installMockFetch(200)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('4XX error does not trigger failover', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })

			installMockFetch(404)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			// 4XX is NOT an Electric infrastructure error — mode stays electric
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('recovery: 3 consecutive 2XX after failover restores electric mode', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })

			// Step 1: Fail — switch to query
			installMockFetch(503)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// Step 2: 2 successes — still in query (threshold = 3)
			installMockFetch(200)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// Step 3: 3rd success — recovery
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('recovery interrupted by new error resets counter', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			// 503 → query
			installSequenceFetch([503])
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// 200, 200 → still in query (2/3)
			installMockFetch(200)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// 503 → resets counter, still in query
			installMockFetch(503)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// 200, 200 → still in query (2/3 again)
			installMockFetch(200)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			// 200 → 3/3, recovery
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})
	})

	describe('offline state lifecycle', () => {
		test('offline when both Electric 5XX and query errors recorded', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })

			installMockFetch(500)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.isOffline('sessions')).toBe(false) // only electric failed

			// Query also fails
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)
			expect(tracker.getOfflineCollections()).toEqual(['sessions'])
		})

		test('offline clears when query recovers', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })

			// Both fail
			installMockFetch(503)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)

			// Query recovers
			tracker.recordQuerySuccess('sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
			expect(tracker.getOfflineCollections()).toEqual([])
		})

		test('offline clears when electric recovers (via tracked fetch)', async () => {
			const tracker = makeTracker({ collections: ['sessions'], recoveryThreshold: 1 })

			// Both fail
			installMockFetch(503)
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)

			// Electric recovers via tracked fetch (threshold = 1)
			installMockFetch(200)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('onOfflineChange fires during full lifecycle', async () => {
			const tracker = makeTracker({ collections: ['tasks'] })
			const offlineEvents: Array<{ name: string; offline: boolean }> = []

			tracker.onOfflineChange((name, offline) => {
				offlineEvents.push({ name, offline })
			})

			installMockFetch(503)
			const trackedFetch = createTrackedFetchClient(tracker, 'tasks')

			// Electric fails — not yet offline (query still ok)
			await trackedFetch('https://electric.example.com/v1/shape/tasks')
			expect(offlineEvents).toEqual([])

			// Query also fails — now offline
			tracker.recordQueryError('tasks')
			expect(offlineEvents).toEqual([{ name: 'tasks', offline: true }])

			// Query recovers — no longer offline
			tracker.recordQuerySuccess('tasks')
			expect(offlineEvents).toEqual([
				{ name: 'tasks', offline: true },
				{ name: 'tasks', offline: false },
			])
		})
	})

	describe('per-collection independence with tracked fetch', () => {
		test('two collections use separate tracked fetch clients independently', async () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })

			const trackedSessionsFetch = createTrackedFetchClient(tracker, 'sessions')
			const trackedTasksFetch = createTrackedFetchClient(tracker, 'tasks')

			// Sessions: 503 → query
			installMockFetch(503)
			await trackedSessionsFetch('https://electric.example.com/v1/shape/sessions')

			// Tasks: 200 → stays electric
			installMockFetch(200)
			await trackedTasksFetch('https://electric.example.com/v1/shape/tasks')

			expect(tracker.getMode('sessions')).toBe('query')
			expect(tracker.getMode('tasks')).toBe('electric')
		})
	})

	describe('response passthrough', () => {
		test('response status is passed through unchanged for 5XX', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			installMockFetch(503)

			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			const response = await trackedFetch('https://electric.example.com/v1/shape/sessions')

			expect(response.status).toBe(503)
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('response status is passed through unchanged for 2XX', async () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			installMockFetch(204)

			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
			const response = await trackedFetch('https://electric.example.com/v1/shape/sessions')

			expect(response.status).toBe(204)
			expect(tracker.getMode('sessions')).toBe('electric')
		})
	})

	describe('onChange listener fires during failover/recovery', () => {
		test('full failover/recovery lifecycle emits correct mode changes', async () => {
			const tracker = makeTracker({ collections: ['sessions'], recoveryThreshold: 2 })
			const modeChanges: Array<{ name: string; mode: string }> = []

			tracker.onChange((name, mode) => {
				modeChanges.push({ name, mode })
			})

			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			// 503 → failover to query
			installMockFetch(503)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(modeChanges).toEqual([{ name: 'sessions', mode: 'query' }])

			// 200 → 1/2 successes, still in query
			installMockFetch(200)
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(modeChanges).toHaveLength(1)

			// 200 → 2/2 successes, recover to electric
			await trackedFetch('https://electric.example.com/v1/shape/sessions')
			expect(modeChanges).toEqual([
				{ name: 'sessions', mode: 'query' },
				{ name: 'sessions', mode: 'electric' },
			])
		})
	})
})
