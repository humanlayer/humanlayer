import { describe, expect, test } from 'vitest'

import { CollectionHealthTracker } from '../src/health-tracker.ts'

/**
 * Construct a tracker that degrades on the FIRST error (errorThreshold: 1), so a single
 * `recordElectricError` flips to query mode. This keeps the recovery/offline/force/listener
 * tests focused on their behavior; the error-threshold gating has its own describe block.
 */
function makeTracker(opts: { collections: string[]; recoveryThreshold?: number; errorThreshold?: number }) {
	return new CollectionHealthTracker({ errorThreshold: 1, ...opts })
}

describe('CollectionHealthTracker', () => {
	describe('initial state', () => {
		test('starts in electric mode', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			expect(tracker.getMode('sessions')).toBe('electric')
			expect(tracker.getMode('tasks')).toBe('electric')
		})

		test('throws for unknown collection', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			expect(() => tracker.getMode('unknown')).toThrow('Unknown collection: unknown')
		})

		test('getAllModes returns all collections in electric mode', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			expect(tracker.getAllModes()).toEqual({ sessions: 'electric', tasks: 'electric' })
		})
	})

	describe('error threshold (degrade gating)', () => {
		test('stays in electric mode below the error threshold', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] }) // default threshold 3
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('switches to query after errorThreshold consecutive errors', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('a success resets the error streak', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			tracker.recordElectricSuccess('sessions') // resets the streak
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('electric') // only 2 errors since reset
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('respects a custom errorThreshold', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'], errorThreshold: 2 })
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('does not fire onChange until the threshold is reached', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const modes: string[] = []
			tracker.onChange((_name, mode) => modes.push(mode))
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('sessions')
			expect(modes).toEqual([])
			tracker.recordElectricError('sessions')
			expect(modes).toEqual(['query'])
		})
	})

	describe('mode transitions', () => {
		test('stays in query mode during recovery accumulation', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('recovers to electric after RECOVERY_SUCCESS_THRESHOLD consecutive successes', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('resets success counter on new error during recovery', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			// Error resets the counter
			tracker.recordElectricError('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			// Still needs one more success
			expect(tracker.getMode('sessions')).toBe('query')
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('uses custom recoveryThreshold', () => {
			const tracker = makeTracker({
				collections: ['sessions'],
				recoveryThreshold: 5,
			})
			tracker.recordElectricError('sessions')
			// 4 successes not enough
			for (let i = 0; i < 4; i++) {
				tracker.recordElectricSuccess('sessions')
			}
			expect(tracker.getMode('sessions')).toBe('query')
			// 5th success triggers recovery
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('success in electric mode does not trigger unexpected mode change', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			// Already in electric, recording success should not change mode
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
		})
	})

	describe('per-collection independence', () => {
		test('one collection failing does not affect another', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
			expect(tracker.getMode('tasks')).toBe('electric')
		})

		test('each collection recovers independently', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			tracker.recordElectricError('sessions')
			tracker.recordElectricError('tasks')
			// Recover sessions
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			expect(tracker.getMode('sessions')).toBe('electric')
			expect(tracker.getMode('tasks')).toBe('query')
		})
	})

	describe('force mode', () => {
		test('forceMode to query overrides auto', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.forceMode('sessions', 'query')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('forceMode to electric overrides auto', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.forceMode('sessions', 'electric')
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('forceMode to auto restores automatic state', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			// Fail and switch to query
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')
			// Force to electric
			tracker.forceMode('sessions', 'electric')
			expect(tracker.getMode('sessions')).toBe('electric')
			// Reset to auto — should be back to query (underlying auto state is still 'query')
			tracker.forceMode('sessions', 'auto')
			expect(tracker.getMode('sessions')).toBe('query')
		})

		test('forceMode prevents automatic failover', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.forceMode('sessions', 'electric')
			tracker.recordElectricError('sessions')
			// Forced to electric — error should NOT trigger failover
			expect(tracker.getMode('sessions')).toBe('electric')
		})

		test('forceAllMode sets all collections', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks', 'approvals'] })
			tracker.forceAllMode('query')
			expect(tracker.getMode('sessions')).toBe('query')
			expect(tracker.getMode('tasks')).toBe('query')
			expect(tracker.getMode('approvals')).toBe('query')
		})

		test('forceAllMode auto restores all collections', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			tracker.forceAllMode('query')
			tracker.forceAllMode('auto')
			// Auto mode — all back to electric (no errors recorded)
			expect(tracker.getMode('sessions')).toBe('electric')
			expect(tracker.getMode('tasks')).toBe('electric')
		})
	})

	describe('offline state', () => {
		test('not offline initially', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('not offline when only electric fails', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('not offline when only query fails', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('offline when both electric and query fail', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)
		})

		test('not offline when electric recovers', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)
			tracker.recordElectricSuccess('sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('not offline when query recovers', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			expect(tracker.isOffline('sessions')).toBe(true)
			tracker.recordQuerySuccess('sessions')
			expect(tracker.isOffline('sessions')).toBe(false)
		})

		test('getOfflineCollections returns only offline collections', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks', 'approvals'] })
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			tracker.recordElectricError('tasks')
			// tasks: electric failed but query ok — not offline
			expect(tracker.getOfflineCollections()).toEqual(['sessions'])
		})

		test('getOfflineCollections returns empty when none offline', () => {
			const tracker = makeTracker({ collections: ['sessions', 'tasks'] })
			expect(tracker.getOfflineCollections()).toEqual([])
		})
	})

	describe('onChange listener', () => {
		test('fires when switching to query mode', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; mode: string }> = []
			tracker.onChange((name, mode) => calls.push({ name, mode }))
			tracker.recordElectricError('sessions')
			expect(calls).toEqual([{ name: 'sessions', mode: 'query' }])
		})

		test('fires when recovering to electric', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; mode: string }> = []
			tracker.onChange((name, mode) => calls.push({ name, mode }))
			tracker.recordElectricError('sessions')
			calls.length = 0 // clear
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			tracker.recordElectricSuccess('sessions')
			expect(calls).toEqual([{ name: 'sessions', mode: 'electric' }])
		})

		test('does not fire when mode stays the same', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; mode: string }> = []
			tracker.onChange((name, mode) => calls.push({ name, mode }))
			// Success in electric mode — no change
			tracker.recordElectricSuccess('sessions')
			expect(calls).toEqual([])
		})

		test('does not fire after unsubscribe', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; mode: string }> = []
			const unsubscribe = tracker.onChange((name, mode) => calls.push({ name, mode }))
			unsubscribe()
			tracker.recordElectricError('sessions')
			expect(calls).toEqual([])
		})

		test('fires when forceMode is called', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; mode: string }> = []
			tracker.onChange((name, mode) => calls.push({ name, mode }))
			tracker.forceMode('sessions', 'query')
			expect(calls).toEqual([{ name: 'sessions', mode: 'query' }])
		})
	})

	describe('onOfflineChange listener', () => {
		test('fires when collection becomes offline', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; offline: boolean }> = []
			tracker.onOfflineChange((name, offline) => calls.push({ name, offline }))
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			expect(calls).toEqual([{ name: 'sessions', offline: true }])
		})

		test('fires when collection recovers from offline', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; offline: boolean }> = []
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			tracker.onOfflineChange((name, offline) => calls.push({ name, offline }))
			tracker.recordQuerySuccess('sessions')
			expect(calls).toEqual([{ name: 'sessions', offline: false }])
		})

		test('does not fire for non-offline state changes', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; offline: boolean }> = []
			tracker.onOfflineChange((name, offline) => calls.push({ name, offline }))
			tracker.recordElectricError('sessions') // only electric fails — not offline
			expect(calls).toEqual([])
		})

		test('unsubscribes correctly', () => {
			const tracker = makeTracker({ collections: ['sessions'] })
			const calls: Array<{ name: string; offline: boolean }> = []
			const unsubscribe = tracker.onOfflineChange((name, offline) => calls.push({ name, offline }))
			unsubscribe()
			tracker.recordElectricError('sessions')
			tracker.recordQueryError('sessions')
			expect(calls).toEqual([])
		})
	})
})
