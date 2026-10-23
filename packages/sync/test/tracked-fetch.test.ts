import { describe, expect, test, vi } from 'vitest'

import { CollectionHealthTracker } from '../src/health-tracker.ts'
import { createTrackedFetchClient } from '../src/tracked-fetch.ts'

function makeMockResponse(status: number): Response {
	return new Response(null, { status })
}

function makeTracker() {
	// errorThreshold: 1 so a single recordElectricError flips to query — keeps these tests
	// focused on what tracked-fetch records. The threshold gating is tested in health-tracker.
	return new CollectionHealthTracker({ collections: ['sessions'], errorThreshold: 1 })
}

describe('createTrackedFetchClient', () => {
	describe('5XX responses', () => {
		test('calls recordElectricError on 500', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(500))
			const trackedFetch = createTrackedFetchClient(tracker, 'sessions')

			// Override global fetch for this call
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await trackedFetch('https://example.com')
				expect(tracker.getMode('sessions')).toBe('query')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('calls recordElectricError on 503', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(503))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(tracker.getMode('sessions')).toBe('query')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('calls recordElectricError on 599', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(599))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(tracker.getMode('sessions')).toBe('query')
			} finally {
				globalThis.fetch = originalFetch
			}
		})
	})

	describe('2XX responses', () => {
		test('calls recordElectricSuccess on 200', async () => {
			const tracker = makeTracker()
			// First put it in query mode
			tracker.recordElectricError('sessions')
			expect(tracker.getMode('sessions')).toBe('query')

			const fetchMock = vi.fn(async () => makeMockResponse(200))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				// 3 successes needed to recover
				const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
				await trackedFetch('https://example.com')
				await trackedFetch('https://example.com')
				await trackedFetch('https://example.com')
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('calls recordElectricSuccess on 204', async () => {
			const tracker = makeTracker()
			// Verify success is recorded by checking counter via recovery
			tracker.recordElectricError('sessions')
			const fetchMock = vi.fn(async () => makeMockResponse(204))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				const trackedFetch = createTrackedFetchClient(tracker, 'sessions')
				await trackedFetch('https://example.com')
				await trackedFetch('https://example.com')
				await trackedFetch('https://example.com')
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})
	})

	describe('non-5XX error responses (ignored)', () => {
		test('does not record error on 4XX', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(404))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				// Should still be in electric mode — 4XX is not an Electric failure
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('does not record error on 400', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(400))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('does not record error on 3XX redirect', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => makeMockResponse(301))
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})
	})

	describe('AbortError handling', () => {
		test('does not record error on AbortError', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => {
				throw new DOMException('The operation was aborted.', 'AbortError')
			})
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await expect(createTrackedFetchClient(tracker, 'sessions')('https://example.com')).rejects.toThrow(
					'The operation was aborted.',
				)
				// Should still be in electric mode — AbortError is not an Electric failure
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('still records error on non-AbortError network failures', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => {
				throw new TypeError('Failed to fetch')
			})
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await expect(createTrackedFetchClient(tracker, 'sessions')('https://example.com')).rejects.toThrow(
					'Failed to fetch',
				)
				expect(tracker.getMode('sessions')).toBe('query')
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('does not record error when Electric throws a raw string during abort cycle', async () => {
			const tracker = makeTracker()
			const fetchMock = vi.fn(async () => {
				throw 'This request has been terminated'
			})
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				await expect(createTrackedFetchClient(tracker, 'sessions')('https://example.com')).rejects.toThrow()
				expect(tracker.getMode('sessions')).toBe('electric')
			} finally {
				globalThis.fetch = originalFetch
			}
		})
	})

	describe('response passthrough', () => {
		test('returns the original response unchanged', async () => {
			const tracker = makeTracker()
			const expectedResponse = makeMockResponse(200)
			const fetchMock = vi.fn(async () => expectedResponse)
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				const result = await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(result).toBe(expectedResponse)
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('returns 5XX response unchanged (caller still gets it)', async () => {
			const tracker = makeTracker()
			const errorResponse = makeMockResponse(503)
			const fetchMock = vi.fn(async () => errorResponse)
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				const result = await createTrackedFetchClient(tracker, 'sessions')('https://example.com')
				expect(result).toBe(errorResponse)
				expect(result.status).toBe(503)
			} finally {
				globalThis.fetch = originalFetch
			}
		})

		test('forwards request init options to underlying fetch', async () => {
			const tracker = makeTracker()
			let capturedInit: RequestInit | undefined
			const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedInit = init
				return makeMockResponse(200)
			})
			const originalFetch = globalThis.fetch
			globalThis.fetch = fetchMock as unknown as typeof fetch

			try {
				const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
				await createTrackedFetchClient(tracker, 'sessions')('https://example.com', init)
				expect(capturedInit).toEqual(init)
			} finally {
				globalThis.fetch = originalFetch
			}
		})
	})
})
