import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }))

import { probeStream, STREAM_PROBE_TIMEOUT_MS } from './stream-liveness-probe'

const URL = 'http://sync.example/v2/streams/org/github/repos/humanlayer%2Fsyncopate/branches/main/pr-status'
const token = async () => 'token-1'

const respondWith = (status: number) => vi.fn(async () => new Response(null, { status }))

describe('probeStream', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test('sends one HEAD with the bearer token', async () => {
		const fetchImpl = respondWith(200)
		vi.stubGlobal('fetch', fetchImpl)

		await expect(probeStream(URL, token)).resolves.toEqual({ outcome: 'current' })

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe(URL)
		expect(init.method).toBe('HEAD')
		expect(init.headers).toEqual({ Authorization: 'Bearer token-1' })
	})

	test('sends no Authorization header when there is no token', async () => {
		const fetchImpl = respondWith(200)
		vi.stubGlobal('fetch', fetchImpl)

		await probeStream(URL, async () => null)

		expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({})
	})

	test('reports the stream gone on 404', async () => {
		vi.stubGlobal('fetch', respondWith(404))

		await expect(probeStream(URL, token)).resolves.toEqual({ outcome: 'gone' })
	})

	test.each([401, 403, 500, 502, 503])('reports %s as refused, with the status', async (status) => {
		vi.stubGlobal('fetch', respondWith(status))

		await expect(probeStream(URL, token)).resolves.toEqual({ outcome: 'unreachable', reason: 'refused', status })
	})

	test('reports a failed request as a network problem, carrying the error', async () => {
		const error = new TypeError('Failed to fetch')
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(error)),
		)

		await expect(probeStream(URL, token)).resolves.toEqual({ outcome: 'unreachable', reason: 'network', error })
	})

	test('aborts a HEAD that never answers once the timeout passes', async () => {
		const fetchImpl = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
				}),
		)
		vi.stubGlobal('fetch', fetchImpl)

		const probe = probeStream(URL, token)
		await vi.advanceTimersByTimeAsync(STREAM_PROBE_TIMEOUT_MS - 1)
		expect(fetchImpl.mock.calls[0]?.[1].signal?.aborted).toBe(false)

		await vi.advanceTimersByTimeAsync(1)
		const result = await probe
		expect(result.outcome).toBe('unreachable')
		expect(result).toMatchObject({ reason: 'network' })
		expect(fetchImpl.mock.calls[0]?.[1].signal?.aborted).toBe(true)
	})

	test('honours a caller-supplied timeout', async () => {
		const fetchImpl = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
				}),
		)
		vi.stubGlobal('fetch', fetchImpl)

		const probe = probeStream(URL, token, 250)
		await vi.advanceTimersByTimeAsync(250)

		await expect(probe).resolves.toMatchObject({ outcome: 'unreachable', reason: 'network' })
	})

	test('clears its timer after an answer, so nothing fires later', async () => {
		vi.stubGlobal('fetch', respondWith(200))

		await probeStream(URL, token)

		expect(vi.getTimerCount()).toBe(0)
	})

	test('treats a token lookup failure as a network problem', async () => {
		const fetchImpl = respondWith(200)
		vi.stubGlobal('fetch', fetchImpl)
		const error = new Error('session expired')

		await expect(probeStream(URL, () => Promise.reject(error))).resolves.toEqual({
			outcome: 'unreachable',
			reason: 'network',
			error,
		})
		expect(fetchImpl).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	})
})
