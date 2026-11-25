import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { vi } from 'vitest'

import type { ClaudeQueryFactory } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.layer'

/** A Query shaped like the Agent SDK's: the iterator is the inner generator, and close() runs its cleanup. */
export function makeSdkShapedQuery() {
	const queued: SDKMessage[] = []
	let waiter: ((result: IteratorResult<SDKMessage, void>) => void) | undefined
	let onWaiting: (() => void) | undefined
	let childAlive = true

	const cleanup = () => {
		childAlive = false
		waiter?.({ done: true, value: undefined })
		waiter = undefined
	}

	const childMessages: AsyncIterable<SDKMessage> = {
		[Symbol.asyncIterator]: () => ({
			next: () => {
				const message = queued.shift()
				if (message) return Promise.resolve({ done: false, value: message })
				if (!childAlive) return Promise.resolve({ done: true, value: undefined })
				return new Promise((resolve) => {
					waiter = resolve
					onWaiting?.()
					onWaiting = undefined
				})
			},
		}),
	}

	async function* readSdkMessages(): AsyncGenerator<SDKMessage, void> {
		try {
			for await (const message of childMessages) yield message
		} finally {
			cleanup()
		}
	}

	const sdkMessages = readSdkMessages()
	const interrupt = vi.fn(async () => {
		if (!childAlive) throw new Error('ProcessTransport is not ready for writing')
	})
	const close = vi.fn(cleanup)
	const query = { [Symbol.asyncIterator]: () => sdkMessages, interrupt, close } as unknown as Query

	return {
		factory: vi.fn(() => query) as unknown as ClaudeQueryFactory,
		interrupt,
		close,
		isChildAlive: () => childAlive,
		whenWaiting: () =>
			waiter
				? Promise.resolve()
				: new Promise<void>((resolve) => {
						onWaiting = resolve
					}),
		emit: (message: SDKMessage) => {
			if (!waiter) {
				queued.push(message)
				return
			}
			waiter({ done: false, value: message })
			waiter = undefined
		},
		/** The child exits by itself with code 0, so the output ends without an error. */
		exitChild: cleanup,
	}
}
