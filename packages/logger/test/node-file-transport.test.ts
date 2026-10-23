import * as fs from 'node:fs/promises'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { SendProps } from '../src/logger/abstract-transport'
import { Logger } from '../src/logger/logger'
import { FileTransport } from '../src/node/file-transport'

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>()
	return { ...actual, appendFile: vi.fn(actual.appendFile) }
})

// Skip heavy load tests (1M+ iterations) unless RUN_LOAD_TESTS=true
const skipHeavyLoadTests = process.env.RUN_LOAD_TESTS !== 'true'

// Helper to generate unique test file paths
function getTestFilePath(): string {
	return join(tmpdir(), `node-file-transport-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
}

// Helper to count lines in a file
async function countLines(filePath: string): Promise<number> {
	const content = await fs.readFile(filePath, 'utf8')
	return content.split('\n').filter((line) => line.trim().length > 0).length
}

// Helper to read and parse all log lines
async function readLogLines(filePath: string): Promise<Array<Record<string, unknown>>> {
	const content = await fs.readFile(filePath, 'utf8')
	return content
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line))
}

// Helper to get memory usage in MB after GC
function getMemoryMB(): number {
	globalThis.gc?.()
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

describe('Node FileTransport', () => {
	let testFilePath: string

	beforeEach(() => {
		testFilePath = getTestFilePath()
	})

	afterEach(async () => {
		await unlink(testFilePath).catch(() => {})
	})

	describe('constructor', () => {
		test('sets level correctly', () => {
			const transport = new FileTransport('warn', testFilePath)
			expect(transport.level).toBe('warn')
		})

		test('defaults to unbuffered mode (bufferSize=0)', () => {
			const transport = new FileTransport('info', testFilePath)
			// biome-ignore lint: necessary since this is private member
			expect(transport['maxBufferSize']).toBe(0)
		})

		test('accepts custom buffer size', () => {
			const transport = new FileTransport('info', testFilePath, 100)
			// biome-ignore lint: necessary since this is private member
			expect(transport['maxBufferSize']).toBe(100)
		})

		test('pre-allocates buffer array to bufferSize', () => {
			const transport = new FileTransport('info', testFilePath, 50)
			// biome-ignore lint: necessary since this is private member
			expect(transport['appendBuffer'].length).toBe(50)
		})
	})

	describe('unbuffered mode (bufferSize=0)', () => {
		let appendFileSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			appendFileSpy = vi.spyOn(fs, 'appendFile').mockResolvedValue(undefined)
		})

		afterEach(() => {
			appendFileSpy.mockRestore()
		})

		test('each send() immediately calls fs.appendFile()', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			await transport.send(createSendProps({ msg: 'line 1' }))
			await transport.send(createSendProps({ msg: 'line 2' }))
			await transport.send(createSendProps({ msg: 'line 3' }))

			expect(appendFileSpy).toHaveBeenCalledTimes(3)
		})

		test('writes formatted JSON with newline', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			await transport.send(createSendProps({ msg: 'test message' }))

			const writtenContent = appendFileSpy.mock.calls[0]?.[1] as string
			expect(writtenContent.endsWith('\n')).toBe(true)

			const parsed = JSON.parse(writtenContent.trim())
			expect(parsed.msg).toBe('test message')
		})

		test('writes to correct file path', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			await transport.send(createSendProps())

			const calledPath = appendFileSpy.mock.calls[0]?.[0]
			expect(calledPath).toBe(testFilePath)
		})

		test('shutdown does not call appendFile when buffer is empty', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			await transport.shutdown()

			expect(appendFileSpy).not.toHaveBeenCalled()
		})
	})

	describe('buffered mode (bufferSize > 0)', () => {
		let appendFileSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			appendFileSpy = vi.spyOn(fs, 'appendFile').mockResolvedValue(undefined)
		})

		afterEach(() => {
			appendFileSpy.mockRestore()
		})

		test('send() does NOT call fs.appendFile() when buffer is not full', async () => {
			const transport = new FileTransport('info', testFilePath, 10)

			await transport.send(createSendProps({ msg: 'line 1' }))
			await transport.send(createSendProps({ msg: 'line 2' }))
			await transport.send(createSendProps({ msg: 'line 3' }))

			expect(appendFileSpy).not.toHaveBeenCalled()
		})

		test('send() flushes when buffer reaches capacity', async () => {
			const transport = new FileTransport('info', testFilePath, 3)

			// Fill buffer (3 items)
			await transport.send(createSendProps({ msg: 'line 0' }))
			await transport.send(createSendProps({ msg: 'line 1' }))
			await transport.send(createSendProps({ msg: 'line 2' }))
			expect(appendFileSpy).not.toHaveBeenCalled()

			// 4th item triggers flush (buffer was full)
			await transport.send(createSendProps({ msg: 'line 3' }))
			expect(appendFileSpy).toHaveBeenCalledTimes(1)

			// Flush should contain 4 lines (3 buffered + 1 that triggered flush)
			const flushedContent = appendFileSpy.mock.calls[0]?.[1] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(4)
		})

		test('buffer is reset after flush', async () => {
			const transport = new FileTransport('info', testFilePath, 2)

			// First batch: fill buffer (2) + trigger (1) = flush
			await transport.send(createSendProps({ msg: 'batch1-0' }))
			await transport.send(createSendProps({ msg: 'batch1-1' }))
			await transport.send(createSendProps({ msg: 'batch1-2' })) // triggers flush
			expect(appendFileSpy).toHaveBeenCalledTimes(1)

			// Second batch: buffer should be reset, fill again
			await transport.send(createSendProps({ msg: 'batch2-0' }))
			await transport.send(createSendProps({ msg: 'batch2-1' }))
			await transport.send(createSendProps({ msg: 'batch2-2' })) // triggers second flush
			expect(appendFileSpy).toHaveBeenCalledTimes(2)
		})

		test('shutdown flushes remaining buffer', async () => {
			const transport = new FileTransport('info', testFilePath, 100)

			await transport.send(createSendProps({ msg: 'line 0' }))
			await transport.send(createSendProps({ msg: 'line 1' }))
			await transport.send(createSendProps({ msg: 'line 2' }))

			expect(appendFileSpy).not.toHaveBeenCalled()

			await transport.shutdown()

			expect(appendFileSpy).toHaveBeenCalledTimes(1)
			const flushedContent = appendFileSpy.mock.calls[0]?.[1] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(3)
		})

		test('shutdown only flushes used portion of buffer (not empty slots)', async () => {
			const transport = new FileTransport('info', testFilePath, 100)

			await transport.send(createSendProps({ msg: 'only line' }))
			await transport.shutdown()

			const flushedContent = appendFileSpy.mock.calls[0]?.[1] as string
			const lines = flushedContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(1)
		})

		test('shutdown resets currentBufferLength', async () => {
			const transport = new FileTransport('info', testFilePath, 100)

			await transport.send(createSendProps({ msg: 'line' }))
			// biome-ignore lint: necessary since this is private member
			expect(transport['currentBufferLength']).toBe(1)

			await transport.shutdown()
			// biome-ignore lint: necessary since this is private member
			expect(transport['currentBufferLength']).toBe(0)
		})

		// This test would have caught the original bug
		test('buffering continues to work after first flush (regression test)', async () => {
			const transport = new FileTransport('info', testFilePath, 3)

			// First flush cycle
			await transport.send(createSendProps({ msg: 'cycle1-0' }))
			await transport.send(createSendProps({ msg: 'cycle1-1' }))
			await transport.send(createSendProps({ msg: 'cycle1-2' }))
			await transport.send(createSendProps({ msg: 'cycle1-3' })) // triggers flush 1
			expect(appendFileSpy).toHaveBeenCalledTimes(1)

			// Second flush cycle - this would fail with the original bug
			// because appendBuffer.length would be 3 after re-allocation
			await transport.send(createSendProps({ msg: 'cycle2-0' }))
			await transport.send(createSendProps({ msg: 'cycle2-1' }))
			await transport.send(createSendProps({ msg: 'cycle2-2' }))
			await transport.send(createSendProps({ msg: 'cycle2-3' })) // triggers flush 2
			expect(appendFileSpy).toHaveBeenCalledTimes(2)

			// Third flush cycle - further verify
			await transport.send(createSendProps({ msg: 'cycle3-0' }))
			await transport.send(createSendProps({ msg: 'cycle3-1' }))
			await transport.send(createSendProps({ msg: 'cycle3-2' }))
			await transport.send(createSendProps({ msg: 'cycle3-3' })) // triggers flush 3
			expect(appendFileSpy).toHaveBeenCalledTimes(3)
		})

		test('bufferSize=1 flushes on every other write', async () => {
			const transport = new FileTransport('info', testFilePath, 1)

			await transport.send(createSendProps({ msg: 'line 0' })) // buffer
			expect(appendFileSpy).not.toHaveBeenCalled()

			await transport.send(createSendProps({ msg: 'line 1' })) // flush (2 lines)
			expect(appendFileSpy).toHaveBeenCalledTimes(1)

			await transport.send(createSendProps({ msg: 'line 2' })) // buffer
			expect(appendFileSpy).toHaveBeenCalledTimes(1)

			await transport.send(createSendProps({ msg: 'line 3' })) // flush (2 lines)
			expect(appendFileSpy).toHaveBeenCalledTimes(2)
		})
	})

	describe('integration with Logger', () => {
		let appendFileSpy: ReturnType<typeof vi.spyOn>

		beforeEach(() => {
			appendFileSpy = vi.spyOn(fs, 'appendFile').mockResolvedValue(undefined)
		})

		afterEach(() => {
			appendFileSpy.mockRestore()
		})

		test('Logger writes to FileTransport (unbuffered)', async () => {
			const transport = new FileTransport('info', testFilePath, 0)
			const logger = new Logger({
				transports: [transport],
				name: 'integration-test',
				properties: { env: 'test' },
			})

			await logger.info('integration test message')
			await logger.shutdown()

			// Verify fs.appendFile was called once (unbuffered = immediate write)
			expect(appendFileSpy).toHaveBeenCalledTimes(1)
			const writtenContent = appendFileSpy.mock.calls[0]?.[1] as string
			expect(writtenContent).toContain('integration test message')
		})

		test('Logger writes to FileTransport (buffered)', async () => {
			const transport = new FileTransport('info', testFilePath, 100)
			const logger = new Logger({
				transports: [transport],
				name: 'integration-test',
				properties: { env: 'test' },
			})

			await logger.info('message 1')
			await logger.info('message 2')
			await logger.info('message 3')
			await logger.shutdown()

			// Buffered: single flush on shutdown
			expect(appendFileSpy).toHaveBeenCalledTimes(1)
			const writtenContent = appendFileSpy.mock.calls[0]?.[1] as string
			const lines = writtenContent.split('\n').filter((l) => l.trim())
			expect(lines).toHaveLength(3)
		})

		test('respects log level filtering', async () => {
			const transport = new FileTransport('warn', testFilePath, 0)
			const logger = new Logger({
				transports: [transport],
				name: 'level-test',
				properties: {},
			})

			await logger.debug('should not appear')
			await logger.info('should not appear')
			await logger.warn('should appear')
			await logger.error('should appear')
			await logger.shutdown()

			// Only warn and error should be logged (unbuffered = 2 calls)
			expect(appendFileSpy).toHaveBeenCalledTimes(2)
		})
	})

	describe('correctness tests - unbuffered', () => {
		test('100 lines results in exactly 100 lines in file', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			for (let i = 0; i < 100; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(100)
		})
	})

	describe('correctness tests - buffered', () => {
		test('100 lines with bufferSize=10 results in exactly 100 lines', async () => {
			const transport = new FileTransport('info', testFilePath, 10)

			for (let i = 0; i < 100; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(100)
		})

		test('1,000 lines with bufferSize=100 results in exactly 1,000 lines', async () => {
			const transport = new FileTransport('info', testFilePath, 100)

			for (let i = 0; i < 1_000; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(1_000)
		})

		test('150 lines with bufferSize=100 results in exactly 150 lines', async () => {
			const transport = new FileTransport('info', testFilePath, 100)

			for (let i = 0; i < 150; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(150)
		})

		test('lines are written in correct order', async () => {
			const transport = new FileTransport('info', testFilePath, 10)

			for (let i = 0; i < 50; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lines = await readLogLines(testFilePath)
			for (let i = 0; i < 50; i++) {
				expect(lines[i]?.msg).toBe(`line ${i}`)
			}
		})
	})

	describe.skip('load tests - unbuffered', () => {
		test('100,000 lines - correctness', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			for (let i = 0; i < 100_000; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(100_000)
		}, 120_000)

		test('100,000 lines - memory stability', async () => {
			const initialMemory = getMemoryMB()
			const transport = new FileTransport('info', testFilePath, 0)

			for (let i = 0; i < 100_000; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const finalMemory = getMemoryMB()
			const memoryGrowth = finalMemory - initialMemory

			console.log(
				`Memory (unbuffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
			)

			expect(memoryGrowth).toBeLessThan(500)
		}, 120_000)
	})

	describe.skip('load tests - buffered', () => {
		test('100,000 lines with bufferSize=1000 - correctness', async () => {
			const transport = new FileTransport('info', testFilePath, 1000)

			for (let i = 0; i < 100_000; i++) {
				await transport.send(createSendProps({ msg: `line ${i}` }))
			}
			await transport.shutdown()

			const lineCount = await countLines(testFilePath)
			expect(lineCount).toBe(100_000)
		}, 120_000)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 lines with bufferSize=1000 - correctness',
			async () => {
				const transport = new FileTransport('info', testFilePath, 1000)

				for (let i = 0; i < 1_000_000; i++) {
					await transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const lineCount = await countLines(testFilePath)
				expect(lineCount).toBe(1_000_000)
			},
			180_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'1,000,000 lines - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				const transport = new FileTransport('info', testFilePath, 1000)

				for (let i = 0; i < 1_000_000; i++) {
					await transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (buffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(500)
			},
			180_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 lines with bufferSize=5000 - correctness',
			async () => {
				const transport = new FileTransport('info', testFilePath, 5000)

				for (let i = 0; i < 2_000_000; i++) {
					await transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const lineCount = await countLines(testFilePath)
				expect(lineCount).toBe(2_000_000)
			},
			300_000,
		)

		test.skipIf(skipHeavyLoadTests)(
			'2,000,000 lines - memory stability',
			async () => {
				const initialMemory = getMemoryMB()
				const transport = new FileTransport('info', testFilePath, 5000)

				for (let i = 0; i < 2_000_000; i++) {
					await transport.send(createSendProps({ msg: `line ${i}` }))
				}
				await transport.shutdown()

				const finalMemory = getMemoryMB()
				const memoryGrowth = finalMemory - initialMemory

				console.log(
					`Memory (2M buffered): initial=${initialMemory.toFixed(2)}MB, final=${finalMemory.toFixed(2)}MB, growth=${memoryGrowth.toFixed(2)}MB`,
				)

				expect(memoryGrowth).toBeLessThan(1000)
			},
			300_000,
		)
	})

	describe('edge cases', () => {
		test('handles empty message', async () => {
			const transport = new FileTransport('info', testFilePath, 0)

			await transport.send(createSendProps({ msg: '' }))
			await transport.shutdown()

			const lines = await readLogLines(testFilePath)
			expect(lines).toHaveLength(1)
			expect(lines[0]?.msg).toBe('')
		})

		test('handles very large data objects', async () => {
			const transport = new FileTransport('info', testFilePath, 0)
			const largeData = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item ${i}` })) }

			await transport.send(createSendProps({ data: largeData }))
			await transport.shutdown()

			const lines = await readLogLines(testFilePath)
			expect(lines).toHaveLength(1)
		})

		test('handles special characters', async () => {
			const transport = new FileTransport('info', testFilePath, 0)
			const specialMsg = 'Line1\nLine2\tTabbed "quoted" \\backslash'

			await transport.send(createSendProps({ msg: specialMsg }))
			await transport.shutdown()

			const lines = await readLogLines(testFilePath)
			expect(lines[0]?.msg).toBe(specialMsg)
		})

		test('handles unicode', async () => {
			const transport = new FileTransport('info', testFilePath, 0)
			const unicodeMsg = '日本語 emoji: 🎉 ñ é ü'

			await transport.send(createSendProps({ msg: unicodeMsg }))
			await transport.shutdown()

			const lines = await readLogLines(testFilePath)
			expect(lines[0]?.msg).toBe(unicodeMsg)
		})
	})
})
