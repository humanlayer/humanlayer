import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ShutdownCoordinator } from '../../src/agents/claudecode/shutdown'

describe('ShutdownCoordinator', () => {
	let coordinator: ShutdownCoordinator

	beforeEach(() => {
		coordinator = new ShutdownCoordinator()
	})

	describe('session registration', () => {
		test('registerSessionCompletion creates a pending promise', () => {
			coordinator.registerSessionCompletion('session-1')
			expect(coordinator.isDaemonShuttingDown()).toBe(false)
		})

		test('resolveSessionCompletion removes the session', () => {
			coordinator.registerSessionCompletion('session-1')
			coordinator.resolveSessionCompletion('session-1')
			coordinator.resolveSessionCompletion('session-1')
		})

		test('resolveSessionCompletion is safe to call for non-existent session', () => {
			coordinator.resolveSessionCompletion('non-existent')
		})
	})

	describe('shutdown signal', () => {
		test('getShutdownSignal returns an AbortSignal', () => {
			const signal = coordinator.getShutdownSignal()
			expect(signal).toBeInstanceOf(AbortSignal)
			expect(signal.aborted).toBe(false)
		})

		test('isDaemonShuttingDown returns false initially', () => {
			expect(coordinator.isDaemonShuttingDown()).toBe(false)
		})

		test('isDaemonShuttingDown returns true after shutdownAllSessions', async () => {
			await coordinator.shutdownAllSessions()
			expect(coordinator.isDaemonShuttingDown()).toBe(true)
		})

		test('shutdown signal is aborted after shutdownAllSessions', async () => {
			const signal = coordinator.getShutdownSignal()
			await coordinator.shutdownAllSessions()
			expect(signal.aborted).toBe(true)
		})
	})

	describe('shutdownAllSessions', () => {
		test('completes immediately when no sessions registered', async () => {
			await coordinator.shutdownAllSessions()
			expect(coordinator.isDaemonShuttingDown()).toBe(true)
		})

		test('waits for registered sessions to complete', async () => {
			coordinator = new ShutdownCoordinator({ timeoutMs: 200 })
			coordinator.registerSessionCompletion('session-1')
			coordinator.registerSessionCompletion('session-2')

			const shutdownPromise = coordinator.shutdownAllSessions()
			await Promise.resolve()
			coordinator.resolveSessionCompletion('session-1')
			coordinator.resolveSessionCompletion('session-2')
			await shutdownPromise

			expect(coordinator.isDaemonShuttingDown()).toBe(true)
		})

		test('times out after configured timeout if sessions do not complete', async () => {
			coordinator = new ShutdownCoordinator({ timeoutMs: 20 })
			coordinator.registerSessionCompletion('stuck-session')

			const startTime = Date.now()
			await coordinator.shutdownAllSessions()
			const elapsed = Date.now() - startTime

			expect(elapsed).toBeGreaterThanOrEqual(10)
			expect(elapsed).toBeLessThan(500)
		}, 1_000)

		test('shuts down lifecycle participants while sessions finish', async () => {
			const events: string[] = []
			coordinator.registerSessionCompletion('session-1')
			coordinator.registerLifecycleParticipant('runtime', {
				shutdown: vi.fn(async () => {
					events.push('runtime')
					coordinator.resolveSessionCompletion('session-1')
				}),
			})

			await coordinator.shutdownAllSessions()

			expect(events).toEqual(['runtime'])
		})

		test('shutdown is idempotent for lifecycle participants', async () => {
			const shutdown = vi.fn(async () => {})
			coordinator.registerLifecycleParticipant('runtime', { shutdown })

			await Promise.all([coordinator.shutdownAllSessions(), coordinator.shutdownAllSessions()])

			expect(shutdown).toHaveBeenCalledOnce()
		})

		test('does not tear down past a lifecycle participant that is still disposing', async () => {
			coordinator = new ShutdownCoordinator({ timeoutMs: 20 })
			let finishRuntime!: () => void
			coordinator.registerLifecycleParticipant('runtime', {
				shutdown: () =>
					new Promise<void>((resolve) => {
						finishRuntime = resolve
					}),
			})

			let completed = false
			const shutdown = coordinator.shutdownAllSessions().then(() => {
				completed = true
			})
			await new Promise((resolve) => setTimeout(resolve, 40))
			expect(completed).toBe(false)

			finishRuntime()
			await shutdown
			expect(completed).toBe(true)
		}, 1_000)
	})

	describe('lifecycle participants', () => {
		test('unregisters only the participant represented by the returned cleanup', async () => {
			const first = vi.fn(async () => {})
			const second = vi.fn(async () => {})
			const unregisterFirst = coordinator.registerLifecycleParticipant('runtime', { shutdown: first })
			coordinator.registerLifecycleParticipant('runtime', { shutdown: second })
			unregisterFirst()

			await coordinator.shutdownAllSessions()

			expect(first).not.toHaveBeenCalled()
			expect(second).toHaveBeenCalledOnce()
		})

		test('refuses registration after shutdown starts', async () => {
			await coordinator.shutdownAllSessions()

			expect(() => coordinator.registerLifecycleParticipant('late', { shutdown: async () => {} })).toThrow(
				'after shutdown has started',
			)
		})
	})

	describe('isolation', () => {
		test('different instances have separate state', () => {
			const coordinator1 = new ShutdownCoordinator()
			const coordinator2 = new ShutdownCoordinator()

			coordinator1.registerSessionCompletion('session-a')
			expect(coordinator2.isDaemonShuttingDown()).toBe(false)
		})

		test('different instances have separate shutdown signals', async () => {
			const coordinator1 = new ShutdownCoordinator()
			const coordinator2 = new ShutdownCoordinator()

			await coordinator1.shutdownAllSessions()
			expect(coordinator1.isDaemonShuttingDown()).toBe(true)
			expect(coordinator2.isDaemonShuttingDown()).toBe(false)
		})
	})
})
