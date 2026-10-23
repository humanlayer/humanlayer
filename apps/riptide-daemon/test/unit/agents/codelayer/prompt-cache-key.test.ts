import { startState, userMessage } from '@humanlayer/agentlayer-core'
import { createCodelayerAgent } from '@humanlayer/codelayer'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: 1, text: 1, reasoning: undefined },
}

describe('@humanlayer/codelayer prompt cache keys', () => {
	it('keeps a Riptide session UUID bounded and stable across parent follow-up runs', async () => {
		const sessionId = '019c8e3d-21d7-7a65-bf20-58cc264e4831'
		const capturedProviderOptions: unknown[] = []
		const model = new MockLanguageModelV3({
			modelId: 'gpt-5.3-codex',
			doStream: async (options) => {
				capturedProviderOptions.push(options.providerOptions)
				return {
					stream: simulateReadableStream({
						chunks: [
							{ type: 'stream-start', warnings: [] },
							{ type: 'text-start', id: 'response' },
							{ type: 'text-delta', id: 'response', delta: 'done' },
							{ type: 'text-end', id: 'response' },
							{ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
						],
					}),
				}
			},
		})
		const agent = await createCodelayerAgent({
			model,
			cwd: process.cwd(),
			environment: { include: false },
			providerOptionOverrides: { codex: { promptCacheKey: sessionId } },
		})
		const initial = await agent.run({ state: startState([userMessage('Initial request')]) }).result
		const followUpState = {
			...initial.state,
			messages: [...initial.state.messages, userMessage('Follow-up request')],
		}
		await agent.run({ state: followUpState }).result

		expect(capturedProviderOptions).toHaveLength(2)
		const keys = capturedProviderOptions.map(
			(options) => (options as { openai: { promptCacheKey: string } }).openai.promptCacheKey,
		)
		expect(keys).toEqual([sessionId, sessionId])
		expect(keys[0]).toHaveLength(36)
		expect(keys[0]!.length).toBeLessThanOrEqual(64)
	})
})
