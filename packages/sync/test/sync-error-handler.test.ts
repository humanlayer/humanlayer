import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
	createElectricSyncErrorHandler as createProductionElectricSyncErrorHandler,
	createQuerySyncErrorHandler,
	isAuthLifecycleError,
	isFetchError,
} from '../src/sync-error-handler.ts'

function createElectricSyncErrorHandler(opts: Parameters<typeof createProductionElectricSyncErrorHandler>[0]) {
	return createProductionElectricSyncErrorHandler({ authErrorRetryDelayMs: 0, ...opts })
}

/**
 * Creates an error object that matches the FetchError shape from @electric-sql/client.
 * We use duck-typing (checking error.name === 'FetchError') because Vite may bundle
 * separate copies of the client, making instanceof checks unreliable.
 */
function createFetchError(status: number, message?: string): Error & { status: number; url: string } {
	const error = new Error(message ?? `HTTP ${status}`) as Error & { status: number; url: string }
	error.name = 'FetchError'
	error.status = status
	error.url = 'https://electric.example/v1/shape'
	return error
}

function createMockLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}
}

function mockConsoleError() {
	return vi.spyOn(console, 'error').mockImplementation(() => {})
}

async function invokeAfterRetryDelay<T>(invoke: () => T | Promise<T>): Promise<T> {
	const result = Promise.resolve(invoke())
	await vi.advanceTimersByTimeAsync(2_000)
	return result
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('isFetchError', () => {
	test('returns true for the Electric FetchError shape', () => {
		const error = createFetchError(401)
		expect(isFetchError(error)).toBe(true)
	})

	test('returns false for regular Error', () => {
		const error = new Error('something went wrong')
		expect(isFetchError(error)).toBe(false)
	})

	test('returns false for error with wrong name', () => {
		const error = new Error('HTTP 401') as Error & { status: number }
		error.name = 'HttpError'
		error.status = 401
		expect(isFetchError(error)).toBe(false)
	})

	test('returns false for error without status', () => {
		const error = new Error('failed')
		error.name = 'FetchError'
		expect(isFetchError(error)).toBe(false)
	})

	test('returns false for error without the Electric shape URL', () => {
		const error = new Error('HTTP 401') as Error & { status: number }
		error.name = 'FetchError'
		error.status = 401
		expect(isFetchError(error)).toBe(false)
	})
})

describe('isAuthLifecycleError', () => {
	test('true for 401 and 403 FetchError', () => {
		expect(isAuthLifecycleError(createFetchError(401))).toBe(true)
		expect(isAuthLifecycleError(createFetchError(403))).toBe(true)
	})

	test('true for AccessTokenUnavailableError by name', () => {
		const error = new Error('token unavailable')
		error.name = 'AccessTokenUnavailableError'
		expect(isAuthLifecycleError(error)).toBe(true)
	})

	test('true for WorkOS "No access token available" message', () => {
		expect(isAuthLifecycleError(new Error('No access token available'))).toBe(true)
	})

	test('true for oRPC UNAUTHORIZED code', () => {
		const error = new Error('Unauthorized') as Error & { code: string }
		error.code = 'UNAUTHORIZED'
		expect(isAuthLifecycleError(error)).toBe(true)
	})

	test('false for a 404 FetchError', () => {
		expect(isAuthLifecycleError(createFetchError(404))).toBe(false)
	})

	test('false for a generic error', () => {
		expect(isAuthLifecycleError(new Error('network failure'))).toBe(false)
	})
})

describe('createQuerySyncErrorHandler', () => {
	test('does not report auth-lifecycle errors to Sentry', () => {
		const captureException = vi.fn()
		const handler = createQuerySyncErrorHandler({
			collectionName: 'sessions',
			syncMode: 'query',
			captureException,
		})

		handler(new Error('No access token available'))
		handler(createFetchError(401))

		expect(captureException).not.toHaveBeenCalled()
	})

	test('reports real errors with sync tags', () => {
		const captureException = vi.fn()
		const handler = createQuerySyncErrorHandler({
			collectionName: 'sessions',
			syncMode: 'query',
			captureException,
		})
		const error = new Error('network failure')

		handler(error)

		expect(captureException).toHaveBeenCalledWith(error, {
			tags: { 'sync.mode': 'query', 'sync.collection': 'sessions' },
		})
	})
})

describe('createElectricSyncErrorHandler', () => {
	describe('401 Unauthorized', () => {
		test('returns {} to signal retry', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			const result = await invokeAfterRetryDelay(() => handler(createFetchError(401)))

			expect(result).toEqual({})
		})

		test('waits approximately 2 seconds before returning', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				authErrorRetryDelayMs: 2_000,
			})

			const start = performance.now()
			await invokeAfterRetryDelay(() => handler(createFetchError(401)))
			const elapsed = performance.now() - start

			// Allow some tolerance for timing
			expect(elapsed).toBeGreaterThanOrEqual(1900)
			expect(elapsed).toBeLessThan(2500)
		})

		test('logs info message', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			await invokeAfterRetryDelay(() => handler(createFetchError(401)))

			expect(logger.info).toHaveBeenCalledTimes(1)
			expect(logger.info.mock.calls[0][0]).toContain('Auth error (401)')
			expect(logger.info.mock.calls[0][0]).toContain('sessions')
		})

		test('does not capture exception to Sentry', async () => {
			const logger = createMockLogger()
			const captureException = vi.fn()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				captureException,
			})

			await invokeAfterRetryDelay(() => handler(createFetchError(401)))

			expect(captureException).not.toHaveBeenCalled()
		})
	})

	describe('403 Forbidden', () => {
		test('returns {} to signal retry', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			const result = await invokeAfterRetryDelay(() => handler(createFetchError(403)))

			expect(result).toEqual({})
		})

		test('logs info message', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			await invokeAfterRetryDelay(() => handler(createFetchError(403)))

			expect(logger.info).toHaveBeenCalledTimes(1)
			expect(logger.info.mock.calls[0][0]).toContain('Auth error (403)')
		})
	})

	describe('404 Not Found', () => {
		test('returns undefined to stop sync', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			const result = await handler(createFetchError(404))

			expect(result).toBeUndefined()
		})

		test('logs error and captures to Sentry', async () => {
			const logger = createMockLogger()
			const captureException = vi.fn()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				captureException,
			})

			await handler(createFetchError(404))

			expect(logger.error).toHaveBeenCalled()
			expect(captureException).toHaveBeenCalled()
		})
	})

	describe('409 Conflict (Electric control flow)', () => {
		test('returns {} immediately for re-sync', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			const start = performance.now()
			const result = await handler(createFetchError(409))
			const elapsed = performance.now() - start

			expect(result).toEqual({})
			// Should not have the 2s delay
			expect(elapsed).toBeLessThan(100)
		})
	})

	describe('unknown errors', () => {
		test('returns {} when shouldRetryOnFailure is true', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
			})

			const result = await handler(new Error('network failure'))

			expect(result).toEqual({})
		})

		test('returns undefined when shouldRetryOnFailure is false', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: false,
				logger: logger as any,
			})

			const result = await handler(new Error('network failure'))

			expect(result).toBeUndefined()
		})

		test('captures exception to Sentry', async () => {
			const logger = createMockLogger()
			const captureException = vi.fn()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				captureException,
			})

			await handler(new Error('network failure'))

			expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
				tags: { 'sync.mode': 'electric', 'sync.collection': 'sessions' },
			})
		})
	})

	describe('AccessTokenUnavailableError (browser auth)', () => {
		class AccessTokenUnavailableError extends Error {
			constructor() {
				super('token unavailable')
				this.name = 'AccessTokenUnavailableError'
			}
		}

		test('returns {} to signal retry when past initial load (shouldRetryOnFailure)', async () => {
			const consoleError = mockConsoleError()
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				isAuthUnavailableError: (e) => e instanceof AccessTokenUnavailableError,
			})

			try {
				const result = await invokeAfterRetryDelay(() => handler(new AccessTokenUnavailableError()))

				expect(result).toEqual({})
			} finally {
				consoleError.mockRestore()
			}
		})

		test('returns undefined to stop sync during initial load (shouldRetryOnFailure false)', async () => {
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: false,
				logger: logger as any,
				isAuthUnavailableError: (e) => e instanceof AccessTokenUnavailableError,
			})

			const result = await handler(new AccessTokenUnavailableError())

			expect(result).toBeUndefined()
		})

		test('logs warning', async () => {
			const consoleError = mockConsoleError()
			const logger = createMockLogger()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				isAuthUnavailableError: (e) => e instanceof AccessTokenUnavailableError,
			})

			try {
				await invokeAfterRetryDelay(() => handler(new AccessTokenUnavailableError()))

				expect(logger.warn).toHaveBeenCalled()
				expect(logger.warn.mock.calls[0][0]).toContain('Access token unavailable')
			} finally {
				consoleError.mockRestore()
			}
		})

		test('logs console error once per handler without capturing to Sentry', async () => {
			const consoleError = mockConsoleError()
			const logger = createMockLogger()
			const captureException = vi.fn()
			const handler = createElectricSyncErrorHandler({
				collectionName: 'sessions',
				shouldRetryOnFailure: true,
				logger: logger as any,
				captureException,
				isAuthUnavailableError: (e) => e instanceof AccessTokenUnavailableError,
			})

			try {
				const error = new AccessTokenUnavailableError()
				await invokeAfterRetryDelay(() => handler(error))
				await invokeAfterRetryDelay(() => handler(new AccessTokenUnavailableError()))

				expect(consoleError).toHaveBeenCalledTimes(1)
				expect(consoleError).toHaveBeenCalledWith('Electric sync auth token unavailable for sessions', error)
				expect(captureException).not.toHaveBeenCalled()
			} finally {
				consoleError.mockRestore()
			}
		}, 10_000)
	})
})
