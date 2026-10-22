import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChangeEvent } from '@durable-streams/state'
import * as BunServices from '@effect/platform-bun/BunServices'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { RiptideDaemonApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import type { StreamEvent } from '@humanlayer/streams/events'
import type { ContractRouterClient } from '@orpc/contract'
import { Effect, Layer, Ref, Stream } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createTestSession } from '../helpers/session-fixtures'

// Record API calls made by the Effect-native event workflow.
const _mock = vi.fn
const mockSessionsUpdate = vi.fn(async (_input?: unknown) => ({
	success: true,
	transactionId: `mock-txid-${Date.now()}`,
}))
const mockSessionsEventsCreate = vi.fn(async (input?: { eventId?: string }) => ({
	eventId: input?.eventId ?? `mock-event-id-${Math.random().toString(36).slice(2)}`,
	transactionId: `mock-txid-${Date.now()}`,
}))
const mockSessionsUsageRecord = vi.fn(async (_input?: unknown) => ({ recorded: 1 }))

const mockOrpc = {
	sessions: {
		update: (input: never) => mockSessionsUpdate(input),
		events: {
			create: (input: never) => mockSessionsEventsCreate(input),
		},
		usage: {
			record: (input: never) => mockSessionsUsageRecord(input),
		},
	},
}

import { createInterruptState } from '../../src/agents/shared/interrupt-state.service'
import { ClaudeSdkError } from '../../src/effects/services/claude-sessions/sdk/claude-sdk-error'
import type { ClaudeSdkSession } from '../../src/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { processClaudeEvents } from '../../src/effects/services/claude-sessions/workflows/process-events'
import { DaemonApiLive } from '../../src/effects/services/daemon-api/daemon-api.layer'
import {
	DurableStreamWriter,
	StreamProducerLive,
} from '../../src/effects/services/stream-producer/stream-producer.service'
import { HostUsageLimitsLive } from '../../src/lib/usage-limits/host-usage-limits'

type InterruptStateService = Awaited<ReturnType<typeof createInterruptState>>
type SessionORPCClient = ContractRouterClient<typeof RiptideDaemonApiContract>

type StreamEventValueWithConversationId = {
	conversation_event_id?: string
	event_type?: string
	role?: string
	content?: string | null
}

/**
 * Creates the SDK output sequence used by the test session.
 */
function createMockEventIterator(events: Array<{ type: string; subtype?: string; [key: string]: unknown }>) {
	return events as SDKMessage[]
}

async function processEventsWithTestStreamProducer(
	events: ReturnType<typeof createMockEventIterator>,
	session: Session,
	orpc: SessionORPCClient,
	closeInputStream?: () => void,
	interruptState?: InterruptStateService,
) {
	const TestWriterLive = Layer.succeed(DurableStreamWriter, {
		sessionId: session.id,
		append: () => Effect.void,
		flush: () => Effect.void,
	})
	const layer = StreamProducerLive.pipe(Layer.provide(TestWriterLive))

	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const sdkSession: ClaudeSdkSession = {
					output: Stream.fromIterable(events),
					input: {
						sendMessage: () => Effect.void,
						close: closeInputStream ? Effect.sync(closeInputStream) : Effect.void,
					},
					controls: {
						interrupt: Effect.void,
						setModel: () => Effect.void,
						setPermissionMode: () => Effect.void,
						supportedCommands: Effect.succeed([]),
						readUsage: Effect.succeed(undefined),
					},
					markCompleted: Effect.void,
				}
				yield* processClaudeEvents({
					session,
					sdkSession,
					closeInputOnResult: closeInputStream !== undefined,
					interruptState: interruptState ?? (yield* Effect.promise(createInterruptState)),
				})
			}).pipe(
				Effect.provide(layer),
				Effect.provide(HostUsageLimitsLive),
				Effect.provide(DaemonApiLive(orpc as never)),
				Effect.provide(BunServices.layer),
			),
		),
	)
}

describe('processClaudeEvents', () => {
	afterEach(() => {
		mockSessionsUpdate.mockClear()
		mockSessionsEventsCreate.mockClear()
		mockSessionsUsageRecord.mockClear()
		mockSessionsUsageRecord.mockImplementation(async () => ({ recorded: 1 }))
	})

	test('releases an idle publication worker when the SDK output fails', async () => {
		const session = createTestSession()
		const TestWriterLive = Layer.succeed(DurableStreamWriter, {
			sessionId: session.id,
			append: () => Effect.void,
			flush: () => Effect.void,
		})
		const layer = StreamProducerLive.pipe(Layer.provide(TestWriterLive))
		const sdkSession: ClaudeSdkSession = {
			output: Stream.fail(
				new ClaudeSdkError({ operation: 'output', cause: new Error('interrupted SDK output') }),
			),
			input: { sendMessage: () => Effect.void, close: Effect.void },
			controls: {
				interrupt: Effect.void,
				setModel: () => Effect.void,
				setPermissionMode: () => Effect.void,
				supportedCommands: Effect.succeed([]),
				readUsage: Effect.succeed(undefined),
			},
			markCompleted: Effect.void,
		}
		const interruptState = await createInterruptState()
		await Effect.runPromise(interruptState.markInterrupted(null))
		const program = processClaudeEvents({ session, sdkSession, interruptState }).pipe(
			Effect.provide(layer),
			Effect.provide(HostUsageLimitsLive),
			Effect.provide(DaemonApiLive(mockOrpc as never)),
			Effect.provide(BunServices.layer),
		)

		await expect(Effect.runPromise(program)).rejects.toThrow('interrupted SDK output')
	})

	describe('closeInputStream callback', () => {
		test('calls closeInputStream when result event is received', async () => {
			const closeInputStream = vi.fn(() => {})

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(
				mockEvents,
				session,
				mockOrpc as unknown as SessionORPCClient,
				closeInputStream,
			)

			expect(closeInputStream).toHaveBeenCalledTimes(1)
		})

		test('calls closeInputStream on error result as well', async () => {
			const closeInputStream = vi.fn(() => {})

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'error' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(
				mockEvents,
				session,
				mockOrpc as unknown as SessionORPCClient,
				closeInputStream,
			)

			expect(closeInputStream).toHaveBeenCalledTimes(1)
		})

		test('does not throw when closeInputStream is undefined', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await expect(
				processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient),
			).resolves.toBeUndefined()
		})

		test('calls closeInputStream after orpc update on result', async () => {
			const callOrder: string[] = []

			const closeInputStream = vi.fn(() => {
				callOrder.push('closeInputStream')
			})

			mockSessionsUpdate.mockImplementation(async () => {
				callOrder.push('orpc-update')
				return { success: true, transactionId: `mock-txid-${Date.now()}` }
			})

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(
				mockEvents,
				session,
				mockOrpc as unknown as SessionORPCClient,
				closeInputStream,
			)

			// The last orpc update (for result) should come before closeInputStream
			const lastUpdateIndex = callOrder.lastIndexOf('orpc-update')
			const closeIndex = callOrder.indexOf('closeInputStream')
			expect(lastUpdateIndex).toBeLessThan(closeIndex)
		})
	})

	describe('oRPC calls', () => {
		test('skips assistant messages received after an interrupt request', async () => {
			const interruptState = await createInterruptState()
			await Effect.runPromise(interruptState.markInterrupted('resume prompt'))

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'assistant',
					uuid: 'interrupted-assistant-event',
					parent_tool_use_id: null,
					message: { role: 'assistant', content: 'partial interrupted response' },
				},
				{ type: 'result', subtype: 'error_during_execution' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(
				mockEvents,
				session,
				mockOrpc as unknown as SessionORPCClient,
				undefined,
				interruptState,
			)

			expect(mockSessionsEventsCreate).not.toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: 'message',
					role: 'assistant',
					content: 'partial interrupted response',
				}),
			)
		})

		test('updates session status on system init', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'claude-haiku-4-5-20251001' },
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			// The init event's model goes to resolvedModel only. sessions.model is the
			// user-selected value (and the continuation/resume channel) — init must not
			// overwrite it with the resolved ID, or e.g. Bedrock sessions pinned via the
			// 'haiku' alias would resume on an ID Bedrock rejects.
			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					codingAgentSessionId: 'sdk-session-123',
					status: 'running',
					resolvedModel: 'claude-haiku-4-5-20251001',
				}),
			)
			expect(mockSessionsUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ model: expect.anything() }))
		})

		test('records resolved Opus 5.5 identity without replacing the pinned selection', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-opus-5-5', model: 'claude-opus-5-5' },
				{ type: 'result', subtype: 'success' },
			])
			const session = createTestSession({ model: 'claude-opus-5-5' })

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					codingAgentSessionId: 'sdk-session-opus-5-5',
					resolvedModel: 'claude-opus-5-5',
				}),
			)
			expect(mockSessionsUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ model: expect.anything() }))
		})

		test('model refusal fallback rewrites both the user-facing model and resolvedModel', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'claude-opus-5' },
				{
					type: 'system',
					subtype: 'model_refusal_fallback',
					session_id: 'sdk-session-123',
					content: 'Downgraded to Opus 4.8 after a refusal',
					original_model: 'claude-opus-5',
					fallback_model: 'claude-opus-4-8',
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			// An explicit downgrade is the one case that changes the user-facing model
			// (picker + continuation/resume channel), alongside the observed model.
			expect(mockSessionsUpdate).toHaveBeenCalledWith({
				sessionId: session.id,
				model: 'claude-opus-4-8',
				resolvedModel: 'claude-opus-4-8',
			})
		})

		test('updates session status on success result', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					status: 'ready_for_input',
				}),
			)
		})

		test('updates session status on error result', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'error' },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					status: 'failed',
				}),
			)
		})

		test('sends per-run usage with the result event uuid as usageReportKey', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'result',
					subtype: 'success',
					uuid: 'result-event-uuid-1',
					total_cost_usd: 0.42,
					modelUsage: {
						'claude-sonnet-4-5': {
							inputTokens: 100,
							outputTokens: 50,
							cacheReadInputTokens: 1000,
							cacheCreationInputTokens: 200,
						},
					},
				},
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					status: 'ready_for_input',
					totalCostUsd: 0.42,
					modelUsage: {
						'claude-sonnet-4-5': {
							input_tokens: 100,
							output_tokens: 50,
							cache_read_input_tokens: 1000,
							cache_creation_input_tokens: 200,
						},
					},
					usageReportKey: 'result-event-uuid-1',
				}),
			)

			// The append-only usage event carries the same reportKey plus the SDK's per-model
			// costUSD (which the snapshot map above drops), one entry per model, raw token map.
			expect(mockSessionsUsageRecord).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					reportKey: 'result-event-uuid-1',
					source: 'claude_sdk_result',
					occurredAt: expect.any(Number),
					entries: [
						{
							model: 'claude-sonnet-4-5',
							tokens: {
								input_tokens: 100,
								output_tokens: 50,
								cache_read_input_tokens: 1000,
								cache_creation_input_tokens: 200,
							},
						},
					],
				}),
			)
		})

		test('a failed usage record is non-fatal and does not block the status update', async () => {
			mockSessionsUsageRecord.mockImplementation(async () => {
				throw new Error('usage endpoint down')
			})

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'result',
					subtype: 'success',
					uuid: 'result-event-uuid-2',
					total_cost_usd: 0.1,
					modelUsage: {
						'claude-sonnet-4-5': {
							inputTokens: 10,
							outputTokens: 5,
							cacheReadInputTokens: 0,
							cacheCreationInputTokens: 0,
						},
					},
				},
			])

			const session = createTestSession()

			// Must not reject even though usage.record threw.
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsUsageRecord).toHaveBeenCalledTimes(1)
			// The terminal status still landed.
			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: session.id, status: 'ready_for_input' }),
			)
		})

		test('generates a fallback usageReportKey when the result event has no uuid', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{ type: 'result', subtype: 'success', total_cost_usd: 0.1 },
			])

			const session = createTestSession()

			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			// An omitted key would flip the API into legacy overwrite mode and clobber
			// totals accumulated from earlier runs, so the daemon mints one instead.
			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: session.id,
					status: 'ready_for_input',
					totalCostUsd: 0.1,
					usageReportKey: expect.any(String),
				}),
			)
		})
	})

	describe('usage limit parking', () => {
		const init = { type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' }
		const rejected = {
			type: 'rate_limit_event',
			rate_limit_info: {
				status: 'rejected',
				rateLimitType: 'five_hour',
				utilization: 1,
				resetsAt: 1_700_000_500,
			},
		}
		const allowed = {
			type: 'rate_limit_event',
			rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1 },
		}
		const statusUpdates = () =>
			mockSessionsUpdate.mock.calls
				.map(([input]) => (input as { status?: string } | undefined)?.status)
				.filter((status) => status !== undefined)

		test('parks the session once on a rejection with no overage, then resumes on the next allowed event', async () => {
			const session = createTestSession()
			await processEventsWithTestStreamProducer(
				createMockEventIterator([init, rejected, rejected, allowed, { type: 'result', subtype: 'success' }]),
				session,
				mockOrpc as unknown as SessionORPCClient,
			)
			expect(statusUpdates()).toEqual(['running', 'waiting_for_usage_limit', 'running', 'ready_for_input'])
			expect(mockSessionsUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'waiting_for_usage_limit',
					errorMessage: 'Claude 5-hour usage limit reached.',
				}),
			)
		})

		test('does not park when overage keeps the turn running', async () => {
			const session = createTestSession()
			await processEventsWithTestStreamProducer(
				createMockEventIterator([
					init,
					{ ...rejected, rate_limit_info: { ...rejected.rate_limit_info, overageStatus: 'allowed' } },
					{ type: 'result', subtype: 'success' },
				]),
				session,
				mockOrpc as unknown as SessionORPCClient,
			)
			expect(statusUpdates()).toEqual(['running', 'ready_for_input'])
		})

		test('leaves an interrupt request in place instead of resuming a parked session', async () => {
			const interruptState = await createInterruptState()
			const session = createTestSession()
			await processEventsWithTestStreamProducer(
				createMockEventIterator([init, rejected]),
				session,
				mockOrpc as unknown as SessionORPCClient,
				undefined,
				interruptState,
			)
			expect(statusUpdates()).toEqual(['running', 'waiting_for_usage_limit'])
			mockSessionsUpdate.mockClear()
			await Effect.runPromise(interruptState.markInterrupted('stop'))
			await processEventsWithTestStreamProducer(
				createMockEventIterator([init, rejected, allowed]),
				session,
				mockOrpc as unknown as SessionORPCClient,
				undefined,
				interruptState,
			)
			expect(statusUpdates()).toEqual(['running', 'waiting_for_usage_limit'])
		})

		test('keeps the session running through a rate limit event without rate limit info', async () => {
			const session = createTestSession()
			await processEventsWithTestStreamProducer(
				createMockEventIterator([
					init,
					{ type: 'rate_limit_event' },
					{ type: 'rate_limit_event', rate_limit_info: null },
					{ type: 'result', subtype: 'success' },
				]),
				session,
				mockOrpc as unknown as SessionORPCClient,
			)
			expect(statusUpdates()).toEqual(['running', 'ready_for_input'])
		})
	})

	describe('token usage deduplication (parallel tool use)', () => {
		// Parallel tool use: the SDK emits multiple assistant messages whose nested
		// API message shares the same `id` with identical usage. Tokens must only be
		// attached once per message id or downstream sums double-count.
		// See: https://platform.claude.com/docs/en/agent-sdk/cost-tracking
		const usage = {
			input_tokens: 100,
			output_tokens: 50,
			cache_read_input_tokens: 10,
			cache_creation_input_tokens: 5,
		}
		// inputTokens = input + cache_read + cache_creation
		const expectedInputTokens = 115
		const expectedOutputTokens = 50

		const assistantToolUseMessage = (messageId: string, uuid: string, toolUseId: string) => ({
			type: 'assistant',
			uuid,
			parent_tool_use_id: null,
			session_id: 'sdk-session-123',
			message: {
				id: messageId,
				role: 'assistant',
				content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: {} }],
				usage,
			},
		})

		const toolCallCreateCalls = () =>
			(mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>).filter(
				([input]) => input.eventType === 'tool_call',
			)

		test('attaches tokens only once when two assistant messages share the same message id', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				assistantToolUseMessage('msg_shared', 'assistant-uuid-1', 'tool-1'),
				assistantToolUseMessage('msg_shared', 'assistant-uuid-2', 'tool-2'),
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const toolCalls = toolCallCreateCalls()
			expect(toolCalls).toHaveLength(2)
			expect(toolCalls[0]![0]).toMatchObject({
				toolCallId: 'tool-1',
				inputTokens: expectedInputTokens,
				outputTokens: expectedOutputTokens,
			})
			expect(toolCalls[1]![0].toolCallId).toBe('tool-2')
			expect(toolCalls[1]![0].inputTokens).toBeUndefined()
			expect(toolCalls[1]![0].outputTokens).toBeUndefined()
		})

		test('attaches tokens to both messages when message ids are distinct', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				assistantToolUseMessage('msg_first', 'assistant-uuid-1', 'tool-1'),
				assistantToolUseMessage('msg_second', 'assistant-uuid-2', 'tool-2'),
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const toolCalls = toolCallCreateCalls()
			expect(toolCalls).toHaveLength(2)
			for (const [input] of toolCalls) {
				expect(input.inputTokens).toBe(expectedInputTokens)
				expect(input.outputTokens).toBe(expectedOutputTokens)
			}
		})

		test('falls back to a same-id sibling when the first sibling persists no event', async () => {
			// The message id must only be marked as counted once its usage is
			// attached to a created event: a first sibling made entirely of
			// untransformable blocks persists nothing, so the duplicate sibling
			// must still carry the turn's tokens.
			const unknownBlockMessage = {
				type: 'assistant',
				uuid: 'assistant-uuid-1',
				parent_tool_use_id: null,
				session_id: 'sdk-session-123',
				message: {
					id: 'msg_shared',
					role: 'assistant',
					content: [{ type: 'server_tool_use', id: 'srv-1', name: 'web_search', input: {} }],
					usage,
				},
			}
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				unknownBlockMessage,
				assistantToolUseMessage('msg_shared', 'assistant-uuid-2', 'tool-2'),
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const toolCalls = toolCallCreateCalls()
			expect(toolCalls).toHaveLength(1)
			expect(toolCalls[0]![0]).toMatchObject({
				toolCallId: 'tool-2',
				inputTokens: expectedInputTokens,
				outputTokens: expectedOutputTokens,
			})
		})

		test('attaches tokens to the first transformable block when the leading block is unknown', async () => {
			const mixedBlocksMessage = {
				type: 'assistant',
				uuid: 'assistant-uuid-1',
				parent_tool_use_id: null,
				session_id: 'sdk-session-123',
				message: {
					id: 'msg_mixed',
					role: 'assistant',
					content: [
						{ type: 'server_tool_use', id: 'srv-1', name: 'web_search', input: {} },
						{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
					],
					usage,
				},
			}
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				mixedBlocksMessage,
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const toolCalls = toolCallCreateCalls()
			expect(toolCalls).toHaveLength(1)
			expect(toolCalls[0]![0]).toMatchObject({
				toolCallId: 'tool-1',
				inputTokens: expectedInputTokens,
				outputTokens: expectedOutputTokens,
			})
		})
	})

	describe('stream event ID propagation', () => {
		const processEventsWithCapturedStream = async (
			session: Session,
			events: ReturnType<typeof createMockEventIterator>,
		) => {
			const appendedEvents = Ref.makeUnsafe<Array<ChangeEvent<StreamEvent>>>([])
			const TestWriterLive = Layer.succeed(DurableStreamWriter, {
				sessionId: session.id,
				append: (event) => Ref.update(appendedEvents, (current) => [...current, event]),
				flush: () => Effect.void,
			})
			const layer = StreamProducerLive.pipe(Layer.provide(TestWriterLive))

			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const interruptState = yield* Effect.promise(createInterruptState)
						const sdkSession: ClaudeSdkSession = {
							output: Stream.fromIterable(events),
							input: { sendMessage: () => Effect.void, close: Effect.void },
							controls: {
								interrupt: Effect.void,
								setModel: () => Effect.void,
								setPermissionMode: () => Effect.void,
								supportedCommands: Effect.succeed([]),
								readUsage: Effect.succeed(undefined),
							},
							markCompleted: Effect.void,
						}
						yield* processClaudeEvents({ session, sdkSession, interruptState })
					}).pipe(
						Effect.provide(layer),
						Effect.provide(HostUsageLimitsLive),
						Effect.provide(DaemonApiLive(mockOrpc as never)),
						Effect.provide(BunServices.layer),
					),
				),
			)

			return Effect.runSync(Ref.get(appendedEvents))
		}

		test('maps completed text content to streamed text block when thinking shifts stream block index', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc2c' })
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'stream_event',
					event: { type: 'message_start', message: { role: 'assistant', content: [] } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
				{
					type: 'assistant',
					uuid: 'assistant-text-event',
					parent_tool_use_id: null,
					message: { role: 'assistant', content: 'hello' },
				},
				{ type: 'stream_event', event: { type: 'message_stop' } },
				{ type: 'result', subtype: 'success' },
			])

			const streamEvents = await processEventsWithCapturedStream(session, mockEvents)
			const streamedTextEventId = (
				streamEvents.find((event) => event.type === 'text_block_start')?.value as
					| StreamEventValueWithConversationId
					| undefined
			)?.conversation_event_id
			const messageCreateCall = (
				mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			).find(([input]) => input.eventType === 'message' && input.role === 'assistant')

			expect(streamedTextEventId).toBeDefined()
			expect(messageCreateCall?.[0].eventId).toBe(streamedTextEventId)
			const completedStreamEvent = streamEvents.find((event) => event.type === 'conversation_event')?.value as
				| StreamEventValueWithConversationId
				| undefined
			expect(completedStreamEvent?.conversation_event_id).toBe(streamedTextEventId)
			expect(completedStreamEvent?.event_type).toBe('message')
			expect(completedStreamEvent?.role).toBe('assistant')
			expect(completedStreamEvent?.content).toBe('hello')
		})

		test('preserves streamed block indexes when a fallback block is skipped', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc2c' })
			const fallbackBlock = {
				type: 'fallback',
				from: { model: 'claude-opus-4-6' },
				to: { model: 'claude-sonnet-4-6' },
				trigger: { type: 'refusal', category: null },
			}
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'stream_event',
					event: { type: 'message_start', message: { role: 'assistant', content: [] } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 0, content_block: fallbackBlock },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
				{
					type: 'assistant',
					uuid: 'assistant-text-event',
					parent_tool_use_id: null,
					message: { role: 'assistant', content: [fallbackBlock, { type: 'text', text: 'hello' }] },
				},
				{ type: 'stream_event', event: { type: 'message_stop' } },
				{ type: 'result', subtype: 'success' },
			])

			const streamEvents = await processEventsWithCapturedStream(session, mockEvents)
			const streamedTextEventId = (
				streamEvents.find((event) => event.type === 'text_block_start')?.value as
					| StreamEventValueWithConversationId
					| undefined
			)?.conversation_event_id
			const messageCreateCall = (
				mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			).find(([input]) => input.eventType === 'message' && input.role === 'assistant')

			expect(streamedTextEventId).toBeDefined()
			expect(messageCreateCall?.[0].eventId).toBe(streamedTextEventId)
		})

		test('maps completed thinking content to streamed thinking block ID', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc2d' })
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'stream_event',
					event: { type: 'message_start', message: { role: 'assistant', content: [] } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
				},
				{
					type: 'stream_event',
					event: {
						type: 'content_block_delta',
						index: 0,
						delta: { type: 'thinking_delta', thinking: 'I should reason first.' },
					},
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
				{
					type: 'assistant',
					uuid: 'assistant-thinking-event',
					parent_tool_use_id: null,
					message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'I should reason first.' }] },
				},
				{ type: 'stream_event', event: { type: 'message_stop' } },
				{ type: 'result', subtype: 'success' },
			])

			const streamEvents = await processEventsWithCapturedStream(session, mockEvents)
			const streamedThinkingEventId = (
				streamEvents.find((event) => event.type === 'thinking_block_start')?.value as
					| StreamEventValueWithConversationId
					| undefined
			)?.conversation_event_id
			const thinkingCreateCall = (
				mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			).find(([input]) => input.eventType === 'thinking' && input.role === 'assistant')

			expect(streamedThinkingEventId).toBeDefined()
			expect(thinkingCreateCall?.[0].eventId).toBe(streamedThinkingEventId)
		})

		test('maps multiple completed text blocks to streamed text IDs by unconsumed type order', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc2e' })
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'stream_event',
					event: { type: 'message_start', message: { role: 'assistant', content: [] } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'first' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
				{
					type: 'stream_event',
					event: { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } },
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'second' } },
				},
				{ type: 'stream_event', event: { type: 'content_block_stop', index: 2 } },
				{
					type: 'assistant',
					uuid: 'assistant-text-event',
					parent_tool_use_id: null,
					message: {
						role: 'assistant',
						content: [
							{ type: 'text', text: 'first' },
							{ type: 'text', text: 'second' },
						],
					},
				},
				{ type: 'stream_event', event: { type: 'message_stop' } },
				{ type: 'result', subtype: 'success' },
			])

			const streamEvents = await processEventsWithCapturedStream(session, mockEvents)
			const streamedTextEventIds = streamEvents
				.filter((event) => event.type === 'text_block_start')
				.map((event) => (event.value as StreamEventValueWithConversationId).conversation_event_id)
			const messageCreateCalls = (
				mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			).filter(([input]) => input.eventType === 'message' && input.role === 'assistant')

			expect(messageCreateCalls.map(([input]) => input.eventId)).toEqual(streamedTextEventIds)
		})

		// CORE-1588 thinking-orphan probes: ~92% of orphaned streamed blocks are `thinking`.
		// Each streams a thinking block, then varies the FINAL assistant message, and asserts the
		// streamed thinking id was finalized (events.create called with it). If a shape orphans, it goes RED.
		const streamedThinkingIdOf = (streamEvents: Array<ChangeEvent<StreamEvent>>) =>
			(
				streamEvents.find((event) => event.type === 'thinking_block_start')?.value as
					| StreamEventValueWithConversationId
					| undefined
			)?.conversation_event_id
		const wasMaterialized = (id: string | undefined) =>
			(mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>).some(
				([input]) => input.eventId === id,
			)

		test('CORE-1588-T1: empty thinking block (SDK #337, thinking:"") still materializes — NOT an orphan', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc30' })
			const streamEvents = await processEventsWithCapturedStream(
				session,
				createMockEventIterator([
					{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
					{
						type: 'stream_event',
						event: { type: 'message_start', message: { role: 'assistant', content: [] } },
					},
					{
						type: 'stream_event',
						event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
					},
					{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
					{
						type: 'assistant',
						uuid: 'a1',
						parent_tool_use_id: null,
						message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'sig' }] },
					},
					{ type: 'stream_event', event: { type: 'message_stop' } },
					{ type: 'result', subtype: 'success' },
				]),
			)
			const thinkingId = streamedThinkingIdOf(streamEvents)
			expect(thinkingId).toBeDefined()
			expect(wasMaterialized(thinkingId)).toBe(true)
		})

		test('CORE-1588-T2: a redacted_thinking final block ORPHANS the streamed thinking block (daemon ignores redacted_thinking)', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc31' })
			const streamEvents = await processEventsWithCapturedStream(
				session,
				createMockEventIterator([
					{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
					{
						type: 'stream_event',
						event: { type: 'message_start', message: { role: 'assistant', content: [] } },
					},
					{
						type: 'stream_event',
						event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
					},
					{
						type: 'stream_event',
						event: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'thinking_delta', thinking: 'reasoning' },
						},
					},
					{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
					{
						type: 'assistant',
						uuid: 'a1',
						parent_tool_use_id: null,
						message: { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'enc' }] },
					},
					{ type: 'stream_event', event: { type: 'message_stop' } },
					{ type: 'result', subtype: 'success' },
				]),
			)
			const thinkingId = streamedThinkingIdOf(streamEvents)
			expect(thinkingId).toBeDefined()
			// DESIRED: the streamed thinking block is finalized under its id. RED if redacted_thinking orphans it.
			expect(wasMaterialized(thinkingId)).toBe(true)
		})

		test('CORE-1588-T3: a thinking block streamed but ABSENT from the final message ORPHANS it', async () => {
			const session = createTestSession({ id: '019e2a25-1b99-7540-8107-045b9e53cc32' })
			const streamEvents = await processEventsWithCapturedStream(
				session,
				createMockEventIterator([
					{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
					{
						type: 'stream_event',
						event: { type: 'message_start', message: { role: 'assistant', content: [] } },
					},
					{
						type: 'stream_event',
						event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
					},
					{
						type: 'stream_event',
						event: {
							type: 'content_block_delta',
							index: 0,
							delta: { type: 'thinking_delta', thinking: 'reasoning' },
						},
					},
					{ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
					{
						type: 'stream_event',
						event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
					},
					{
						type: 'stream_event',
						event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
					},
					{ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
					{
						type: 'assistant',
						uuid: 'a1',
						parent_tool_use_id: null,
						message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
					},
					{ type: 'stream_event', event: { type: 'message_stop' } },
					{ type: 'result', subtype: 'success' },
				]),
			)
			const thinkingId = streamedThinkingIdOf(streamEvents)
			expect(thinkingId).toBeDefined()
			// DESIRED: finalized. RED if absence-from-final orphans it.
			expect(wasMaterialized(thinkingId)).toBe(true)
		})
	})

	describe('content block handling', () => {
		test('skips fallback blocks and stores later text blocks', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'assistant',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'assistant',
						content: [
							{
								type: 'fallback',
								from: { model: 'claude-opus-4-6' },
								to: { model: 'claude-sonnet-4-6' },
								trigger: { type: 'refusal', category: null },
							},
							{ type: 'text', text: 'Fallback response' },
						],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({ eventType: 'message', content: 'Fallback response' }),
			)
			expect(mockSessionsUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
		})

		test('skips unknown future blocks and stores later text blocks', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'assistant',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'assistant',
						content: [
							{ type: 'future_content_block', value: 'ignored' },
							{ type: 'text', text: 'Known response' },
						],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({ eventType: 'message', content: 'Known response' }),
			)
			expect(mockSessionsUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
		})

		test('allows messages containing only unknown future blocks', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'assistant',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'assistant',
						content: [{ type: 'future_content_block', value: 'ignored' }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).not.toHaveBeenCalled()
			expect(mockSessionsUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
		})

		test('rejects malformed blocks with known content types', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'assistant',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: { role: 'assistant', content: [{ type: 'text' }] },
				},
			])

			const session = createTestSession()
			await expect(
				processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient),
			).rejects.toMatchObject({ _tag: 'ClaudeSessionDataError' })
		})

		test('skips PDF document payloads and stores later text blocks', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [
							{
								type: 'document',
								source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' },
							},
							{ type: 'text', text: 'PDF read complete' },
						],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledTimes(1)
			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({ eventType: 'message', content: 'PDF read complete' }),
			)
		})

		test('stores normal text tool results as-is', async () => {
			const normalContent = 'function hello() { return "world"; }\n'
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: normalContent }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: 'tool_result',
					toolResultContent: normalContent,
				}),
			)
		})

		test('stores text with unicode/emoji/control chars as-is', async () => {
			const specialContent = 'Hello 世界 🌍\t\nconst x = "مرحبا";\r\n'
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: specialContent }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: 'tool_result',
					toolResultContent: specialContent,
				}),
			)
		})

		test('replaces binary content containing null bytes with placeholder', async () => {
			const binaryContent = 'ELF\0\0\0\0\x7f\0binary\0data'
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: binaryContent }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const calls = mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			const call = calls.find((c) => c[0].eventType === 'tool_result')
			expect(call).toBeDefined()
			const toolResultContent = call![0].toolResultContent as string
			expect(toolResultContent).toMatch(/\[binary content, \d+ bytes\]/)
			expect(toolResultContent).not.toContain('\0')
		})

		test('handles realistic binary file content (Mach-O header)', async () => {
			const buf = Buffer.from([
				0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01, 0x03, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
			])
			const binaryString = buf.toString('utf-8')

			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: binaryString }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const calls = mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>
			const call = calls.find((c) => c[0].eventType === 'tool_result')
			expect(call).toBeDefined()
			const toolResultContent = call![0].toolResultContent as string
			expect(toolResultContent).toMatch(/\[binary content, \d+ bytes\]/)
			expect(toolResultContent).not.toContain('\0')
		})

		test('JSON-stringifies array content blocks', async () => {
			const arrayContent = [
				{ type: 'text', text: 'File contents:' },
				{ type: 'image', source: { type: 'base64', data: 'iVBOR', media_type: 'image/png' } },
			]
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'user',
					uuid: 'event-1',
					parent_tool_use_id: null,
					session_id: 'sdk-session-123',
					message: {
						role: 'user',
						content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: arrayContent }],
					},
				},
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			expect(mockSessionsEventsCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					eventType: 'tool_result',
					toolResultContent: JSON.stringify(arrayContent),
				}),
			)
		})
	})

	describe('nested subagents (forwardSubagentText)', () => {
		// Replays the message order recorded by the flag-on run in
		// test/learning/streaming/nested-subagent-forwarding.test.ts:
		// main → Agent toolu_A → Agent toolu_B → Write toolu_C.
		type Block = Record<string, unknown>
		let seq = 0
		const sdkMessage = (type: 'assistant' | 'user', content: Block[], parentToolUseId: string | null) => ({
			type,
			uuid: `nested-${type}-${++seq}`,
			parent_tool_use_id: parentToolUseId,
			session_id: 'sdk-session-123',
			message: { role: type, content },
		})
		const assistant = (content: Block[], parentToolUseId: string | null) =>
			sdkMessage('assistant', content, parentToolUseId)
		const user = (content: Block[], parentToolUseId: string | null) => sdkMessage('user', content, parentToolUseId)
		const text = (value: string): Block => ({ type: 'text', text: value })
		const thinking = (value: string): Block => ({ type: 'thinking', thinking: value, signature: 'sig' })
		const toolUse = (id: string, name: string, input: Record<string, unknown>): Block => ({
			type: 'tool_use',
			id,
			name,
			input,
		})
		const toolResult = (toolUseId: string, content: string): Block => ({
			type: 'tool_result',
			tool_use_id: toolUseId,
			content,
		})

		const createdRows = () =>
			(mockSessionsEventsCreate.mock.calls as unknown as Array<[Record<string, unknown>]>).map(([input]) => input)

		test('writes depth-2 subagent rows under the nested Agent call', async () => {
			const mockEvents = createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				assistant([toolUse('toolu_A', 'Agent', { prompt: 'spawn another' })], null),
				user([text('spawn another')], 'toolu_A'),
				assistant([thinking('plan')], 'toolu_A'),
				assistant([text('spawning')], 'toolu_A'),
				assistant([toolUse('toolu_B', 'Agent', { prompt: 'write marker' })], 'toolu_A'),
				user([text('write marker')], 'toolu_B'),
				assistant([thinking('write it')], 'toolu_B'),
				assistant([toolUse('toolu_C', 'Write', { file_path: '/tmp/m', content: 'x' })], 'toolu_B'),
				user([toolResult('toolu_C', 'ok')], 'toolu_B'),
				assistant([text('DEPTH2_DONE')], 'toolu_B'),
				user([toolResult('toolu_B', '[Subagent hand-back] DEPTH2_DONE')], 'toolu_A'),
				assistant([text('DEPTH1_DONE')], 'toolu_A'),
				user([toolResult('toolu_A', 'DEPTH1_DONE')], null),
				{ type: 'result', subtype: 'success' },
			])

			const session = createTestSession()
			await processEventsWithTestStreamProducer(mockEvents, session, mockOrpc as unknown as SessionORPCClient)

			const rows = createdRows()
			const summarize = (parentToolUseId: string | null) =>
				rows
					.filter((row) => row.parentToolUseId === parentToolUseId)
					.map((row) => ({
						eventType: row.eventType,
						role: row.role,
						content: row.content,
						toolCallId: row.toolCallId,
						toolResultForId: row.toolResultForId,
					}))

			// Depth 2: prompt, thinking, tool call, tool result, final text.
			expect(summarize('toolu_B')).toEqual([
				expect.objectContaining({ eventType: 'message', role: 'user', content: 'write marker' }),
				expect.objectContaining({ eventType: 'thinking', role: 'assistant', content: 'write it' }),
				expect.objectContaining({ eventType: 'tool_call', role: 'assistant', toolCallId: 'toolu_C' }),
				expect.objectContaining({ eventType: 'tool_result', role: 'user', toolResultForId: 'toolu_C' }),
				expect.objectContaining({ eventType: 'message', role: 'assistant', content: 'DEPTH2_DONE' }),
			])

			// Depth 1: prompt, thinking, text, nested Agent call and its result, final text.
			expect(summarize('toolu_A')).toEqual([
				expect.objectContaining({ eventType: 'message', role: 'user', content: 'spawn another' }),
				expect.objectContaining({ eventType: 'thinking', role: 'assistant', content: 'plan' }),
				expect.objectContaining({ eventType: 'message', role: 'assistant', content: 'spawning' }),
				expect.objectContaining({ eventType: 'tool_call', role: 'assistant', toolCallId: 'toolu_B' }),
				expect.objectContaining({ eventType: 'tool_result', role: 'user', toolResultForId: 'toolu_B' }),
				expect.objectContaining({ eventType: 'message', role: 'assistant', content: 'DEPTH1_DONE' }),
			])

			// The nested Agent call is a child of the depth-1 subagent.
			const nestedAgentCall = rows.find((row) => row.eventType === 'tool_call' && row.toolCallId === 'toolu_B')
			expect(nestedAgentCall?.toolName).toBe('Agent')
			expect(nestedAgentCall?.parentToolUseId).toBe('toolu_A')

			// Main loop: the root Agent call and its result only.
			expect(summarize(null)).toEqual([
				expect.objectContaining({ eventType: 'tool_call', toolCallId: 'toolu_A' }),
				expect.objectContaining({ eventType: 'tool_result', toolResultForId: 'toolu_A' }),
			])
		})
	})
})

describe('processClaudeEvents compaction', () => {
	afterEach(() => {
		mockSessionsUpdate.mockClear()
		mockSessionsEventsCreate.mockClear()
	})

	const compactingFlags = () =>
		mockSessionsUpdate.mock.calls.flatMap(([input]) => {
			const { isCompacting } = input as { isCompacting?: boolean }
			return isCompacting === undefined ? [] : [isCompacting]
		})

	test('mirrors the SDK compacting status onto the session', async () => {
		await processEventsWithTestStreamProducer(
			createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'system',
					subtype: 'status',
					status: 'compacting',
					uuid: 'status-1',
					session_id: 'sdk-session-123',
				},
				{
					type: 'system',
					subtype: 'status',
					status: null,
					compact_result: 'success',
					uuid: 'status-2',
					session_id: 'sdk-session-123',
				},
				{ type: 'result', subtype: 'success' },
			]),
			createTestSession(),
			mockOrpc as unknown as SessionORPCClient,
		)

		expect(compactingFlags()).toEqual([false, true, false])
	})

	test('stores the boundary and the summary the agent emits right after it', async () => {
		await processEventsWithTestStreamProducer(
			createMockEventIterator([
				{ type: 'system', subtype: 'init', session_id: 'sdk-session-123', model: 'haiku' },
				{
					type: 'system',
					subtype: 'compact_boundary',
					uuid: 'boundary-1',
					session_id: 'sdk-session-123',
					compact_metadata: { trigger: 'manual', pre_tokens: 1000, post_tokens: 100, duration_ms: 5 },
				},
				{
					type: 'user',
					message: { role: 'user', content: 'This session is being continued…' },
					parent_tool_use_id: null,
					uuid: 'summary-1',
					session_id: 'sdk-session-123',
					isSynthetic: true,
				},
				{ type: 'result', subtype: 'success' },
			]),
			createTestSession(),
			mockOrpc as unknown as SessionORPCClient,
		)

		const created = mockSessionsEventsCreate.mock.calls.map(([input]) => {
			const { eventId, eventType, content } = input as { eventId?: string; eventType?: string; content?: string }
			return { eventId, eventType, payload: JSON.parse(content ?? 'null') as Record<string, unknown> }
		})
		expect(created.map((event) => [event.eventId, event.eventType, event.payload.kind])).toEqual([
			['boundary-1', 'system', 'context_compaction'],
			['summary-1', 'system', 'context_compaction_summary'],
		])
		expect(created[1]?.payload).toMatchObject({
			boundaryEventId: 'boundary-1',
			summary: 'This session is being continued…',
		})
	})
})
