import { describe, expect, test, vi } from 'vitest'

import { attachElectricKeepAlive, type KeepAliveCollection } from '../src/electric-keep-alive.ts'
import { CollectionHealthTracker } from '../src/health-tracker.ts'

/**
 * Fake collection that records keep-alive subscribe/unsubscribe activity and lets the test
 * emit `status:change` events, matching the minimal surface attachElectricKeepAlive needs.
 * `failSubscribe` / `failUnsubscribe` make the respective call throw, to exercise the
 * error-capture path.
 */
class FakeCollection implements KeepAliveCollection {
	subscribeCount = 0
	activeSubscriptions = 0
	failSubscribe = false
	failUnsubscribe = false
	private statusHandlers: Array<(payload: { status: string }) => void> = []

	subscribeChanges(_callback: () => void, _options?: { includeInitialState?: boolean }) {
		this.subscribeCount += 1
		if (this.failSubscribe) throw new Error('subscribeChanges boom')
		this.activeSubscriptions += 1
		let unsubscribed = false
		const failUnsubscribe = this.failUnsubscribe
		return {
			unsubscribe: () => {
				if (unsubscribed) return
				if (failUnsubscribe) throw new Error('unsubscribe boom')
				unsubscribed = true
				this.activeSubscriptions -= 1
			},
		}
	}

	on(_event: 'status:change', handler: (payload: { status: string }) => void) {
		this.statusHandlers.push(handler)
	}

	emitStatus(status: string) {
		for (const handler of this.statusHandlers) handler({ status })
	}
}

function createMockLogger() {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('attachElectricKeepAlive', () => {
	test('does not subscribe while the collection is in electric mode', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()

		attachElectricKeepAlive(collection, tracker, 'sessions')

		expect(collection.subscribeCount).toBe(0)
		expect(collection.activeSubscriptions).toBe(0)
	})

	test('subscribes a keep-alive when the collection degrades to query mode', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('sessions', 'query')

		expect(collection.subscribeCount).toBe(1)
		expect(collection.activeSubscriptions).toBe(1)
	})

	test('releases the keep-alive when the collection recovers to electric mode', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('sessions', 'query')
		expect(collection.activeSubscriptions).toBe(1)

		tracker.forceMode('sessions', 'auto') // back to electric (no errors recorded)
		expect(collection.activeSubscriptions).toBe(0)
	})

	test('subscribes immediately when the collection is already degraded at attach time', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		tracker.forceMode('sessions', 'query')

		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		expect(collection.activeSubscriptions).toBe(1)
	})

	test('ignores mode changes for other collections', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions', 'tasks'] })
		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('tasks', 'query')

		expect(collection.subscribeCount).toBe(0)
	})

	test('does not double-subscribe across repeated query transitions', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('sessions', 'query')
		tracker.forceMode('sessions', 'auto')
		tracker.forceMode('sessions', 'query')

		// Each degrade opens exactly one keep-alive; recovery closed the first one.
		expect(collection.subscribeCount).toBe(2)
		expect(collection.activeSubscriptions).toBe(1)
	})

	test('tears down on cleaned-up status: unsubscribes and stops reacting to the tracker', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()
		attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('sessions', 'query')
		expect(collection.activeSubscriptions).toBe(1)

		collection.emitStatus('cleaned-up')
		expect(collection.activeSubscriptions).toBe(0)

		// Tracker listener removed — further mode changes do not re-subscribe.
		tracker.forceMode('sessions', 'auto')
		tracker.forceMode('sessions', 'query')
		expect(collection.subscribeCount).toBe(1)
	})

	test('explicit teardown unsubscribes and detaches from the tracker', () => {
		const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
		const collection = new FakeCollection()
		const teardown = attachElectricKeepAlive(collection, tracker, 'sessions')

		tracker.forceMode('sessions', 'query')
		expect(collection.activeSubscriptions).toBe(1)

		teardown()
		expect(collection.activeSubscriptions).toBe(0)

		tracker.forceMode('sessions', 'auto')
		tracker.forceMode('sessions', 'query')
		expect(collection.subscribeCount).toBe(1)
	})

	describe('error capture', () => {
		test('logs and reports a subscribe failure without throwing into the tracker', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const collection = new FakeCollection()
			collection.failSubscribe = true
			const logger = createMockLogger()
			const captureException = vi.fn()
			attachElectricKeepAlive(collection, tracker, 'sessions', { logger: logger as never, captureException })

			// Must not throw out of the tracker's emit loop.
			expect(() => tracker.forceMode('sessions', 'query')).not.toThrow()

			expect(collection.subscribeCount).toBe(1)
			expect(collection.activeSubscriptions).toBe(0) // subscribe threw → nothing held
			expect(logger.warn).toHaveBeenCalledTimes(1)
			expect(captureException).toHaveBeenCalledTimes(1)
			expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
				tags: {
					'sync.mode': 'electric',
					'sync.collection': 'sessions',
					'sync.reason': 'keep_alive_subscribe',
				},
			})
			expect((captureException.mock.calls[0][0] as Error).message).toContain(
				'Electric keep-alive subscribe failed for sessions',
			)
		})

		test('reports a subscribe failure at most once but logs every occurrence', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const collection = new FakeCollection()
			collection.failSubscribe = true
			const logger = createMockLogger()
			const captureException = vi.fn()
			attachElectricKeepAlive(collection, tracker, 'sessions', { logger: logger as never, captureException })

			// Two degrade cycles, each retrying the failing subscribe.
			tracker.forceMode('sessions', 'query')
			tracker.forceMode('sessions', 'auto')
			tracker.forceMode('sessions', 'query')

			expect(captureException).toHaveBeenCalledTimes(1) // deduped
			expect(logger.warn).toHaveBeenCalledTimes(2) // not deduped
		})

		test('logs and reports an unsubscribe failure, then clears the handle', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const collection = new FakeCollection()
			collection.failUnsubscribe = true
			const logger = createMockLogger()
			const captureException = vi.fn()
			attachElectricKeepAlive(collection, tracker, 'sessions', { logger: logger as never, captureException })

			tracker.forceMode('sessions', 'query') // subscribe ok
			expect(() => tracker.forceMode('sessions', 'auto')).not.toThrow() // unsubscribe throws internally

			expect(captureException).toHaveBeenCalledTimes(1)
			expect(captureException.mock.calls[0][1]).toEqual({
				tags: {
					'sync.mode': 'electric',
					'sync.collection': 'sessions',
					'sync.reason': 'keep_alive_unsubscribe',
				},
			})
			// Handle was cleared despite the throw, so a later degrade can re-subscribe.
			collection.failUnsubscribe = false
			tracker.forceMode('sessions', 'query')
			expect(collection.subscribeCount).toBe(2)
		})

		test('a throwing subscribe does not prevent other tracker listeners from firing', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const collection = new FakeCollection()
			collection.failSubscribe = true
			attachElectricKeepAlive(collection, tracker, 'sessions', { captureException: vi.fn() })

			const observed: string[] = []
			tracker.onChange((_name, mode) => observed.push(mode))

			tracker.forceMode('sessions', 'query')

			expect(observed).toEqual(['query'])
		})

		test('a subscribe failure is swallowed even with no logger or reporter provided', () => {
			const tracker = new CollectionHealthTracker({ collections: ['sessions'] })
			const collection = new FakeCollection()
			collection.failSubscribe = true
			attachElectricKeepAlive(collection, tracker, 'sessions')

			expect(() => tracker.forceMode('sessions', 'query')).not.toThrow()
		})
	})
})
