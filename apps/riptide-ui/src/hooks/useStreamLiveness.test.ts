import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { STREAM_PROBE_TIMEOUT_MS } from '@/lib/stream-liveness-probe'

import {
	isNotFoundError,
	STREAM_LIVENESS_INTERVAL_MS,
	useStreamLiveness,
	type WatchableStream,
} from './useStreamLiveness'

const STREAM_URL = 'https://sync.test/v2/streams/organizations/org-1/github/repos/a%2Fb/branches/x/pr-status'

/** A stand-in for a `StreamDB`, whose offset the test moves to simulate frames arriving. */
function fakeStream(): WatchableStream & { deliverFrame: () => void } {
	let offset = '0'
	return {
		get offset() {
			return offset
		},
		stream: { url: STREAM_URL },
		deliverFrame: () => {
			offset = String(Number(offset) + 1)
		},
	}
}

const respondWith = (status: number) =>
	vi.fn(() => Promise.resolve(new Response(null, { status: status === 404 ? 404 : status })))

/** One watchdog interval, with the microtasks the probe suspends on flushed. */
const tick = async (times = 1) => {
	for (let index = 0; index < times; index += 1) {
		await act(async () => {
			vi.advanceTimersByTime(STREAM_LIVENESS_INTERVAL_MS)
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		})
	}
}

const getAccessToken = () => Promise.resolve('token')

describe('useStreamLiveness', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test('rebuilds the stream when a probe finds it gone', async () => {
		const fetchImpl = respondWith(404)
		vi.stubGlobal('fetch', fetchImpl)
		const db = fakeStream()
		const onStreamLost = vi.fn()

		renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		await tick()

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(STREAM_URL)
		expect((fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('HEAD')
		expect(onStreamLost).toHaveBeenCalledTimes(1)
	})

	test('reports a lost stream once, so a slow rebuild is not torn down twice', async () => {
		vi.stubGlobal('fetch', respondWith(404))
		const db = fakeStream()
		const onStreamLost = vi.fn()

		renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		await tick(3)

		expect(onStreamLost).toHaveBeenCalledTimes(1)
	})

	test('does nothing while the stream is there', async () => {
		vi.stubGlobal('fetch', respondWith(200))
		const db = fakeStream()
		const onStreamLost = vi.fn()

		const { result } = renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		await tick(2)

		expect(onStreamLost).not.toHaveBeenCalled()
		expect(result.current.staleSince).toBeNull()
	})

	test('does not probe at all while frames are arriving', async () => {
		const fetchImpl = respondWith(200)
		vi.stubGlobal('fetch', fetchImpl)
		const db = fakeStream()
		const onStreamLost = vi.fn()

		renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		db.deliverFrame()
		await tick()
		db.deliverFrame()
		await tick()

		expect(fetchImpl).not.toHaveBeenCalled()
		expect(onStreamLost).not.toHaveBeenCalled()
	})

	test('does nothing before the stream has been read once', async () => {
		const fetchImpl = respondWith(404)
		vi.stubGlobal('fetch', fetchImpl)
		const onStreamLost = vi.fn()

		renderHook(() => useStreamLiveness({ db: fakeStream(), getAccessToken, enabled: false, onStreamLost }))
		await tick(2)

		expect(fetchImpl).not.toHaveBeenCalled()
		expect(onStreamLost).not.toHaveBeenCalled()
	})

	test('dates the rendered state instead of rebuilding when the origin is unreachable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
		)
		const db = fakeStream()
		const onStreamLost = vi.fn()

		const { result } = renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		const mountedAt = Date.now()
		await tick()

		expect(onStreamLost).not.toHaveBeenCalled()
		expect(result.current.staleSince).toBe(mountedAt)
	})

	test('clears the stale date once the stream answers again', async () => {
		let status = 500
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response(null, { status }))),
		)
		const db = fakeStream()
		const onStreamLost = vi.fn()

		const { result } = renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		await tick()
		expect(result.current.staleSince).not.toBeNull()

		status = 200
		await tick()
		expect(result.current.staleSince).toBeNull()
		expect(onStreamLost).not.toHaveBeenCalled()
	})

	test('gives up on a probe that never answers, so the next tick can probe again', async () => {
		const fetchImpl = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
				}),
		)
		vi.stubGlobal('fetch', fetchImpl)
		const db = fakeStream()
		const onStreamLost = vi.fn()

		const { result } = renderHook(() => useStreamLiveness({ db, getAccessToken, enabled: true, onStreamLost }))
		const mountedAt = Date.now()
		await tick()
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(result.current.staleSince).toBeNull()

		await act(async () => {
			vi.advanceTimersByTime(STREAM_PROBE_TIMEOUT_MS)
			await Promise.resolve()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(result.current.staleSince).toBe(mountedAt)

		await tick()
		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(onStreamLost).not.toHaveBeenCalled()
	})

	test('stops probing once unmounted', async () => {
		const fetchImpl = respondWith(200)
		vi.stubGlobal('fetch', fetchImpl)
		const onStreamLost = vi.fn()

		const { unmount } = renderHook(() =>
			useStreamLiveness({ db: fakeStream(), getAccessToken, enabled: true, onStreamLost }),
		)
		unmount()
		await tick(2)

		expect(fetchImpl).not.toHaveBeenCalled()
	})
})

describe('isNotFoundError', () => {
	test('accepts the oRPC shape', () => {
		expect(isNotFoundError({ code: 'NOT_FOUND' })).toBe(true)
	})

	test('accepts the durable-stream FetchError shape', () => {
		expect(isNotFoundError({ status: 404, code: undefined })).toBe(true)
	})

	test('rejects everything else', () => {
		expect(isNotFoundError({ status: 500 })).toBe(false)
		expect(isNotFoundError({ code: 'FORBIDDEN' })).toBe(false)
		expect(isNotFoundError(new Error('boom'))).toBe(false)
		expect(isNotFoundError(null)).toBe(false)
		expect(isNotFoundError('404')).toBe(false)
	})
})
