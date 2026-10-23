import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { resetLocalHostIdForTesting, useLocalHostIdState } from './use-colocated'

const desktopHost = vi.hoisted(() => ({ getHostId: vi.fn<() => Promise<string | null>>() }))

vi.mock('@/integrations/desktop/host', () => desktopHost)

type DesktopWindow = Window & { __TAURI__?: unknown }

const HOST_ID_TIMEOUT_MS = 2_500

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe('useLocalHostIdState', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		resetLocalHostIdForTesting()
		desktopHost.getHostId.mockReset()
		;(window as DesktopWindow).__TAURI__ = {}
	})

	afterEach(() => {
		delete (window as DesktopWindow).__TAURI__
		vi.useRealTimers()
	})

	test('resolves to the host id the desktop shell answers', async () => {
		desktopHost.getHostId.mockResolvedValue('host-this-device')
		const { result } = renderHook(() => useLocalHostIdState())
		expect(result.current).toEqual({ localHostId: null, isResolved: false })

		await act(() => vi.advanceTimersByTimeAsync(0))

		expect(result.current).toEqual({ localHostId: 'host-this-device', isResolved: true })
	})

	test('resolves without a host id when the desktop shell never answers', async () => {
		desktopHost.getHostId.mockReturnValue(new Promise(() => {}))
		const { result } = renderHook(() => useLocalHostIdState())

		await act(() => vi.advanceTimersByTimeAsync(HOST_ID_TIMEOUT_MS - 1))
		expect(result.current.isResolved).toBe(false)

		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(result.current).toEqual({ localHostId: null, isResolved: true })
	})

	test('a late answer after the timeout updates every mount without a second request', async () => {
		const answer = deferred<string | null>()
		desktopHost.getHostId.mockReturnValue(answer.promise)
		const first = renderHook(() => useLocalHostIdState())
		await act(() => vi.advanceTimersByTimeAsync(HOST_ID_TIMEOUT_MS))
		expect(first.result.current).toEqual({ localHostId: null, isResolved: true })

		const second = renderHook(() => useLocalHostIdState())
		await act(async () => answer.resolve('host-this-device'))

		expect(first.result.current).toEqual({ localHostId: 'host-this-device', isResolved: true })
		expect(second.result.current).toEqual({ localHostId: 'host-this-device', isResolved: true })
		expect(desktopHost.getHostId).toHaveBeenCalledTimes(1)
	})

	test('a failed request resolves without a host id and the next mount asks again', async () => {
		desktopHost.getHostId.mockRejectedValueOnce(new Error('bridge down')).mockResolvedValue('host-this-device')
		const first = renderHook(() => useLocalHostIdState())
		await act(() => vi.advanceTimersByTimeAsync(0))
		expect(first.result.current).toEqual({ localHostId: null, isResolved: true })

		const second = renderHook(() => useLocalHostIdState())
		await act(() => vi.advanceTimersByTimeAsync(0))

		expect(second.result.current).toEqual({ localHostId: 'host-this-device', isResolved: true })
		expect(desktopHost.getHostId).toHaveBeenCalledTimes(2)
	})

	test('resetting drops the cached id and ignores the answer to the dropped request', async () => {
		const stale = deferred<string | null>()
		desktopHost.getHostId.mockReturnValueOnce(stale.promise).mockResolvedValue('host-fresh')
		const first = renderHook(() => useLocalHostIdState())
		first.unmount()

		resetLocalHostIdForTesting()
		const second = renderHook(() => useLocalHostIdState())
		await act(async () => stale.resolve('host-stale'))
		await act(() => vi.advanceTimersByTimeAsync(0))

		expect(second.result.current).toEqual({ localHostId: 'host-fresh', isResolved: true })
	})

	test('the browser resolves at once with no host id and never asks the desktop shell', () => {
		delete (window as DesktopWindow).__TAURI__
		const { result } = renderHook(() => useLocalHostIdState())

		expect(result.current).toEqual({ localHostId: null, isResolved: true })
		expect(desktopHost.getHostId).not.toHaveBeenCalled()
	})
})
