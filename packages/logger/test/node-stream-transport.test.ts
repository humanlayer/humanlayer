import { stderr, stdout } from 'node:process'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { SendProps } from '../src/logger/abstract-transport'
import { Logger } from '../src/logger/logger'
import { StandardStreamTransport } from '../src/node/standard-stream-transport'

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

describe('Node StandardStreamTransport', () => {
	let stdoutSpy: ReturnType<typeof spyOn>
	let stderrSpy: ReturnType<typeof spyOn>

	beforeEach(() => {
		stdoutSpy = vi.spyOn(stdout, 'write').mockReturnValue(true)
		stderrSpy = vi.spyOn(stderr, 'write').mockReturnValue(true)
	})

	afterEach(() => {
		stdoutSpy.mockRestore()
		stderrSpy.mockRestore()
	})

	describe('constructor', () => {
		test('sets level correctly', () => {
			const transport = new StandardStreamTransport('warn', 'STDOUT')
			expect(transport.level).toBe('warn')
		})

		test('defaults to unbuffered mode (bufferSize=0)', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT')

			// biome-ignore lint: necessary since this is private member
			expect(transport['maxBufferSize']).toBe(0)
		})

		test('accepts custom buffer size', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)
			// biome-ignore lint: necessary since this is private member
			expect(transport['maxBufferSize']).toBe(100)
		})

		test('STDOUT option uses process.stdout', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT')
			// biome-ignore lint: necessary since this is private member
			expect(transport['stream']).toBe(stdout)
		})

		test('STDERR option uses process.stderr', () => {
			const transport = new StandardStreamTransport('info', 'STDERR')
			// biome-ignore lint: necessary since this is private member
			expect(transport['stream']).toBe(stderr)
		})
	})

	describe('unbuffered mode (bufferSize=0)', () => {
		test('each send() immediately calls stream.write()', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			transport.send(createSendProps({ msg: 'line 1' }))
			transport.send(createSendProps({ msg: 'line 2' }))
			transport.send(createSendProps({ msg: 'line 3' }))

			expect(stdoutSpy).toHaveBeenCalledTimes(3)
		})

		test('writes formatted JSON with newline', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			transport.send(createSendProps({ msg: 'test message' }))

			expect(stdoutSpy).toHaveBeenCalledTimes(1)
			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			expect(writtenContent.endsWith('\n')).toBe(true)

			const parsed = JSON.parse(writtenContent.trim())
			expect(parsed.msg).toBe('test message')
		})

		test('STDOUT transport writes to stdout', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			transport.send(createSendProps())

			expect(stdoutSpy).toHaveBeenCalledTimes(1)
			expect(stderrSpy).not.toHaveBeenCalled()
		})

		test('STDERR transport writes to stderr', () => {
			const transport = new StandardStreamTransport('info', 'STDERR', 0)

			transport.send(createSendProps())

			expect(stderrSpy).toHaveBeenCalledTimes(1)
			expect(stdoutSpy).not.toHaveBeenCalled()
		})

		test('includes all expected fields in output', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)
			const timestamp = Date.now()

			transport.send({
				level: 'warn',
				msg: 'warning message',
				timestamp,
				logger: 'my-logger',
				data: { userId: 123 },
			})

			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			const parsed = JSON.parse(writtenContent.trim())

			expect(parsed).toMatchObject({
				level: 'warn',
				msg: 'warning message',
				time: timestamp,
				logger: 'my-logger',
				data: { userId: 123 },
			})
		})
	})

	describe('buffered mode (bufferSize > 0)', () => {
		test('send() does NOT call stream.write() when buffer is not full', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 10)

			transport.send(createSendProps({ msg: 'line 1' }))
			transport.send(createSendProps({ msg: 'line 2' }))
			transport.send(createSendProps({ msg: 'line 3' }))

			expect(stdoutSpy).not.toHaveBeenCalled()
		})

		test('send() flushes when buffer reaches capacity', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 3)

			// Fill buffer (3 items)
			transport.send(createSendProps({ msg: 'line 0' }))
			transport.send(createSendProps({ msg: 'line 1' }))
			transport.send(createSendProps({ msg: 'line 2' }))
			expect(stdoutSpy).not.toHaveBeenCalled()

			// 4th item triggers flush
			transport.send(createSendProps({ msg: 'line 3' }))
			expect(stdoutSpy).toHaveBeenCalledTimes(1)

			// Flush should contain 4 lines
			const flushedContent = stdoutSpy.mock.calls[0]?.[0] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(4)
		})

		test('buffer is reset after flush', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 2)

			// First flush cycle
			transport.send(createSendProps({ msg: 'cycle1-0' }))
			transport.send(createSendProps({ msg: 'cycle1-1' }))
			transport.send(createSendProps({ msg: 'cycle1-2' })) // triggers flush 1
			expect(stdoutSpy).toHaveBeenCalledTimes(1)

			// Second flush cycle
			transport.send(createSendProps({ msg: 'cycle2-0' }))
			transport.send(createSendProps({ msg: 'cycle2-1' }))
			transport.send(createSendProps({ msg: 'cycle2-2' })) // triggers flush 2
			expect(stdoutSpy).toHaveBeenCalledTimes(2)
		})

		test('shutdown flushes remaining buffer', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)

			transport.send(createSendProps({ msg: 'line 0' }))
			transport.send(createSendProps({ msg: 'line 1' }))
			transport.send(createSendProps({ msg: 'line 2' }))

			expect(stdoutSpy).not.toHaveBeenCalled()

			await transport.shutdown()

			expect(stdoutSpy).toHaveBeenCalledTimes(1)
			const flushedContent = stdoutSpy.mock.calls[0]?.[0] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(3)
		})

		test('shutdown only flushes used portion of buffer', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)

			transport.send(createSendProps({ msg: 'only line' }))
			await transport.shutdown()

			const flushedContent = stdoutSpy.mock.calls[0]?.[0] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(1)
		})

		test('shutdown resets currentBufferSize', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)

			transport.send(createSendProps({ msg: 'line' }))
			// biome-ignore lint: necessary since this is private member
			expect(transport['currentBufferSize']).toBe(1)

			await transport.shutdown()
			// biome-ignore lint: necessary since this is private member
			expect(transport['currentBufferSize']).toBe(0)
		})

		test('shutdown does nothing when buffer is empty', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)

			await transport.shutdown()

			expect(stdoutSpy).not.toHaveBeenCalled()
		})

		// This test would have caught the original bug
		test('buffering continues to work after first flush (regression test)', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 3)

			// First flush cycle
			transport.send(createSendProps({ msg: 'cycle1-0' }))
			transport.send(createSendProps({ msg: 'cycle1-1' }))
			transport.send(createSendProps({ msg: 'cycle1-2' }))
			transport.send(createSendProps({ msg: 'cycle1-3' })) // triggers flush 1
			expect(stdoutSpy).toHaveBeenCalledTimes(1)

			// Second flush cycle - this would fail with the original bug
			transport.send(createSendProps({ msg: 'cycle2-0' }))
			transport.send(createSendProps({ msg: 'cycle2-1' }))
			transport.send(createSendProps({ msg: 'cycle2-2' }))
			transport.send(createSendProps({ msg: 'cycle2-3' })) // triggers flush 2
			expect(stdoutSpy).toHaveBeenCalledTimes(2)

			// Third flush cycle
			transport.send(createSendProps({ msg: 'cycle3-0' }))
			transport.send(createSendProps({ msg: 'cycle3-1' }))
			transport.send(createSendProps({ msg: 'cycle3-2' }))
			transport.send(createSendProps({ msg: 'cycle3-3' })) // triggers flush 3
			expect(stdoutSpy).toHaveBeenCalledTimes(3)
		})

		test('bufferSize=1 flushes on every other write', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 1)

			transport.send(createSendProps({ msg: 'line 0' })) // buffer
			expect(stdoutSpy).not.toHaveBeenCalled()

			transport.send(createSendProps({ msg: 'line 1' })) // flush
			expect(stdoutSpy).toHaveBeenCalledTimes(1)

			transport.send(createSendProps({ msg: 'line 2' })) // buffer
			expect(stdoutSpy).toHaveBeenCalledTimes(1)

			transport.send(createSendProps({ msg: 'line 3' })) // flush
			expect(stdoutSpy).toHaveBeenCalledTimes(2)
		})
	})

	describe('integration with Logger', () => {
		test('Logger writes to StandardStreamTransport (unbuffered)', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)
			const logger = new Logger({
				transports: [transport],
				name: 'integration-test',
				properties: { env: 'test' },
			})

			await logger.info('integration test message')

			expect(stdoutSpy).toHaveBeenCalledTimes(1)
			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			expect(writtenContent).toContain('integration test message')
			await logger.shutdown()
		})

		test('Logger writes to StandardStreamTransport (buffered)', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 100)
			const logger = new Logger({
				transports: [transport],
				name: 'integration-test',
				properties: { env: 'test' },
			})

			await logger.info('message 1')
			await logger.info('message 2')
			await logger.info('message 3')

			expect(stdoutSpy).not.toHaveBeenCalled()

			await logger.shutdown()

			expect(stdoutSpy).toHaveBeenCalledTimes(1)
		})

		test('respects log level filtering', async () => {
			const transport = new StandardStreamTransport('warn', 'STDOUT', 0)
			const logger = new Logger({
				transports: [transport],
				name: 'level-test',
				properties: {},
			})

			await logger.debug('should not appear')
			await logger.info('should not appear')
			await logger.warn('should appear')
			await logger.error('should appear')

			expect(stdoutSpy).toHaveBeenCalledTimes(2)
			await logger.shutdown()
		})

		test('multiple transports receive logs independently', async () => {
			const stdoutTransport = new StandardStreamTransport('info', 'STDOUT', 0)
			const stderrTransport = new StandardStreamTransport('error', 'STDERR', 0)

			const logger = new Logger({
				transports: [stdoutTransport, stderrTransport],
				name: 'multi-transport',
				properties: {},
			})

			await logger.info('info message')
			await logger.error('error message')

			// stdout (info level) gets both
			expect(stdoutSpy).toHaveBeenCalledTimes(2)
			// stderr (error level) gets only error
			expect(stderrSpy).toHaveBeenCalledTimes(1)
			await logger.shutdown()
		})
	})

	describe('correctness tests - unbuffered', () => {
		test('100 writes result in exactly 100 write() calls', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			for (let i = 0; i < 100; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(stdoutSpy).toHaveBeenCalledTimes(100)
			await transport.shutdown()
		})

		test('1,000 writes result in exactly 1,000 write() calls', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			for (let i = 0; i < 1_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(stdoutSpy).toHaveBeenCalledTimes(1_000)
			await transport.shutdown()
		})

		test('each write is valid JSON', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			for (let i = 0; i < 100; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			for (const call of stdoutSpy.mock.calls) {
				const content = call[0] as string
				expect(() => JSON.parse(content.trim())).not.toThrow()
			}
			await transport.shutdown()
		})
	})

	describe('correctness tests - buffered', () => {
		test('100 writes with bufferSize=10 - correct flush count', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 10)

			for (let i = 0; i < 100; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			// 100 lines with bufferSize=10: flushes at 11, 22, 33, 44, 55, 66, 77, 88, 99 = 9 flushes
			// Each flush writes 11 lines (10 buffered + 1 trigger)
			// Remaining 1 line flushed on shutdown
			expect(stdoutSpy).toHaveBeenCalledTimes(9)

			await transport.shutdown()
			expect(stdoutSpy).toHaveBeenCalledTimes(10) // +1 for remaining
		})

		test('all lines are present after flush + shutdown', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 10)

			for (let i = 0; i < 50; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			// Count total lines across all writes
			let totalLines = 0
			for (const call of stdoutSpy.mock.calls) {
				const content = call[0] as string
				const lines = content.split('\n').filter((l) => l.trim())
				totalLines += lines.length
			}

			expect(totalLines).toBe(50)
		})
	})

	describe.skip('load tests - unbuffered', () => {
		test('100,000 writes - correctness', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			expect(stdoutSpy).toHaveBeenCalledTimes(100_000)
			await transport.shutdown()
		}, 60_000)

		test('100,000 writes - memory stability', async () => {
			const initialMemory = getMemoryMB()
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}

			await transport.shutdown()
			const finalMemory = getMemoryMB()
			const memoryGrowth = finalMemory - initialMemory

			console.log(
				`Memory (unbuffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
			)

			expect(memoryGrowth).toBeLessThan(500)
		}, 60_000)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 writes - correctness',
			async () => {
				let writeCount = 0
				stdoutSpy.mockImplementation(() => {
					writeCount++
					return true
				})

				const transport = new StandardStreamTransport('info', 'STDOUT', 0)

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				expect(writeCount).toBe(1_000_000)
				await transport.shutdown()
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 writes - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				stdoutSpy.mockImplementation(() => true)

				const transport = new StandardStreamTransport('info', 'STDOUT', 0)

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				await transport.shutdown()
				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (1M unbuffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(500)
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 writes - correctness',
			async () => {
				let writeCount = 0
				stdoutSpy.mockImplementation(() => {
					writeCount++
					return true
				})

				const transport = new StandardStreamTransport('info', 'STDOUT', 0)

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				expect(writeCount).toBe(2_000_000)
				await transport.shutdown()
			},
			180_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 writes - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				stdoutSpy.mockImplementation(() => true)

				const transport = new StandardStreamTransport('info', 'STDOUT', 0)

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}

				await transport.shutdown()
				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (2M unbuffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(1000)
			},
			180_000,
		)
	})

	describe.skip('load tests - buffered', () => {
		test('100,000 writes with bufferSize=1000 - all lines present', async () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 1000)

			for (let i = 0; i < 100_000; i++) {
				transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			// Count total lines
			let totalLines = 0
			for (const call of stdoutSpy.mock.calls) {
				const content = call[0] as string
				const lines = content.split('\n').filter((l) => l.trim())
				totalLines += lines.length
			}

			expect(totalLines).toBe(100_000)
		}, 60_000)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 writes with bufferSize=1000 - all lines present',
			async () => {
				let totalLines = 0
				stdoutSpy.mockImplementation((content: string) => {
					const lines = content.split('\n').filter((l: string) => l.trim())
					totalLines += lines.length
					return true
				})

				const transport = new StandardStreamTransport('info', 'STDOUT', 1000)

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				expect(totalLines).toBe(1_000_000)
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 writes buffered - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				stdoutSpy.mockImplementation(() => true)

				const transport = new StandardStreamTransport('info', 'STDOUT', 1000)

				for (let i = 0; i < 1_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (1M buffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(500)
			},
			120_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 writes with bufferSize=5000 - all lines present',
			async () => {
				let totalLines = 0
				stdoutSpy.mockImplementation((content: string) => {
					const lines = content.split('\n').filter((l: string) => l.trim())
					totalLines += lines.length
					return true
				})

				const transport = new StandardStreamTransport('info', 'STDOUT', 5000)

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				expect(totalLines).toBe(2_000_000)
			},
			180_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 writes buffered - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				stdoutSpy.mockImplementation(() => true)

				const transport = new StandardStreamTransport('info', 'STDOUT', 5000)

				for (let i = 0; i < 2_000_000; i++) {
					transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (2M buffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(1000)
			},
			180_000,
		)
	})

	describe('edge cases', () => {
		test('handles special characters', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)
			const specialMsg = 'Line1\nLine2\t"quoted" \\backslash'

			transport.send(createSendProps({ msg: specialMsg }))

			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			const parsed = JSON.parse(writtenContent.trim())
			expect(parsed.msg).toBe(specialMsg)
		})

		test('handles unicode', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)
			const unicodeMsg = '日本語 emoji: 🎉 ñ é ü'

			transport.send(createSendProps({ msg: unicodeMsg }))

			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			const parsed = JSON.parse(writtenContent.trim())
			expect(parsed.msg).toBe(unicodeMsg)
		})

		test('handles empty message', () => {
			const transport = new StandardStreamTransport('info', 'STDOUT', 0)

			transport.send(createSendProps({ msg: '' }))

			const writtenContent = stdoutSpy.mock.calls[0]?.[0] as string
			const parsed = JSON.parse(writtenContent.trim())
			expect(parsed.msg).toBe('')
		})
	})
})
