import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'

describe('Streaming Input Mode', () => {
	describe('promptGenerator pattern', () => {
		test('yields a single SDKUserMessage with the prompt content', async () => {
			const testPrompt = 'Test prompt content'
			let closeInputStream: (() => void) | undefined
			const inputStreamSuspense = new Promise<void>((resolve) => {
				closeInputStream = resolve
			})

			async function* promptGenerator(): AsyncIterable<SDKUserMessage> {
				yield {
					type: 'user',
					session_id: '',
					parent_tool_use_id: null,
					message: {
						role: 'user',
						content: testPrompt,
					},
				}
				await inputStreamSuspense
			}

			const generator = promptGenerator()
			const iterator = generator[Symbol.asyncIterator]()

			// First iteration should yield the message
			const firstResult = await iterator.next()
			expect(firstResult.done).toBe(false)
			expect(firstResult.value).toEqual({
				type: 'user',
				session_id: '',
				parent_tool_use_id: null,
				message: {
					role: 'user',
					content: testPrompt,
				},
			})

			// Second iteration should suspend until we close
			const pendingResult = iterator.next()

			// Resolve the suspense promise
			closeInputStream!()

			const secondResult = await pendingResult
			expect(secondResult.done).toBe(true)
		})

		test('generator completes when closeInputStream is called', async () => {
			let closeInputStream: (() => void) | undefined
			const inputStreamSuspense = new Promise<void>((resolve) => {
				closeInputStream = resolve
			})

			async function* promptGenerator(): AsyncIterable<SDKUserMessage> {
				yield {
					type: 'user',
					session_id: '',
					parent_tool_use_id: null,
					message: { role: 'user', content: 'test' },
				}
				await inputStreamSuspense
			}

			const messages: SDKUserMessage[] = []
			const generator = promptGenerator()

			// Start consuming the generator
			const consumePromise = (async () => {
				for await (const msg of generator) {
					messages.push(msg)
				}
			})()

			// Give the generator a chance to yield the first message
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(messages.length).toBe(1)

			// Close the input stream
			closeInputStream!()

			// Wait for consumption to complete
			await consumePromise

			// Verify only one message was yielded
			expect(messages.length).toBe(1)
		})

		test('handles empty prompt gracefully', async () => {
			const testPrompt = ''
			let closeInputStream: (() => void) | undefined
			const inputStreamSuspense = new Promise<void>((resolve) => {
				closeInputStream = resolve
			})

			async function* promptGenerator(): AsyncIterable<SDKUserMessage> {
				yield {
					type: 'user',
					session_id: '',
					parent_tool_use_id: null,
					message: {
						role: 'user',
						content: testPrompt,
					},
				}
				await inputStreamSuspense
			}

			const generator = promptGenerator()
			const iterator = generator[Symbol.asyncIterator]()

			const firstResult = await iterator.next()
			expect(firstResult.done).toBe(false)
			expect(firstResult.value.message.content).toBe('')

			closeInputStream!()
			const secondResult = await iterator.next()
			expect(secondResult.done).toBe(true)
		})
	})

	describe('closeInputStream behavior', () => {
		test('closeInputStream is undefined-safe', () => {
			// Simulating the pattern used in processEvents
			// This should not throw when closeInputStream is undefined
			const maybeClose = (fn?: () => void) => {
				if (fn) {
					fn()
				}
			}

			// Should not throw with undefined
			expect(() => maybeClose(undefined)).not.toThrow()

			// Should call the function when provided
			let called = false
			maybeClose(() => {
				called = true
			})
			expect(called).toBe(true)
		})
	})
})
