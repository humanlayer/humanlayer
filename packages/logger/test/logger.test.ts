import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { LogTransport } from '../src/logger/abstract-transport'
import { Logger } from '../src/logger/logger'
import type { JsonValue, LogLevel } from '../src/logger/types'

/**
 * MockTransport for testing - tracks all calls to send() and shutdown()
 */
class MockTransport extends LogTransport {
	public readonly level: LogLevel

	public send = vi.fn<
		(props: { msg?: string; data?: JsonValue; logger?: string; level: LogLevel; timestamp: number }) => void
	>(() => {})

	public shutdown = vi.fn<() => void>(() => {})

	constructor(level: LogLevel = 'debug') {
		super()
		this.level = level
	}

	public reset() {
		this.send.mockClear()
		this.shutdown.mockClear()
	}
}

describe('Logger', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('basic logging', () => {
		let transport: MockTransport
		let logger: Logger

		beforeEach(() => {
			transport = new MockTransport('debug')
			logger = new Logger({
				transports: [transport],
				name: 'test-logger',
				properties: { env: 'test' },
			})
		})

		afterEach(async () => {
			await logger.shutdown()
		})

		test('calls transport.send when logging a string message', async () => {
			await logger.info('Hello, world!')

			expect(transport.send).toHaveBeenCalled()
			expect(transport.send).toHaveBeenCalledTimes(1)
		})

		test('passes correct level to transport', async () => {
			await logger.warn('Warning message')

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					level: 'warn',
					msg: 'Warning message',
				}),
			)
		})

		test('includes logger name in send call', async () => {
			await logger.info('Test')

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					logger: 'test-logger',
				}),
			)
		})

		test('includes properties in data', async () => {
			await logger.info('Test')

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.data).toMatchObject({ env: 'test' })
		})

		test('logs object with message', async () => {
			await logger.info({ userId: 123 }, 'User logged in')
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'User logged in',
					level: 'info',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]

			// @ts-expect-error - data.data is now an array of serialized objects
			expect(callArgs?.data?.data).toEqual([{ userId: 123 }])
		})

		test('logs Error with message extracted', async () => {
			const error = new Error('Something went wrong')
			await logger.error(error)
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Something went wrong',
					level: 'error',
				}),
			)
		})
	})

	describe('level filtering', () => {
		test('does NOT call send when log level is below transport level', async () => {
			const transport = new MockTransport('error') // only error and fatal
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.silly('should not log')
			await logger.debug('should not log')
			await logger.http('should not log')
			await logger.info('should not log')
			await logger.warn('should not log')

			expect(transport.send).not.toHaveBeenCalled()
			await logger.shutdown()
		})

		test('calls send when log level equals transport level', async () => {
			const transport = new MockTransport('warn')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.warn('should log')

			expect(transport.send).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('calls send when log level exceeds transport level', async () => {
			const transport = new MockTransport('warn')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.error('should log')
			await logger.fatal('should also log')

			expect(transport.send).toHaveBeenCalledTimes(2)
			await logger.shutdown()
		})

		test('transport at silly level receives all log levels', async () => {
			const transport = new MockTransport('silly')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.silly('1')
			await logger.debug('2')
			await logger.http('3')
			await logger.info('4')
			await logger.warn('5')
			await logger.error('6')
			await logger.fatal('7')

			expect(transport.send).toHaveBeenCalledTimes(7)
			await logger.shutdown()
		})

		test('transport at fatal level only receives fatal logs', async () => {
			const transport = new MockTransport('fatal')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.silly('no')
			await logger.debug('no')
			await logger.http('no')
			await logger.info('no')
			await logger.warn('no')
			await logger.error('no')
			await logger.fatal('yes')

			expect(transport.send).toHaveBeenCalledTimes(1)
			expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ level: 'fatal', msg: 'yes' }))
			await logger.shutdown()
		})
	})

	describe('multiple transports with different levels', () => {
		test('each transport receives logs independently based on its level', async () => {
			const debugTransport = new MockTransport('debug')
			const warnTransport = new MockTransport('warn')
			const errorTransport = new MockTransport('error')

			const logger = new Logger({
				transports: [debugTransport, warnTransport, errorTransport],
				name: 'multi-transport',
				properties: {},
			})

			await logger.debug('debug message')
			await logger.info('info message')
			await logger.warn('warn message')
			await logger.error('error message')

			// debug transport gets all 4
			expect(debugTransport.send).toHaveBeenCalledTimes(4)

			// warn transport gets warn + error (2)
			expect(warnTransport.send).toHaveBeenCalledTimes(2)

			// error transport gets only error (1)
			expect(errorTransport.send).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('one transport failing does not affect others', async () => {
			const goodTransport = new MockTransport('debug')
			const badTransport = new MockTransport('debug')
			badTransport.send.mockImplementation(() => {
				throw new Error('Transport failed!')
			})

			const logger = new Logger({
				transports: [badTransport, goodTransport],
				name: 'test',
				properties: {},
			})

			await logger.info('test message')

			// Bad transport was called (and threw)
			expect(badTransport.send).toHaveBeenCalledTimes(1)
			// Good transport was still called
			expect(goodTransport.send).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})
	})

	describe('onTransportError', () => {
		test('calls onTransportError when transport throws', async () => {
			const onTransportError = vi.fn(() => {})
			const badTransport = new MockTransport('debug')
			const thrownError = new Error('Transport exploded!')
			badTransport.send.mockImplementation(() => {
				throw thrownError
			})

			const logger = new Logger({
				transports: [badTransport],
				name: 'test',
				properties: {},
				onTransportError,
			})

			await logger.info('test')

			expect(onTransportError).toHaveBeenCalledTimes(1)
			expect(onTransportError).toHaveBeenCalledWith(thrownError)
			await logger.shutdown()
		})

		test('does not throw if onTransportError throws', async () => {
			const onTransportError = vi.fn(() => {
				throw new Error('Error handler also failed!')
			})
			const badTransport = new MockTransport('debug')
			badTransport.send.mockImplementation(() => {
				throw new Error('Transport failed')
			})

			const logger = new Logger({
				transports: [badTransport],
				name: 'test',
				properties: {},
				onTransportError,
			})

			// Should not throw
			expect(() => logger.info('test')).not.toThrow()
			await logger.shutdown()
		})

		test('calls onTransportError when transport rejects', async () => {
			const onTransportError = vi.fn(() => {})
			const badTransport = new MockTransport('debug')
			const rejectedError = new Error('Async transport failed!')
			badTransport.send.mockRejectedValue(rejectedError)

			const logger = new Logger({
				transports: [badTransport],
				name: 'test',
				properties: {},
				onTransportError,
			})

			await logger.info('test')
			await vi.waitFor(() => expect(onTransportError).toHaveBeenCalledWith(rejectedError))
			await logger.shutdown()
		})
	})

	describe('shutdown', () => {
		test('waits for pending logs before shutting down transports', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			logger.info({ requestId: 'request-1' }, 'request complete')
			await logger.shutdown()

			expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ msg: 'request complete' }))
			expect(transport.shutdown).toHaveBeenCalledTimes(1)
		})

		test('parent shutdown waits for pending child logs', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'parent',
				properties: {},
			})

			logger.child('child').info({ requestId: 'request-1' }, 'child request complete')
			await logger.shutdown()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({ logger: 'child', msg: 'child request complete' }),
			)
		})

		test('calls shutdown on all transports', async () => {
			const transport1 = new MockTransport('debug')
			const transport2 = new MockTransport('info')
			const transport3 = new MockTransport('error')

			const logger = new Logger({
				transports: [transport1, transport2, transport3],
				name: 'test',
				properties: {},
			})

			await logger.shutdown()

			expect(transport1.shutdown).toHaveBeenCalledTimes(1)
			expect(transport2.shutdown).toHaveBeenCalledTimes(1)
			expect(transport3.shutdown).toHaveBeenCalledTimes(1)
		})

		test('shutdown completes even if one transport rejects', async () => {
			const goodTransport = new MockTransport('debug')
			const badTransport = new MockTransport('debug')
			badTransport.shutdown.mockImplementation(() => {
				return Promise.reject(new Error('Shutdown failed!'))
			})

			const logger = new Logger({
				transports: [badTransport, goodTransport],
				name: 'test',
				properties: {},
			})

			// Should not throw (uses Promise.allSettled)
			await expect(logger.shutdown()).resolves.toBeUndefined()

			expect(badTransport.shutdown).toHaveBeenCalledTimes(1)
			expect(goodTransport.shutdown).toHaveBeenCalledTimes(1)
		})

		test('shutdown handles async transports', async () => {
			const asyncTransport = new MockTransport('debug')
			asyncTransport.shutdown.mockImplementation(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10))
			})

			const logger = new Logger({
				transports: [asyncTransport],
				name: 'test',
				properties: {},
			})

			await logger.shutdown()

			expect(asyncTransport.shutdown).toHaveBeenCalledTimes(1)
		})
	})

	describe('child logger', () => {
		test('child logger shares transports with parent', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'parent',
				properties: { app: 'test' },
			})

			const child = logger.child('child-context', { requestId: '123' })

			await child.info('child message')

			expect(transport.send).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('child logger inherits parent properties and adds its own', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'parent',
				properties: { app: 'test' },
			})

			const child = logger.child('child', { requestId: 'abc-123' })

			await child.info('request handled')

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.data).toMatchObject({
				app: 'test',
				requestId: 'abc-123',
			})
			await logger.shutdown()
		})

		test('child logger respects transport level filtering', async () => {
			const transport = new MockTransport('error')
			const logger = new Logger({
				transports: [transport],
				name: 'parent',
				properties: {},
			})

			const child = logger.child('child')

			await child.debug('should not log')
			await child.info('should not log')
			await child.warn('should not log')
			await child.error('should log')

			expect(transport.send).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})
	})

	describe('all log level methods', () => {
		const levels: LogLevel[] = ['silly', 'debug', 'http', 'info', 'warn', 'error', 'fatal']

		for (const level of levels) {
			test(`logger.${level}() sends correct level`, async () => {
				const transport = new MockTransport('silly')
				const logger = new Logger({
					transports: [transport],
					name: 'test',
					properties: {},
				})

				await logger[level](`${level} message`)

				expect(transport.send).toHaveBeenCalledWith(
					expect.objectContaining({
						level,
						msg: `${level} message`,
					}),
				)
				await logger.shutdown()
			})
		}
	})

	describe('timestamps', () => {
		test('includes timestamp in send call', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			const before = Date.now()
			await logger.info('test message')
			const after = Date.now()

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.timestamp).toBeDefined()
			expect(callArgs?.timestamp).toBeGreaterThanOrEqual(before)
			expect(callArgs?.timestamp).toBeLessThanOrEqual(after)
			await logger.shutdown()
		})

		test('all transports receive the same timestamp for a single log call', async () => {
			const transport1 = new MockTransport('debug')
			const transport2 = new MockTransport('debug')
			const transport3 = new MockTransport('debug')

			const logger = new Logger({
				transports: [transport1, transport2, transport3],
				name: 'test',
				properties: {},
			})

			await logger.info('test message')

			const timestamp1 = transport1.send.mock.calls[0]?.[0]?.timestamp
			const timestamp2 = transport2.send.mock.calls[0]?.[0]?.timestamp
			const timestamp3 = transport3.send.mock.calls[0]?.[0]?.timestamp

			expect(timestamp1).toBeDefined()
			expect(timestamp1).toBe(timestamp2)
			expect(timestamp2).toBe(timestamp3)
			await logger.shutdown()
		})

		test('different log calls have different timestamps', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'test',
				properties: {},
			})

			await logger.info('first message')
			await new Promise((resolve) => setTimeout(resolve, 5))
			await logger.info('second message')

			const timestamp1 = transport.send.mock.calls[0]?.[0]?.timestamp
			const timestamp2 = transport.send.mock.calls[1]?.[0]?.timestamp

			expect(timestamp1).toBeDefined()
			expect(timestamp2).toBeDefined()
			expect(timestamp2).toBeGreaterThan(timestamp1!)
			await logger.shutdown()
		})

		test('child logger generates its own timestamps', async () => {
			const transport = new MockTransport('debug')
			const logger = new Logger({
				transports: [transport],
				name: 'parent',
				properties: {},
			})

			const child = logger.child('child')

			await logger.info('parent message')
			await new Promise((resolve) => setTimeout(resolve, 5))
			await child.info('child message')

			const parentTimestamp = transport.send.mock.calls[0]?.[0]?.timestamp
			const childTimestamp = transport.send.mock.calls[1]?.[0]?.timestamp

			expect(parentTimestamp).toBeDefined()
			expect(childTimestamp).toBeDefined()
			expect(childTimestamp).toBeGreaterThan(parentTimestamp!)
			await logger.shutdown()
		})
	})

	describe('variadic arguments', () => {
		let transport: MockTransport
		let logger: Logger

		beforeEach(() => {
			transport = new MockTransport('debug')
			logger = new Logger({
				transports: [transport],
				name: 'test-logger',
				properties: { env: 'test' },
			})
		})

		afterEach(async () => {
			await logger.shutdown()
		})

		test('single string argument', async () => {
			await logger.info('Hello, world!')

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Hello, world!',
					level: 'info',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.data).toMatchObject({ env: 'test' })
			expect(callArgs?.data).not.toHaveProperty('data')
		})

		test('multiple string arguments are joined', async () => {
			await logger.info('User', '123', 'logged in')

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'User 123 logged in',
				}),
			)
		})

		test('numbers and booleans are converted to strings in message', async () => {
			await logger.info('Count:', 42, 'active:', true)

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Count: 42 active: true',
				}),
			)
		})

		test('single object argument creates data array', async () => {
			await logger.info({ userId: 123 })
			await logger.flush()

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.msg).toBeUndefined()
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ userId: 123 }])
		})

		test('object with string creates message and data array', async () => {
			await logger.info({ userId: 123 }, 'User logged in')
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'User logged in',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ userId: 123 }])
		})

		test('string then object (console.log style)', async () => {
			await logger.info('User logged in', { userId: 123 })
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'User logged in',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ userId: 123 }])
		})

		test('multiple objects are collected into array', async () => {
			await logger.info({ a: 1 }, { b: 2 })
			await logger.flush()

			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ a: 1 }, { b: 2 }])
		})

		test('mixed strings and objects', async () => {
			await logger.info('Start', { a: 1 }, 'middle', { b: 2 }, 'end')
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Start middle end',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ a: 1 }, { b: 2 }])
		})

		test('error only uses error message as msg', async () => {
			const error = new Error('Something went wrong')
			await logger.error(error)
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Something went wrong',
					level: 'error',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toHaveLength(1)
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data?.[0]).toMatchObject({
				name: 'Error',
				message: 'Something went wrong',
			})
		})

		test('error with string uses string as msg', async () => {
			const error = new Error('Original error')
			await logger.error('Failed to process:', error)
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Failed to process:',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data?.[0]).toMatchObject({
				name: 'Error',
				message: 'Original error',
			})
		})

		test('string then error (console.log style)', async () => {
			const error = new Error('Connection failed')
			await logger.error('Database error:', error)
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Database error:',
				}),
			)
		})

		test('error then string (pino style - backwards compatible)', async () => {
			const error = new Error('Connection failed')
			await logger.error(error, 'Database error')
			await logger.flush()

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Database error',
				}),
			)
		})

		test('null and undefined are ignored', async () => {
			await logger.info('Hello', null, undefined, 'world')

			expect(transport.send).toHaveBeenCalledWith(
				expect.objectContaining({
					msg: 'Hello world',
				}),
			)
			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.data).not.toHaveProperty('data')
		})

		test('no arguments logs with undefined msg and no data array', async () => {
			await logger.info()

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.msg).toBeUndefined()
			expect(callArgs?.data).toMatchObject({ env: 'test' })
			expect(callArgs?.data).not.toHaveProperty('data')
		})

		test('properties are preserved with variadic args', async () => {
			await logger.info('Test', { extra: 'data' })
			await logger.flush()

			const callArgs = transport.send.mock.calls[0]?.[0]
			expect(callArgs?.data).toMatchObject({
				env: 'test',
			})
			// @ts-expect-error - data.data is dynamically added
			expect(callArgs?.data?.data).toEqual([{ extra: 'data' }])
		})
	})
})
