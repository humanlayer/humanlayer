import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hostLiveness, RESUME_GRACE_MS, resetHostClockForTests, STALE_AFTER_MS, useHostClock } from './host-clock'

const now = 1_800_000_000_000

describe('hostLiveness', () => {
	const awake = { now, pausedAt: 0, resumedAt: 0 }

	it.each([
		{ status: 'online', age: 0, online: true, stale: false },
		{ status: 'online', age: STALE_AFTER_MS, online: true, stale: false },
		{ status: 'online', age: STALE_AFTER_MS + 1, online: false, stale: true },
		{ status: 'offline', age: 0, online: false, stale: false },
	] as const)('reads $status at $age ms old as online=$online', ({ status, age, online, stale }) => {
		expect(hostLiveness(status, now - age, awake)).toEqual({ online, stale })
	})

	it('keeps a host that was live before sleep live during the grace, then lets it go', () => {
		const pausedAt = now - 30 * 60_000
		const lastSeen = pausedAt - 10_000
		const resumed = { now, pausedAt, resumedAt: now }

		expect(hostLiveness('online', lastSeen, resumed)).toEqual({ online: true, stale: false })
		expect(hostLiveness('offline', lastSeen, resumed)).toEqual({ online: false, stale: false })
		expect(hostLiveness('online', lastSeen, { ...resumed, now: now + RESUME_GRACE_MS })).toEqual({
			online: false,
			stale: true,
		})
	})

	it('keeps a host that was already gone before sleep offline after wake', () => {
		const pausedAt = now - 30 * 60_000
		const lastSeen = pausedAt - STALE_AFTER_MS - 1

		expect(hostLiveness('online', lastSeen, { now, pausedAt, resumedAt: now })).toEqual({
			online: false,
			stale: true,
		})
	})
})

describe('useHostClock', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(now)
		resetHostClockForTests()
	})

	afterEach(() => {
		cleanup()
		vi.useRealTimers()
	})

	it('ticks every 15 seconds', () => {
		const { result } = renderHook(() => useHostClock())
		expect(result.current.now).toBe(now)

		act(() => void vi.advanceTimersByTime(10_000))
		expect(result.current.now).toBe(now)
		act(() => void vi.advanceTimersByTime(5_000))
		expect(result.current.now).toBe(now + 15_000)
		expect(result.current.resumedAt).toBe(0)
	})

	it('notes a wake when a check lands long after the last one', () => {
		const { result } = renderHook(() => useHostClock())
		act(() => void vi.advanceTimersByTime(5_000))

		vi.setSystemTime(now + 30 * 60_000)
		act(() => void vi.advanceTimersByTime(5_000))

		expect(result.current).toEqual({
			now: now + 30 * 60_000 + 5_000,
			pausedAt: now + 5_000,
			resumedAt: now + 30 * 60_000 + 5_000,
		})
	})

	it('notes when the window hides and comes back', () => {
		const visibility = vi.spyOn(document, 'visibilityState', 'get')
		const { result } = renderHook(() => useHostClock())

		visibility.mockReturnValue('hidden')
		act(() => void document.dispatchEvent(new Event('visibilitychange')))
		act(() => void vi.advanceTimersByTime(10 * 60_000))
		visibility.mockReturnValue('visible')
		act(() => void document.dispatchEvent(new Event('visibilitychange')))

		expect(result.current).toEqual({ now: now + 10 * 60_000, pausedAt: now, resumedAt: now + 10 * 60_000 })
		visibility.mockRestore()
	})
})
