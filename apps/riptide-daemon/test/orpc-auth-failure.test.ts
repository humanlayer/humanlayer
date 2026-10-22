import { describe, expect, test } from 'vitest'

/**
 * Test the auth failure detection logic used in oRPC shouldRetry.
 * We test the predicate directly since the oRPC plugin doesn't expose shouldRetry for testing.
 */

function isAuthFailure(error: unknown): boolean {
	if (
		error != null &&
		typeof error === 'object' &&
		'defined' in error &&
		(error as { defined: boolean }).defined === true &&
		'status' in error
	) {
		const status = (error as { status: number }).status
		return status === 401 || status === 403
	}
	return false
}

describe('oRPC auth failure detection', () => {
	test('detects 401 UNAUTHORIZED as auth failure', () => {
		const error = { defined: true, code: 'UNAUTHORIZED', status: 401, data: undefined }
		expect(isAuthFailure(error)).toBe(true)
	})

	test('detects 403 FORBIDDEN as auth failure', () => {
		const error = { defined: true, code: 'FORBIDDEN', status: 403, data: undefined }
		expect(isAuthFailure(error)).toBe(true)
	})

	test('does not treat 500 as auth failure', () => {
		const error = { defined: true, code: 'INTERNAL_SERVER_ERROR', status: 500, data: undefined }
		expect(isAuthFailure(error)).toBe(false)
	})

	test('does not treat 400 as auth failure', () => {
		const error = { defined: true, code: 'BAD_REQUEST', status: 400, data: undefined }
		expect(isAuthFailure(error)).toBe(false)
	})

	test('does not treat non-defined errors as auth failure', () => {
		const error = new Error('Network error')
		expect(isAuthFailure(error)).toBe(false)
	})

	test('does not treat null/undefined as auth failure', () => {
		expect(isAuthFailure(null)).toBe(false)
		expect(isAuthFailure(undefined)).toBe(false)
	})
})
