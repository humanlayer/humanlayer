import { afterEach, describe, expect, test, vi } from 'vitest'

import { createShutdownDeadline, GRACEFUL_SHUTDOWN_TIMEOUT_MS } from '../../src/lifecycle/shutdown-deadline'

describe('shutdown deadline', () => {
	afterEach(() => vi.useRealTimers())

	test('forces shutdown when graceful cleanup exceeds five seconds', () => {
		vi.useFakeTimers()
		const forceShutdown = vi.fn()
		const deadline = createShutdownDeadline({ forceShutdown })

		expect(deadline.begin('SIGINT')).toBe(true)
		vi.advanceTimersByTime(GRACEFUL_SHUTDOWN_TIMEOUT_MS - 1)
		expect(forceShutdown).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(forceShutdown).toHaveBeenCalledWith('deadline_exceeded', 'SIGINT')
	})

	test('forces shutdown immediately on a repeated request', () => {
		vi.useFakeTimers()
		const forceShutdown = vi.fn()
		const deadline = createShutdownDeadline({ forceShutdown })

		expect(deadline.begin('SIGTERM')).toBe(true)
		expect(deadline.begin('SIGINT')).toBe(false)
		expect(forceShutdown).toHaveBeenCalledWith('repeated_request', 'SIGINT')
	})

	test('cancels the forced shutdown after graceful cleanup completes', () => {
		vi.useFakeTimers()
		const forceShutdown = vi.fn()
		const deadline = createShutdownDeadline({ forceShutdown })

		deadline.begin('SIGINT')
		deadline.complete()
		vi.runAllTimers()

		expect(forceShutdown).not.toHaveBeenCalled()
	})
})
