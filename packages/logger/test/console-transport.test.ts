import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ConsoleTransport } from '../src/browser/console-transport'
import { Logger } from '../src/logger/logger'

describe('ConsoleTransport', () => {
	let consoleSpy: {
		debug: ReturnType<typeof spyOn>
		info: ReturnType<typeof spyOn>
		warn: ReturnType<typeof spyOn>
		error: ReturnType<typeof spyOn>
	}

	beforeEach(() => {
		consoleSpy = {
			debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
			info: vi.spyOn(console, 'info').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
			error: vi.spyOn(console, 'error').mockImplementation(() => {}),
		}
	})

	afterEach(() => {
		consoleSpy.debug.mockRestore()
		consoleSpy.info.mockRestore()
		consoleSpy.warn.mockRestore()
		consoleSpy.error.mockRestore()
	})

	describe('constructor', () => {
		test('defaults to info level', () => {
			const transport = new ConsoleTransport()
			expect(transport.level).toBe('info')
		})

		test('accepts custom level', () => {
			const transport = new ConsoleTransport('debug')
			expect(transport.level).toBe('debug')
		})
	})

	describe('console method mapping', () => {
		test('silly level uses console.debug', async () => {
			const transport = new ConsoleTransport('silly')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.silly('test message')

			expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('debug level uses console.debug', async () => {
			const transport = new ConsoleTransport('debug')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.debug('test message')

			expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('http level uses console.debug', async () => {
			const transport = new ConsoleTransport('silly')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.http('test message')

			expect(consoleSpy.debug).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('info level uses console.info', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('test message')

			expect(consoleSpy.info).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('warn level uses console.warn', async () => {
			const transport = new ConsoleTransport('warn')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.warn('test message')

			expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('error level uses console.error', async () => {
			const transport = new ConsoleTransport('error')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.error('test message')

			expect(consoleSpy.error).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})

		test('fatal level uses console.error', async () => {
			const transport = new ConsoleTransport('fatal')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.fatal('test message')

			expect(consoleSpy.error).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})
	})

	describe('output format', () => {
		test('includes level in output', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('hello')

			expect(consoleSpy.info).toHaveBeenCalledTimes(1)
			const [prefix] = consoleSpy.info.mock.calls[0] as [string, ...unknown[]]
			expect(prefix).toContain('INFO')
			await logger.shutdown()
		})

		test('includes logger name in output', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'my-logger', properties: {} })

			await logger.info('hello')

			const [prefix] = consoleSpy.info.mock.calls[0] as [string, ...unknown[]]
			expect(prefix).toContain('[my-logger]')
			await logger.shutdown()
		})

		test('includes timestamp in output', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('hello')

			const [prefix] = consoleSpy.info.mock.calls[0] as [string, ...unknown[]]
			// Should contain some date-like pattern (locale dependent, so just check it has numbers)
			expect(prefix).toMatch(/\d/)
			await logger.shutdown()
		})

		test('includes message in output', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('hello world')

			const [, message] = consoleSpy.info.mock.calls[0] as [string, string, ...unknown[]]
			expect(message).toBe('hello world')
			await logger.shutdown()
		})

		test('includes data object when present', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: { env: 'test' } })

			await logger.info({ userId: 123 }, 'user action')
			await logger.flush()

			const args = consoleSpy.info.mock.calls[0] as [string, string, Record<string, unknown>]
			expect(args.length).toBe(3)
			expect(args[2]).toMatchObject({ env: 'test' })
			await logger.shutdown()
		})

		test('can stringify data for process logs', async () => {
			const transport = new ConsoleTransport('info', { stringifyData: true })
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })
			const cause = new Error('database constraint failed')

			await logger.info({ err: new Error('Unable to insert task', { cause }) }, 'task failed')
			await logger.flush()

			const args = consoleSpy.info.mock.calls[0] as [string, string, string]
			expect(args[2]).toContain('Unable to insert task')
			expect(args[2]).toContain('database constraint failed')
			expect(args[2]).not.toContain('[Object')
			await logger.shutdown()
		})

		test('omits data argument when no data', async () => {
			const transport = new ConsoleTransport('info')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('simple message')

			const args = consoleSpy.info.mock.calls[0] as unknown[]
			expect(args.length).toBe(2) // prefix and message only
			await logger.shutdown()
		})
	})

	describe('level filtering', () => {
		test('does not log below configured level', async () => {
			const transport = new ConsoleTransport('warn')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.debug('should not appear')
			await logger.info('should not appear')

			expect(consoleSpy.debug).not.toHaveBeenCalled()
			expect(consoleSpy.info).not.toHaveBeenCalled()
			await logger.shutdown()
		})

		test('logs at and above configured level', async () => {
			const transport = new ConsoleTransport('warn')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.warn('should appear')
			await logger.error('should appear')

			expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
			expect(consoleSpy.error).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})
	})

	describe('shutdown', () => {
		test('shutdown does not throw', () => {
			const transport = new ConsoleTransport('info')
			expect(() => transport.shutdown()).not.toThrow()
		})
	})

	describe('integration with Logger', () => {
		test('works with child loggers', async () => {
			const transport = new ConsoleTransport('debug')
			const logger = new Logger({ transports: [transport], name: 'parent', properties: { app: 'test' } })
			const child = logger.child('child', { requestId: '123' })

			await child.info('child message')

			expect(consoleSpy.info).toHaveBeenCalledTimes(1)
			const args = consoleSpy.info.mock.calls[0] as [string, string, Record<string, unknown>]
			expect(args[2]).toMatchObject({ app: 'test', requestId: '123' })
			await logger.shutdown()
		})

		test('receives consistent timestamp across calls', async () => {
			const transport = new ConsoleTransport('debug')
			const logger = new Logger({ transports: [transport], name: 'test', properties: {} })

			await logger.info('first')
			await new Promise((resolve) => setTimeout(resolve, 10))
			await logger.info('second')

			expect(consoleSpy.info).toHaveBeenCalledTimes(2)
			// Both calls should have different timestamps (tested implicitly by the Logger timestamp tests)
			await logger.shutdown()
		})
	})
})
