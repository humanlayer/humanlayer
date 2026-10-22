import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ConsoleTransport } from '../src/browser/console-transport'
import type { SendProps } from '../src/logger/abstract-transport'
import { Logger } from '../src/logger/logger'

// Skip heavy load tests (1M+ iterations) unless RUN_LOAD_TESTS=true
const skipHeavyLoadTests = process.env.RUN_LOAD_TESTS !== 'true'

// Helper to get memory usage in MB after GC
function getMemoryMB(): number {
	Bun.gc(true)
	return process.memoryUsage().rss / 1024 / 1024
}

// Helper to create SendProps
function createSendProps(overrides: Partial<SendProps> = {}): SendProps {
	return {
		level: 'info',
		msg: 'test message',
		timestamp: Date.now(),
		logger: 'test-logger',
		data: { key: 'value' },
		...overrides,
	}
}

describe.skip('ConsoleTransport Load Tests', () => {
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

	describe('correctness tests', () => {
		test('100 info logs result in exactly 100 console.info calls', () => {
			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 100; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(consoleSpy.info).toHaveBeenCalledTimes(100)
			transport.shutdown()
		})

		test('1,000 info logs result in exactly 1,000 console.info calls', () => {
			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 1_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(consoleSpy.info).toHaveBeenCalledTimes(1_000)
			transport.shutdown()
		})

		test('10,000 info logs result in exactly 10,000 console.info calls', () => {
			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 10_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(consoleSpy.info).toHaveBeenCalledTimes(10_000)
			transport.shutdown()
		})

		test('mixed log levels route to correct console methods', () => {
			const transport = new ConsoleTransport('silly')

			for (let i = 0; i < 100; i++) {
				transport.send(createSendProps({ level: 'debug', msg: `debug ${i}` }))
				transport.send(createSendProps({ level: 'info', msg: `info ${i}` }))
				transport.send(createSendProps({ level: 'warn', msg: `warn ${i}` }))
				transport.send(createSendProps({ level: 'error', msg: `error ${i}` }))
			}

			expect(consoleSpy.debug).toHaveBeenCalledTimes(100)
			expect(consoleSpy.info).toHaveBeenCalledTimes(100)
			expect(consoleSpy.warn).toHaveBeenCalledTimes(100)
			expect(consoleSpy.error).toHaveBeenCalledTimes(100)
			transport.shutdown()
		})
	})

	describe('load tests - direct transport', () => {
		test('100,000 logs - correctness', () => {
			let callCount = 0
			const originalInfo = console.info
			console.info = () => {
				callCount++
			}

			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(callCount).toBe(100_000)
			transport.shutdown()
			console.info = originalInfo
		}, 60_000)

		test('100,000 logs - spot check content', () => {
			const spotChecks: { index: number; msg: string }[] = []
			let callIndex = 0
			const originalInfo = console.info
			console.info = (_prefix: string, msg: string) => {
				// Only capture first, middle, and last
				if (callIndex === 0 || callIndex === 49_999 || callIndex === 99_999) {
					spotChecks.push({ index: callIndex, msg })
				}
				callIndex++
			}

			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(spotChecks).toHaveLength(3)
			expect(spotChecks[0]?.msg).toBe('line 0')
			expect(spotChecks[1]?.msg).toBe('line 49999')
			expect(spotChecks[2]?.msg).toBe('line 99999')
			transport.shutdown()
			console.info = originalInfo
		}, 60_000)

		test('100,000 logs - memory stability', () => {
			const originalInfo = console.info
			console.info = () => {}

			const initialMemory = getMemoryMB()
			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			transport.shutdown()
			const finalMemory = getMemoryMB()
			const memoryGrowth = finalMemory - initialMemory

			console.info = originalInfo
			console.log(
				`Memory (100K): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
			)

			expect(memoryGrowth).toBeLessThan(500)
		}, 60_000)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 logs - correctness',
			() => {
				let callCount = 0
				const originalInfo = console.info
				console.info = () => {
					callCount++
				}

				const transport = new ConsoleTransport('info')

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				expect(callCount).toBe(1_000_000)
				transport.shutdown()
				console.info = originalInfo
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 logs - memory stability',
			() => {
				const originalInfo = console.info
				console.info = () => {}

				const initialMemory = getMemoryMB()

				const transport = new ConsoleTransport('info')

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				transport.shutdown()
				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.info = originalInfo
				console.log(
					`Memory (1M): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(500)
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 logs - correctness',
			() => {
				let callCount = 0
				const originalInfo = console.info
				console.info = () => {
					callCount++
				}

				const transport = new ConsoleTransport('info')

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				expect(callCount).toBe(2_000_000)
				transport.shutdown()
				console.info = originalInfo
			},
			180_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 logs - memory stability',
			() => {
				const originalInfo = console.info
				console.info = () => {}

				const initialMemory = getMemoryMB()

				const transport = new ConsoleTransport('info')

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				transport.shutdown()
				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.info = originalInfo
				console.log(
					`Memory (2M): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(1000)
			},
			180_000,
		)
	})

	describe('load tests - with Logger integration', () => {
		test('100,000 logger.info() calls via Logger', async () => {
			let callCount = 0
			const originalInfo = console.info
			console.info = () => {
				callCount++
			}

			const transport = new ConsoleTransport('info')
			const logger = new Logger({
				transports: [transport],
				name: 'load-test',
				properties: {},
			})

			for (let i = 0; i < 100_000; i++) {
				await logger.info(`line ${i}`)
			}

			expect(callCount).toBe(100_000)
			await logger.shutdown()
			console.info = originalInfo
		}, 120_000)

		test('100,000 mixed level logs via Logger', async () => {
			const counts = { debug: 0, info: 0, warn: 0, error: 0 }
			const originalDebug = console.debug
			const originalInfo = console.info
			const originalWarn = console.warn
			const originalError = console.error
			console.debug = () => {
				counts.debug++
			}
			console.info = () => {
				counts.info++
			}
			console.warn = () => {
				counts.warn++
			}
			console.error = () => {
				counts.error++
			}

			const transport = new ConsoleTransport('silly')
			const logger = new Logger({
				transports: [transport],
				name: 'mixed-load-test',
				properties: {},
			})

			for (let i = 0; i < 25_000; i++) {
				await logger.debug(`debug ${i}`)
				await logger.info(`info ${i}`)
				await logger.warn(`warn ${i}`)
				await logger.error(`error ${i}`)
			}

			expect(counts.debug).toBe(25_000)
			expect(counts.info).toBe(25_000)
			expect(counts.warn).toBe(25_000)
			expect(counts.error).toBe(25_000)
			await logger.shutdown()
			console.debug = originalDebug
			console.info = originalInfo
			console.warn = originalWarn
			console.error = originalError
		}, 180_000)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 logger.info() calls via Logger - memory stability',
			async () => {
				const originalInfo = console.info
				console.info = () => {}

				const initialMemory = getMemoryMB()

				const transport = new ConsoleTransport('info')
				const logger = new Logger({
					transports: [transport],
					name: 'load-test',
					properties: {},
				})

				for (let i = 0; i < 1_000_000; i++) {
					await logger.info(`line ${i}`)
				}

				await logger.shutdown()
				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.info = originalInfo
				console.log(
					`Memory (1M via Logger): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(500)
			},
			180_000,
		)
	})

	describe('load tests - mixed levels at volume', () => {
		test('100,000 logs split across all levels', () => {
			const counts = { debug: 0, info: 0, warn: 0, error: 0 }
			const originalDebug = console.debug
			const originalInfo = console.info
			const originalWarn = console.warn
			const originalError = console.error
			console.debug = () => {
				counts.debug++
			}
			console.info = () => {
				counts.info++
			}
			console.warn = () => {
				counts.warn++
			}
			console.error = () => {
				counts.error++
			}

			const transport = new ConsoleTransport('silly')
			const levels = ['silly', 'debug', 'http', 'info', 'warn', 'error', 'fatal'] as const

			for (let i = 0; i < 100_000; i++) {
				const level = levels[i % levels.length]
				transport.send(createSendProps({ level, msg: `${level} ${i}` }))
			}

			// silly, debug, http -> console.debug
			// info -> console.info
			// warn -> console.warn
			// error, fatal -> console.error

			// 100,000 / 7 levels ≈ 14,285-14,286 per level
			const perLevel = Math.floor(100_000 / 7)
			const remainder = 100_000 % 7

			// silly, debug, http (3 levels) -> debug
			const expectedDebugCalls = perLevel * 3 + Math.min(remainder, 3)
			// info (1 level) -> info
			const expectedInfoCalls = perLevel + (remainder > 3 ? 1 : 0)
			// warn (1 level) -> warn
			const expectedWarnCalls = perLevel + (remainder > 4 ? 1 : 0)
			// error, fatal (2 levels) -> error
			const expectedErrorCalls = perLevel * 2 + Math.max(0, remainder - 5)

			expect(counts.debug).toBe(expectedDebugCalls)
			expect(counts.info).toBe(expectedInfoCalls)
			expect(counts.warn).toBe(expectedWarnCalls)
			expect(counts.error).toBe(expectedErrorCalls)
			transport.shutdown()
			console.debug = originalDebug
			console.info = originalInfo
			console.warn = originalWarn
			console.error = originalError
		}, 60_000)
	})

	describe('edge cases at volume', () => {
		test('100,000 logs with complex data objects', () => {
			let callCount = 0
			const originalInfo = console.info
			console.info = () => {
				callCount++
			}

			const transport = new ConsoleTransport('info')

			for (let i = 0; i < 100_000; i++) {
				transport.send(
					createSendProps({
						msg: `line ${i}`,
						data: {
							index: i,
							nested: { a: 1, b: 2 },
							array: [1, 2, 3],
							string: 'test data',
						},
					}),
				)
			}

			expect(callCount).toBe(100_000)
			transport.shutdown()
			console.info = originalInfo
		}, 120_000)

		test('100,000 logs with unicode messages', () => {
			let callCount = 0
			const originalInfo = console.info
			console.info = () => {
				callCount++
			}

			const transport = new ConsoleTransport('info')
			const unicodeMsg = '日本語 🎉 ñ é ü'

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `${unicodeMsg} ${i}` }))
			}

			expect(callCount).toBe(100_000)
			transport.shutdown()
			console.info = originalInfo
		}, 60_000)

		test('100,000 logs with long messages', () => {
			let callCount = 0
			const originalInfo = console.info
			console.info = () => {
				callCount++
			}

			const transport = new ConsoleTransport('info')
			const longMsg = 'x'.repeat(1000)

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `${longMsg} ${i}` }))
			}

			expect(callCount).toBe(100_000)
			transport.shutdown()
			console.info = originalInfo
		}, 120_000)
	})
})
