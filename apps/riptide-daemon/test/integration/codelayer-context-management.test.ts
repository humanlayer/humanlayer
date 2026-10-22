import { Agent, createForkingSubagentsTool, startState, userMessage } from '@humanlayer/agentlayer-core'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import type { ORPCClient } from '../../src/agents/claudecode/types'
import { processCodelayerEventsWithStreamProducer } from '../../src/agents/codelayer/events'
import type { StreamProducerService } from '../../src/effects/services/stream-producer/stream-producer.service'
import { createTestSession } from '../helpers/session-fixtures'

const normalUsage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 2, text: 2, reasoning: 0 },
}
const summaryUsage = {
	inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 20, text: 20, reasoning: 0 },
}

function textResponse(text: string, usage = normalUsage) {
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: `text-${text}` },
		{ type: 'text-delta', id: `text-${text}`, delta: text },
		{ type: 'text-end', id: `text-${text}` },
		{ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
	]
}

function toolCallResponse(toolCallId: string, input: Record<string, unknown>) {
	const encodedInput = JSON.stringify(input)
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'tool-input-start', id: toolCallId, toolName: 'agent' },
		{ type: 'tool-input-delta', id: toolCallId, delta: encodedInput },
		{ type: 'tool-input-end', id: toolCallId },
		{ type: 'tool-call', toolCallId, toolName: 'agent', input: encodedInput },
		{ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage: normalUsage },
	]
}

const noopStreamProducer: StreamProducerService = {
	writeMessageStart: () => Effect.void,
	writeMessageStop: () => Effect.void,
	startTextBlock: () => Effect.succeed({ conversationEventId: 'noop-text-event-id' }),
	writeTextDelta: () => Effect.void,
	writeTextBlockStop: () => Effect.void,
	startThinkingBlock: () => Effect.succeed({ conversationEventId: 'noop-thinking-event-id' }),
	writeThinkingDelta: () => Effect.void,
	writeThinkingBlockStop: () => Effect.void,
	writeContentBlockStop: () => Effect.void,
	writeConversationEvent: () => Effect.void,
	getConversationEventIdForBlock: () => Effect.succeed(null),
	consumeNextConversationEventIdByType: () => Effect.succeed(null),
	getUnconsumedEmittedBlocks: () => Effect.succeed([]),
	deleteUnmaterializedBlocks: () => Effect.void,
	flush: () => Effect.void,
	getDebugState: () =>
		Effect.succeed({
			blockTypesByBlockSeq: {},
			conversationEventIdsByBlockSeq: {},
			consumedConversationEventIds: [] as string[],
			messageSeq: 0,
		}),
}

describe('CodeLayer context management integration', () => {
	test('persists fork, specialist, continuation, and compaction activity through daemon adapters', async () => {
		let modelCall = 0
		let resumedAgentId = ''
		const modelCalls: unknown[] = []
		const model = new MockLanguageModelV3({
			provider: 'mock',
			modelId: 'context-management',
			supportedUrls: {},
			doStream: async (options) => {
				modelCalls.push(options)
				modelCall += 1
				const chunks = (() => {
					switch (modelCall) {
						case 1:
							return toolCallResponse('fork-call', { prompt: 'default child task' })
						case 2:
							return textResponse('default fork child result')
						case 3:
							return textResponse('root after default fork')
						case 4:
							return toolCallResponse('specialist-call', {
								prompt: 'specialist child task',
								subagent_type: 'specialist',
							})
						case 5:
							return textResponse('specialist child result')
						case 6:
							return textResponse('root after specialist')
						case 7:
							return toolCallResponse('resume-call', {
								prompt: 'continue the default child',
								agent_id: resumedAgentId,
							})
						case 8:
							return textResponse('continued child result')
						case 9:
							return textResponse('root after child continuation')
						case 10:
							return textResponse('## Goal\nPreserve verification commands.', summaryUsage)
						case 11:
							return textResponse('root after compaction')
						default:
							throw new Error(`Unexpected scripted model call ${modelCall}`)
					}
				})()
				return {
					stream: simulateReadableStream({
						chunks: chunks as any[],
						initialDelayInMs: null,
						chunkDelayInMs: null,
					}),
				}
			},
		})

		const specialist = new Agent({ model, tools: {}, system: 'specialist instructions' })
		const agentTool = createForkingSubagentsTool({
			agents: [
				{
					name: 'specialist',
					description: 'A scripted specialist.',
					agent: specialist,
					resumable: true,
				},
			],
		})
		const root = new Agent({
			model,
			tools: { agent: agentTool },
			autoCompact: { keepRecentTokens: 20 },
			contextWindowLimit: 200_000,
		})

		const persistedEvents: Array<Record<string, unknown>> = []
		const sessionUpdates: Array<Record<string, unknown>> = []
		const orpc = {
			sessions: {
				update: vi.fn(async (input: Record<string, unknown>) => {
					sessionUpdates.push(input)
					return { success: true, transactionId: `update-${sessionUpdates.length}` }
				}),
				events: {
					create: vi.fn(async (input: Record<string, unknown>) => {
						persistedEvents.push(input)
						return {
							eventId: `event-${persistedEvents.length}`,
							transactionId: `event-tx-${persistedEvents.length}`,
						}
					}),
				},
			},
		} as unknown as ORPCClient
		const session = createTestSession({ provider: 'codex', model: 'gpt-5.4' })
		const processRun = async (run: ReturnType<Agent['run']>) => {
			await processCodelayerEventsWithStreamProducer(run, session, orpc, noopStreamProducer)
			return run.result
		}

		const forkResult = await processRun(
			root.run({
				state: startState([
					userMessage('Megan knows there is always money in the banana stand.'),
					{ role: 'assistant', content: 'Fact recorded.' },
					userMessage('Run the default fork now.'),
				]),
				stream: true,
			}),
		)
		resumedAgentId = Object.keys(forkResult.state.terminalChildren ?? {})[0] ?? ''
		expect(resumedAgentId).not.toBe('')

		const specialistResult = await processRun(
			root.run({
				state: {
					...forkResult.state,
					messages: [...forkResult.state.messages, userMessage('Run the explicit specialist now.')],
				},
				stream: true,
			}),
		)
		const specialistRecord = Object.values(specialistResult.state.terminalChildren ?? {}).find(
			(record) => record.runtime.type === 'specialist',
		)
		expect(specialistRecord?.lastOutcome).toBe('complete')

		const resumedResult = await processRun(
			root.run({
				state: {
					...specialistResult.state,
					messages: [...specialistResult.state.messages, userMessage('Continue the default child now.')],
				},
				stream: true,
			}),
		)
		expect(resumedResult.state.terminalChildren?.[resumedAgentId]?.completedTurns).toBe(2)
		const childRowsBeforeCompaction = persistedEvents.filter(
			(event) => event.parentToolUseId !== null && event.parentToolUseId !== undefined,
		)
		expect(childRowsBeforeCompaction.length).toBeGreaterThan(0)
		expect(childRowsBeforeCompaction.every((event) => typeof event.parentToolUseId === 'string')).toBe(true)

		persistedEvents.length = 0
		sessionUpdates.length = 0
		const preCompactionStateFingerprint = JSON.stringify(resumedResult.state)
		const compactedResult = await processRun(
			root.run({
				state: {
					...resumedResult.state,
					messages: [
						userMessage(`old context ${'x'.repeat(400)}`),
						{ role: 'assistant', content: `old answer ${'y'.repeat(400)}` },
						userMessage('recent context'),
						{ role: 'assistant', content: 'recent answer' },
						userMessage('/compact Preserve verification commands.'),
					],
				},
				stream: true,
			}),
		)

		expect(JSON.stringify(resumedResult.state)).toBe(preCompactionStateFingerprint)
		expect(compactedResult.state.compaction).toMatchObject({
			trigger: 'manual',
			summary: expect.stringContaining('## Goal\nPreserve verification commands.'),
		})
		expect(compactedResult.state.terminalChildren?.[resumedAgentId]?.completedTurns).toBe(2)
		expect(JSON.stringify(compactedResult.state.messages)).not.toContain('/compact')
		expect(persistedEvents).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: 'assistant', content: '## Goal\nPreserve verification commands.' }),
				expect.objectContaining({ role: 'assistant', content: 'root after compaction' }),
			]),
		)
		expect(persistedEvents).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: 'user', content: expect.stringContaining('<conversation>') }),
			]),
		)
		expect(sessionUpdates).toEqual([
			expect.objectContaining({ contextWindowTokens: 12, contextWindowLimit: 200_000 }),
		])
		expect(compactedResult.tokenUsage.totals).toMatchObject({ inputTokens: 110, outputTokens: 22 })

		expect(modelCalls).toHaveLength(11)
	})
})
