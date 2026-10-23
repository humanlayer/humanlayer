import { afterEach, describe, expect, test, vi } from 'vitest'

import { createShutdownDeadline, GRACEFUL_SHUTDOWN_TIMEOUT_MS } from '../../src/lifecycle/shutdown-deadline'
import { installShutdownSignals, SHUTDOWN_SIGNALS } from '../../src/lifecycle/shutdown-signals'
import { createStartupShutdown } from '../../src/lifecycle/startup-shutdown'

const makeStartupShutdown = (disposeRuntime: () => Promise<void>) => {
	const events: string[] = []
	const deadline = createShutdownDeadline({
		forceShutdown: (reason) => events.push(`force:${reason}`),
	})
	const startupShutdown = createStartupShutdown({
		deadline,
		stopHeartbeat: () => events.push('stop-heartbeat'),
		disposeRuntime: async () => {
			events.push('dispose')
			await disposeRuntime()
		},
		exit: () => events.push('exit'),
	})
	return { events, startupShutdown }
}

describe('startup shutdown', () => {
	afterEach(() => vi.useRealTimers())

	test('disposes the runtime, which releases the instance lock, and then exits', async () => {
		vi.useFakeTimers()
		const { events, startupShutdown } = makeStartupShutdown(() => Promise.resolve())

		expect(startupShutdown.isStarted()).toBe(false)
		startupShutdown.shutdown('SIGTERM')
		expect(startupShutdown.isStarted()).toBe(true)
		await vi.advanceTimersByTimeAsync(0)
		expect(events).toEqual(['stop-heartbeat', 'dispose', 'exit'])

		await vi.advanceTimersByTimeAsync(GRACEFUL_SHUTDOWN_TIMEOUT_MS)
		expect(events).toEqual(['stop-heartbeat', 'dispose', 'exit'])
	})

	test('exits after a failed dispose', async () => {
		vi.useFakeTimers()
		const { events, startupShutdown } = makeStartupShutdown(() => Promise.reject(new Error('dispose failed')))

		startupShutdown.shutdown('SIGTERM')
		await vi.advanceTimersByTimeAsync(0)

		expect(events).toEqual(['stop-heartbeat', 'dispose', 'exit'])
	})

	test('forces the exit when the runtime does not dispose before the deadline', async () => {
		vi.useFakeTimers()
		const { events, startupShutdown } = makeStartupShutdown(() => new Promise<void>(() => {}))

		startupShutdown.shutdown('SIGTERM')
		await vi.advanceTimersByTimeAsync(GRACEFUL_SHUTDOWN_TIMEOUT_MS)

		expect(events).toEqual(['stop-heartbeat', 'dispose', 'force:deadline_exceeded'])
	})

	test('forces the exit on a repeated signal, such as the app SIGTERM after an auth-failure SIGTERM', async () => {
		vi.useFakeTimers()
		const { events, startupShutdown } = makeStartupShutdown(() => new Promise<void>(() => {}))

		startupShutdown.shutdown('SIGTERM')
		startupShutdown.shutdown('SIGTERM')
		await vi.advanceTimersByTimeAsync(0)

		expect(events).toEqual(['stop-heartbeat', 'dispose', 'force:repeated_request'])
	})
})

describe('shutdown signals', () => {
	const addedListener = (signal: (typeof SHUTDOWN_SIGNALS)[number], before: ReadonlyArray<Function>) => {
		const added = process.listeners(signal).filter((listener) => !before.includes(listener))
		expect(added).toHaveLength(1)
		return added[0] as () => void
	}

	test('keeps one listener per signal and routes it to the handler of the current phase', () => {
		const before = new Map(SHUTDOWN_SIGNALS.map((signal) => [signal, process.listeners(signal)]))
		const received: string[] = []
		const signals = installShutdownSignals((signal) => received.push(`startup:${signal}`))
		try {
			const listeners = SHUTDOWN_SIGNALS.map((signal) => addedListener(signal, before.get(signal) ?? []))

			listeners[1]?.()
			signals.route((signal) => received.push(`running:${signal}`))
			for (const listener of listeners) listener()

			expect(received).toEqual(['startup:SIGTERM', 'running:SIGINT', 'running:SIGTERM', 'running:SIGHUP'])
			for (const signal of SHUTDOWN_SIGNALS) addedListener(signal, before.get(signal) ?? [])
		} finally {
			signals.remove()
		}
		for (const signal of SHUTDOWN_SIGNALS) expect(process.listeners(signal)).toEqual(before.get(signal))
	})
})
