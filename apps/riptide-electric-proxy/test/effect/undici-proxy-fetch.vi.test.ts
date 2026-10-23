import { Readable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { createRequestProxyWithSocketPool } from '../../src/lib/effect/undici-proxy-fetch'

function mockUndiciResponse(
	body: string | Uint8Array,
	init?: { statusCode?: number; headers?: Record<string, string> },
) {
	// Real undici request() bodies always yield Buffer/Uint8Array chunks; Node's
	// Response constructor rejects string chunks (Bun's runtime used to tolerate them).
	const chunk = typeof body === 'string' ? new TextEncoder().encode(body) : body
	return {
		statusCode: init?.statusCode ?? 200,
		headers: init?.headers ?? { 'content-type': 'text/plain' },
		body: Readable.from([chunk]),
	}
}

describe('createRequestProxyWithSocketPool', () => {
	it('passes through status, headers, and body', async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(
				mockUndiciResponse('hello', { statusCode: 201, headers: { 'x-upstream': 'electric' } }),
			)

		const response = await createRequestProxyWithSocketPool(
			{} as never,
			() => {},
			request as never,
		)('http://electric.test/shape')

		expect(response.status).toBe(201)
		expect(response.headers.get('x-upstream')).toBe('electric')
		expect(await response.text()).toBe('hello')
	})

	it('does not delegate to native fetch', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = vi.fn(() => Promise.reject(new Error('native fetch should not be called'))) as never
		const request = vi.fn().mockResolvedValueOnce(mockUndiciResponse('ok'))

		try {
			const response = await createRequestProxyWithSocketPool(
				{} as never,
				() => {},
				request as never,
			)('http://electric.test/shape')
			expect(await response.text()).toBe('ok')
			expect(globalThis.fetch).not.toHaveBeenCalled()
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it('preserves compressed bytes without auto-decompression', async () => {
		const gzipBytes = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0])
		const request = vi
			.fn()
			.mockResolvedValueOnce(
				mockUndiciResponse(gzipBytes, { headers: { 'content-encoding': 'gzip', 'content-length': '8' } }),
			)

		const response = await createRequestProxyWithSocketPool(
			{} as never,
			() => {},
			request as never,
		)('http://electric.test/shape')

		expect(response.headers.get('content-encoding')).toBe('gzip')
		expect(response.headers.get('content-length')).toBe('8')
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(gzipBytes)
	})

	it('propagates abort signals and uses the supplied pool dispatcher', async () => {
		const pool = { name: 'electric-pool' }
		const abortController = new AbortController()
		const request = vi.fn().mockResolvedValueOnce(mockUndiciResponse('ok'))

		await createRequestProxyWithSocketPool(
			pool as never,
			() => {},
			request as never,
		)('http://electric.test/shape', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
			signal: abortController.signal,
		})

		expect(request).toHaveBeenCalledWith(
			'http://electric.test/shape',
			expect.objectContaining({
				dispatcher: pool,
				signal: abortController.signal,
				method: 'POST',
				body: '{}',
			}),
		)
	})

	it('materializes Web ReadableStream request bodies for Bun undici', async () => {
		const request = vi.fn().mockResolvedValueOnce(mockUndiciResponse('ok'))
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"event":"partial"}'))
				controller.close()
			},
		})

		await createRequestProxyWithSocketPool(
			{} as never,
			() => {},
			request as never,
		)('http://durable.test/v1/stream/session-id', { method: 'POST', body, duplex: 'half' } as RequestInit)

		const requestBody = request.mock.calls[0]?.[1]?.body
		expect(requestBody).toBeInstanceOf(Uint8Array)
		expect(new TextDecoder().decode(requestBody)).toBe('{"event":"partial"}')
	})

	it('forwards null-body statuses (204/205/304) with a null body', async () => {
		for (const status of [204, 205, 304]) {
			const request = vi.fn().mockResolvedValueOnce(mockUndiciResponse('unexpected body', { statusCode: status }))

			const response = await createRequestProxyWithSocketPool(
				{} as never,
				() => {},
				request as never,
			)('http://electric.test/shape')

			expect(response.status).toBe(status)
			expect(response.body).toBeNull()
		}
	})

	it('routes a mid-stream upstream body error to onStreamError', async () => {
		const onStreamError = vi.fn()
		const body = new Readable({ read() {} })
		const request = vi.fn().mockResolvedValueOnce({ statusCode: 200, headers: {}, body })

		await createRequestProxyWithSocketPool(
			{} as never,
			onStreamError,
			request as never,
		)('http://electric.test/shape')

		const socketError = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
		body.emit('error', socketError)
		expect(onStreamError).toHaveBeenCalledWith(socketError)
	})
})
