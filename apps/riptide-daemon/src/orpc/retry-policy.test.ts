import { describe, expect, test } from 'vitest'

import { getHttpStatus, shouldRetryORPCRequest } from './retry-policy'

describe('oRPC retry policy', () => {
	test.each([400, 401, 402, 403, 404, 413, 422])('does not retry HTTP %i', (status) => {
		expect(shouldRetryORPCRequest({ status })).toBe(false)
	})

	test.each([408, 425, 429, 500, 502, 503])('retries transient HTTP %i', (status) => {
		expect(shouldRetryORPCRequest({ status })).toBe(true)
	})

	test('retries transport errors without an HTTP status', () => {
		expect(shouldRetryORPCRequest(new Error('fetch failed'))).toBe(true)
	})

	test('reads status from undefined oRPC transport errors', () => {
		const error = { defined: false, response: { status: 413 } }

		expect(getHttpStatus(error)).toBe(413)
		expect(shouldRetryORPCRequest(error)).toBe(false)
	})

	test('reads status from a nested cause', () => {
		const error = new Error('request failed', { cause: { status: 422 } })

		expect(getHttpStatus(error)).toBe(422)
		expect(shouldRetryORPCRequest(error)).toBe(false)
	})
})
