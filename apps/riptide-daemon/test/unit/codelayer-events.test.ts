import { AgentRun } from '@humanlayer/agentlayer-core'
import { Effect } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ORPCClient } from '../../src/agents/claudecode/types'
import { processCodelayerEventsWithStreamProducer } from '../../src/agents/codelayer/events'
import type { StreamProducerService } from '../../src/effects/services/stream-producer/stream-producer.service'
import { createTestSession } from '../helpers/session-fixtures'

const { mockLogger } = vi.hoisted(() => ({
	mockLogger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock('../../src/logger', () => ({ default: mockLogger }))
vi.mock('@/logger', () => ({ default: mockLogger }))

const mockSessionsUpdate = vi.fn(async () => ({ success: true, transactionId: `mock-txid-${Date.now()}` }))
const mockSessionsEventsCreate = vi.fn(async () => ({
	eventId: `mock-event-id-${Math.random().toString(36).slice(2)}`,
	transactionId: `mock-txid-${Date.now()}`,
}))

const mockOrpc = {
	sessions: {
		update: mockSessionsUpdate,
		events: {
			create: mockSessionsEventsCreate,
		},
	},
}

function createMockAgentRun(events: Array<Record<string, unknown>>): AgentRun {
	const run = new AgentRun()
	queueMicrotask(() => {
		for (const event of events) {
			run.pushEvent(event as any)
		}
		run.finish({
			state: { messages: [], pendingApprovals: [], approvalHistory: [] },
			newMessages: [],
			finishReason: 'complete',
			tokenUsage: {
				byModel: {},
				total: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					reasoningTokens: 0,
					estimatedCostUsd: 0,
				},
			},
		} as any)
	})
	return run
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

function createRecordingStreamProducer() {
	const calls: string[] = []
	const completedEvents: Array<Record<string, unknown>> = []
	const streamProducer: StreamProducerService = {
		writeMessageStart: () => Effect.sync(() => calls.push('message_start')),
		writeMessageStop: () => Effect.sync(() => calls.push('message_stop')),
		startTextBlock: (blockSeq) =>
			Effect.sync(() => {
				calls.push(`text_block_start:${blockSeq}`)
				return { conversationEventId: `text-event-${blockSeq}` }
			}),
		writeTextDelta: () => Effect.sync(() => calls.push('text_delta')),
		writeTextBlockStop: () => Effect.sync(() => calls.push('text_block_stop')),
		startThinkingBlock: (blockSeq) =>
			Effect.sync(() => {
				calls.push(`thinking_block_start:${blockSeq}`)
				return { conversationEventId: `thinking-event-${blockSeq}` }
			}),
		writeThinkingDelta: () => Effect.sync(() => calls.push('thinking_delta')),
		writeThinkingBlockStop: () => Effect.sync(() => calls.push('thinking_block_stop')),
		writeContentBlockStop: (blockSeq) => Effect.sync(() => calls.push(`content_block_stop:${blockSeq}`)),
		writeConversationEvent: (event) =>
			Effect.sync(() => {
				calls.push('conversation_event')
				completedEvents.push(event)
			}),
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

	return { calls, completedEvents, streamProducer }
}

async function processWithNoopStreamProducer(run: AgentRun, session: ReturnType<typeof createTestSession>) {
	return processCodelayerEventsWithStreamProducer(run, session, mockOrpc as unknown as ORPCClient, noopStreamProducer)
}

describe('processCodelayerEvents', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		mockSessionsUpdate.mockClear()
		mockSessionsEventsCreate.mockClear()
		mockLogger.debug.mockClear()
		mockLogger.error.mockClear()
		mockLogger.info.mockClear()
		mockLogger.warn.mockClear()
	})

	test('forwards runtime context window limit when present', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				usage: {
					model: 'github-copilot/gpt-4o',
					usage: {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 1500,
					contextWindowLimit: 256000,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: session.id,
			contextWindowTokens: 1500,
			contextWindowLimit: 256000,
		})
	})

	test('forwards top-level Codex runtime context window limit', async () => {
		const session = createTestSession({ provider: 'codex', model: 'gpt-5.5' })
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				usage: {
					model: 'codex/gpt-5.5',
					usage: {
						inputTokens: 238000,
						outputTokens: 2000,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 240000,
					contextWindowLimit: 258400,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: session.id,
			contextWindowTokens: 240000,
			contextWindowLimit: 258400,
		})
	})

	test('omits runtime context window limit when absent', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				usage: {
					model: 'github-copilot/gpt-4o',
					usage: {
						inputTokens: 900,
						outputTokens: 300,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 1200,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: session.id,
			contextWindowTokens: 1200,
		})
	})

	test('does not update session context window for child tokenUsage with parentToolCallId', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				parentToolCallId: 'tool-call-123',
				usage: {
					model: 'mock/mock-model',
					usage: {
						inputTokens: 200,
						outputTokens: 50,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 250,
					contextWindowLimit: 10000,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).not.toHaveBeenCalled()
	})

	test('does not update session context window for child tokenUsage with agentId only', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				agentId: 'child-agent-1',
				usage: {
					model: 'mock/mock-model',
					usage: {
						inputTokens: 300,
						outputTokens: 100,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 400,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).not.toHaveBeenCalled()
	})

	test('ignores child tokenUsage and still updates for later top-level tokenUsage', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'tokenUsage',
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
				usage: {
					model: 'mock/mock-model',
					usage: {
						inputTokens: 200,
						outputTokens: 50,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 250,
					contextWindowLimit: 10000,
				},
			},
			{
				type: 'tokenUsage',
				usage: {
					model: 'mock/mock-model',
					usage: {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 0,
					},
					contextWindowTokens: 1500,
					contextWindowLimit: 256000,
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsUpdate).toHaveBeenCalledTimes(1)
		expect(mockSessionsUpdate).toHaveBeenCalledWith({
			sessionId: session.id,
			contextWindowTokens: 1500,
			contextWindowLimit: 256000,
		})
	})

	test('stores child conversation events with parentToolUseId', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'message',
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: 'child says hello' }],
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: session.id,
				eventType: 'message',
				role: 'assistant',
				content: 'child says hello',
				parentToolUseId: 'tool-call-123',
			}),
		)
	})

	test('writes child conversation events to the durable stream without child streaming deltas', async () => {
		const session = createTestSession()
		const { calls, completedEvents, streamProducer } = createRecordingStreamProducer()
		const run = createMockAgentRun([
			{
				type: 'textStart',
				id: 'child-text-1',
				stepIndex: 0,
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
			},
			{
				type: 'textDelta',
				id: 'child-text-1',
				text: 'child says hello',
				stepIndex: 0,
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
			},
			{
				type: 'reasoningDelta',
				id: 'child-thinking-1',
				text: 'child thoughts',
				stepIndex: 0,
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
			},
			{
				type: 'message',
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'child says hello' },
						{
							type: 'tool-call',
							toolCallId: 'child-tool-1',
							toolName: 'read',
							input: { file_path: 'x.md' },
						},
					],
				},
			},
			{
				type: 'message',
				agentId: 'child-agent-1',
				parentToolCallId: 'tool-call-123',
				message: {
					role: 'tool',
					content: [
						{ type: 'tool-result', toolCallId: 'child-tool-1', output: { type: 'text', value: 'done' } },
					],
				},
			},
		])

		await processCodelayerEventsWithStreamProducer(run, session, mockOrpc as unknown as ORPCClient, streamProducer)

		expect(calls).toEqual(['conversation_event', 'conversation_event', 'conversation_event'])
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'message',
				role: 'assistant',
				content: 'child says hello',
				parentToolUseId: 'tool-call-123',
			}),
		)
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'tool_call',
				role: 'assistant',
				toolCallId: 'child-tool-1',
				parentToolUseId: 'tool-call-123',
			}),
		)
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'tool_result',
				role: 'user',
				toolResultForId: 'child-tool-1',
				parentToolUseId: 'tool-call-123',
			}),
		)
		expect(completedEvents.map((event) => event.parent_tool_use_id)).toEqual([
			'tool-call-123',
			'tool-call-123',
			'tool-call-123',
		])
		expect(completedEvents.map((event) => event.event_type)).toEqual(['message', 'tool_call', 'tool_result'])
		expect(completedEvents.every((event) => !('agent_id' in event))).toBe(true)
	})

	test('stores file operation tool names as emitted by CodeLayer', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{ type: 'tool-call', toolCallId: 'tool-1', toolName: 'read', input: { file_path: 'x.md' } },
					],
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'tool_call',
				toolName: 'read',
			}),
		)
	})

	test('canonicalizes agent-like tool aliases to agent', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool-call',
							toolCallId: 'tool-1',
							toolName: 'functions.agent',
							input: { subagent_type: 'general-purpose', description: 'help' },
						},
					],
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'tool_call',
				toolName: 'agent',
			}),
		)
	})

	test('persists runtime user-role messages as session events', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'message',
				message: {
					role: 'user',
					content: 'Please continue with this fix',
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: session.id,
				eventType: 'message',
				role: 'user',
				content: 'Please continue with this fix',
			}),
		)
	})

	test('persists only the root compaction result, logs metadata, and leaves root context unchanged', async () => {
		const session = createTestSession({ provider: 'codex', model: 'gpt-5.4' })
		const run = createMockAgentRun([
			{
				type: 'message',
				message: {
					role: 'user',
					content: '<conversation>\nolder work\n</conversation>\n\nCreate a concise summary.',
				},
			},
			{
				type: 'message',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: '## Goal\nPreserve the banana stand.' }],
				},
			},
			{
				type: 'compaction',
				trigger: 'manual',
				priorContextWindowTokens: 240_000,
				replacedMessageCount: 8,
				retainedMessageCount: 2,
				summaryUsage: {
					model: 'codex/gpt-5.4',
					usage: {
						inputTokens: 4000,
						outputTokens: 500,
						cacheReadTokens: 1000,
						cacheWriteTokens: 0,
						reasoningTokens: 100,
					},
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'message',
				role: 'assistant',
				content: '## Goal\nPreserve the banana stand.',
				parentToolUseId: null,
			}),
		)
		expect(mockSessionsUpdate).not.toHaveBeenCalled()
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: session.id,
				trigger: 'manual',
				priorContextWindowTokens: 240_000,
				replacedMessageCount: 8,
				retainedMessageCount: 2,
				summaryModel: 'codex/gpt-5.4',
			}),
			'CodeLayer context compacted',
		)
	})

	test('retains child linkage for the compaction result and ignores child summary context usage', async () => {
		const session = createTestSession({ provider: 'codex', model: 'gpt-5.4' })
		const childMeta = { agentId: 'child-agent-1', parentToolCallId: 'agent-call-1' }
		const run = createMockAgentRun([
			{
				type: 'message',
				...childMeta,
				message: { role: 'user', content: '<conversation>\nchild history\n</conversation>' },
			},
			{
				type: 'message',
				...childMeta,
				message: { role: 'assistant', content: [{ type: 'text', text: 'child summary' }] },
			},
			{
				type: 'compaction',
				...childMeta,
				trigger: 'threshold',
				replacedMessageCount: 4,
				retainedMessageCount: 1,
				summaryUsage: {
					model: 'codex/gpt-5.4',
					usage: {
						inputTokens: 2000,
						outputTokens: 250,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						reasoningTokens: 50,
					},
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
		expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
			expect.objectContaining({ role: 'assistant', parentToolUseId: 'agent-call-1' }),
		)
		expect(mockSessionsUpdate).not.toHaveBeenCalled()
		expect(mockLogger.info).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: 'child-agent-1',
				parentToolCallId: 'agent-call-1',
				trigger: 'threshold',
			}),
			'CodeLayer context compacted',
		)
	})

	test('does not persist runtime system-role messages', async () => {
		const session = createTestSession()
		const run = createMockAgentRun([
			{
				type: 'message',
				message: {
					role: 'system',
					content: 'internal system instruction',
				},
			},
		])

		await processWithNoopStreamProducer(run, session)

		expect(mockSessionsEventsCreate).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'system' }))
		expect(mockSessionsEventsCreate).not.toHaveBeenCalled()
	})
})
