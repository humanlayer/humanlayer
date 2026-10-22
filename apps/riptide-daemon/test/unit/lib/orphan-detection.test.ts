import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ORPHAN_CHECK_INTERVAL_MS, startOrphanDetection } from '../../../src/lib/orphan-detection'

const originalPpidDescriptor = Object.getOwnPropertyDescriptor(process, 'ppid')
const originalSetInterval = globalThis.setInterval
const originalClearInterval = globalThis.clearInterval
let intervalCallback: (() => void) | undefined
let intervalMs: number | undefined

function setPpid(ppid: number) {
	Object.defineProperty(process, 'ppid', {
		configurable: true,
		get: () => ppid,
	})
}

function tickInterval() {
	intervalCallback?.()
}

describe('startOrphanDetection', () => {
	beforeEach(() => {
		intervalCallback = undefined
		intervalMs = undefined
		globalThis.setInterval = vi.fn((callback: () => void, ms?: number) => {
			intervalCallback = callback
			intervalMs = ms
			return 1 as unknown as ReturnType<typeof setInterval>
		}) as unknown as typeof setInterval
		globalThis.clearInterval = vi.fn(() => {}) as unknown as typeof clearInterval
		setPpid(123)
	})

	afterEach(() => {
		globalThis.setInterval = originalSetInterval
		globalThis.clearInterval = originalClearInterval
		if (originalPpidDescriptor) {
			Object.defineProperty(process, 'ppid', originalPpidDescriptor)
		}
	})

	test('returns cleanup and does not call onOrphaned before ppid changes', () => {
		const onOrphaned = vi.fn()
		const stop = startOrphanDetection(onOrphaned)

		expect(intervalMs).toBe(ORPHAN_CHECK_INTERVAL_MS)
		tickInterval()
		stop()

		expect(onOrphaned).not.toHaveBeenCalled()
		expect(clearInterval).toHaveBeenCalledTimes(1)
	})

	test('does not start polling when already parented by pid 1', () => {
		setPpid(1)
		const onOrphaned = vi.fn()
		const stop = startOrphanDetection(onOrphaned)

		tickInterval()
		stop()

		expect(setInterval).not.toHaveBeenCalled()
		expect(clearInterval).not.toHaveBeenCalled()
		expect(onOrphaned).not.toHaveBeenCalled()
	})

	test('calls onOrphaned once when ppid becomes 1', () => {
		let currentPpid = 123
		Object.defineProperty(process, 'ppid', {
			configurable: true,
			get: () => currentPpid,
		})
		const onOrphaned = vi.fn()
		const stop = startOrphanDetection(onOrphaned)

		currentPpid = 1
		tickInterval()
		tickInterval()
		stop()

		expect(onOrphaned).toHaveBeenCalledTimes(1)
	})
})
