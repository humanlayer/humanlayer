import { describe, it } from '@effect/vitest'
import { codexModel } from '@humanlayer/fold-codex'
import {
	AgentId,
	decodeStoredLogEntry,
	EventId,
	MessageId,
	ToolCallId,
	type FoldEvent,
	type LogEntry,
} from '@humanlayer/fold-core'
import { xaiModel } from '@humanlayer/fold-xai'
import { Effect, Layer, Logger, Ref } from 'effect'
import { expect } from 'vitest'

import { DaemonUsageRecordError } from '@/effects/services/daemon-api/daemon-api.errors'
import { decodePersistedFoldEntry } from '@/effects/services/fold-event-log/fold-event-log-session'
import { FoldEventProcessorLive } from '@/effects/services/fold-sessions/fold-event-processor.layer'
import { FoldEventProcessor } from '@/effects/services/fold-sessions/fold-event-processor.service'
import { FoldEventProcessingError } from '@/effects/services/fold-sessions/fold-sessions.errors'
import { StreamProducer, type StreamProducerService } from '@/effects/services/stream-producer/stream-producer.service'

import { initialFoldModel, modelChangedEntry, modelStartedEntry } from '../helpers/fold-model-history'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

const identity = {
	sessionId: 'session-1',
	organizationId: 'organization-1',
	hostId: 'host-1',
	taskId: null,
	workingDirectory: '/tmp/fold',
}

const makeRecordingProducer = (textDeltas: Ref.Ref<ReadonlyArray<string>>): StreamProducerService => ({
	writeMessageStart: () => Effect.void,
	writeMessageStop: () => Effect.void,
	startTextBlock: () => Effect.succeed({ conversationEventId: 'text-event' }),
	writeTextDelta: (content) => Ref.update(textDeltas, (current) => [...current, content]),
	writeTextBlockStop: () => Effect.void,
	startThinkingBlock: () => Effect.succeed({ conversationEventId: 'thinking-event' }),
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
			consumedConversationEventIds: [],
			messageSeq: 0,
		}),
})

describe('FoldEventProcessor', () => {
	for (const resume of [false, true]) {
		it.effect(
			`prices each agent at its event sequence ${resume ? 'from persisted resume history' : 'across live model transitions'}`,
			() =>
				Effect.gen(function* () {
					const rootAgentId = AgentId.create()
					const childAgentId = AgentId.create()
					const toolCallId = ToolCallId.create()
					const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
					const reports = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
					const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
					const rootStarted = modelStartedEntry(rootAgentId)
					const childStarted = {
						...modelStartedEntry(
							childAgentId,
							xaiModel({ model: 'grok-4.6', reasoning: 'low' }).activeModel,
							1,
							rootAgentId,
						),
						toolCallId,
					}
					const rootChanged = modelChangedEntry(
						rootAgentId,
						codexModel({ model: 'gpt-6-astra', reasoning: 'max' }).activeModel,
						3,
					)
					const assistant = (agentId: typeof rootAgentId, seq: number) =>
						decodeStoredLogEntry({
							_tag: 'assistant-message',
							seq,
							eventId: EventId.create(),
							ts: seq,
							version: 1,
							agentId,
							parentAgentId: agentId === rootAgentId ? null : rootAgentId,
							toolCallId: agentId === rootAgentId ? null : toolCallId,
							messageId: MessageId.create(),
							message: { role: 'assistant', content: 'Done', options: {} },
							finish: {
								reason: 'stop',
								usage: { inputTokens: { total: 1000, uncached: 1000 }, outputTokens: { total: 100 } },
							},
						})
					const firstRootResponse = yield* assistant(rootAgentId, 2)
					const history: LogEntry[] = resume
						? [rootStarted, childStarted, firstRootResponse, rootChanged]
						: []
					const api = makeMockDaemonApiLayer({
						createConversationEvent: (input) =>
							Effect.succeed({ eventId: input.eventId ?? 'saved', transactionId: 'saved' }),
						updateSession: (input) =>
							Ref.update(updates, (all) => [...all, input]).pipe(
								Effect.as({ success: true, transactionId: 'updated' }),
							),
						recordUsage: (input) =>
							Ref.update(reports, (all) => [...all, input]).pipe(Effect.as({ recorded: 1 })),
					})
					yield* Effect.gen(function* () {
						const processor = yield* FoldEventProcessor
						const emit = (entry: LogEntry) =>
							Effect.suspend(() => {
								history.push(entry)
								return processor.processEmittedEvent({
									identity,
									rootAgentId,
									history,
									event: { kind: 'log', entry },
								})
							})
						if (!resume) {
							yield* emit(rootStarted)
							yield* emit(childStarted)
							yield* emit(firstRootResponse)
							yield* emit(rootChanged)
						}
						yield* emit(yield* assistant(childAgentId, 4))
						yield* emit(yield* assistant(rootAgentId, 5))
					}).pipe(
						Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))),
						Effect.provide(Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))),
					)
					const expected = resume
						? [
								{ model: 'grok-4.6', costUsd: 0.0026 },
								{ model: 'gpt-6-astra', costUsd: 0.015 },
							]
						: [
								{ model: 'gpt-5.6-sol', costUsd: 0.008 },
								{ model: 'grok-4.6', costUsd: 0.0026 },
								{ model: 'gpt-6-astra', costUsd: 0.015 },
							]
					expect(yield* Ref.get(reports)).toMatchObject(expected.map((entry) => ({ entries: [entry] })))
					expect(yield* Ref.get(updates)).toMatchObject(
						expected.map(({ model, costUsd }) => ({
							modelUsage: { [model]: { input_tokens: 1000, output_tokens: 100 } },
							totalCostUsd: costUsd,
						})),
					)
				}),
		)
	}

	it.effect('captures a missing emitting-agent model and never bills it as the root model', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const childAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const logs: unknown[] = []
			const entry = yield* decodeStoredLogEntry({
				_tag: 'assistant-message',
				seq: 2,
				eventId: EventId.create(),
				ts: 2,
				version: 1,
				agentId: childAgentId,
				parentAgentId: rootAgentId,
				toolCallId: ToolCallId.create(),
				messageId: MessageId.create(),
				message: { role: 'assistant', content: 'Done', options: {} },
				finish: {
					reason: 'stop',
					usage: { inputTokens: { total: 1000, uncached: 1000 }, outputTokens: { total: 100 } },
				},
			})
			const error = yield* FoldEventProcessor.pipe(
				Effect.flatMap((processor) =>
					processor.processEmittedEvent({
						identity,
						rootAgentId,
						history: [modelStartedEntry(rootAgentId), entry],
						event: { kind: 'log', entry },
					}),
				),
				Effect.flip,
				// All API writes fail loudly: none may happen under a fabricated model label.
				Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(makeMockDaemonApiLayer()))),
				Effect.provide(Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))),
				Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])),
			)
			expect(error).toMatchObject({
				_tag: 'FoldEventProcessingError',
				cause: {
					_tag: 'FoldEventModelMissingError',
					agentId: childAgentId,
					eventId: entry.eventId,
					seq: 2,
				},
			})
			expect(logs).toHaveLength(1)
			expect(logs[0]).toEqual(expect.arrayContaining(['Failed to project a Fold event']))
		}),
	)

	it.effect('ignores session titles without API writes, stream updates, or root state changes', () =>
		Effect.gen(function* () {
			const entry = yield* decodeStoredLogEntry({
				_tag: 'session_title',
				seq: 3,
				eventId: EventId.create(),
				ts: 1,
				version: 1,
				agentId: null,
				parentAgentId: null,
				toolCallId: null,
				title: 'Inspect the event processor',
			})
			const processor = yield* FoldEventProcessor
			yield* processor.processEmittedEvent({
				identity,
				history: [entry],
				rootAgentId: AgentId.create(),
				event: { kind: 'log', entry },
			})
		}).pipe(
			// Every API or producer operation fails loudly, including root state updates.
			Effect.provide(
				Layer.mergeAll(
					FoldEventProcessorLive.pipe(Layer.provide(makeMockDaemonApiLayer())),
					Layer.mock(StreamProducer, {}),
				),
			),
		),
	)

	it.effect('propagates a null-agent error with its original diagnostic instead of a missing parent', () =>
		Effect.gen(function* () {
			const entry = yield* decodeStoredLogEntry({
				_tag: 'error',
				seq: 3,
				eventId: EventId.create(),
				ts: 1,
				version: 1,
				agentId: null,
				parentAgentId: null,
				toolCallId: null,
				errorType: 'model',
				message: 'Provider rejected the session credentials',
				details: { code: 'unauthorized' },
			})
			const processor = yield* FoldEventProcessor
			const error = yield* processor
				.processEmittedEvent({
					identity,
					history: [entry],
					rootAgentId: AgentId.create(),
					event: { kind: 'log', entry },
				})
				.pipe(Effect.flip)

			expect(error).toBeInstanceOf(FoldEventProcessingError)
			expect(error.sessionId).toBe(identity.sessionId)
			expect(error.message).toBe('Fold session error (model): Provider rejected the session credentials')
			expect(error.cause).toBe(entry)
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					FoldEventProcessorLive.pipe(Layer.provide(makeMockDaemonApiLayer())),
					Layer.mock(StreamProducer, {}),
				),
			),
		),
	)

	it.effect('projects a root compaction summary into the conversation and updates occupancy', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const persisted = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(persisted, (current) => [...current, input]).pipe(
						Effect.as({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-event' }),
					),
				updateSession: (input) =>
					Ref.update(updates, (current) => [...current, input]).pipe(
						Effect.as({ success: true, transactionId: 'transaction-compaction' }),
					),
			})
			const entry = yield* decodeStoredLogEntry({
				_tag: 'compaction',
				seq: 3,
				eventId: 'event_vppfqprx6n9b7uflng1w8i5d',
				ts: 1,
				version: 1,
				agentId: rootAgentId,
				parentAgentId: null,
				toolCallId: null,
				compactionId: 'compaction_vppfqprx6n9b7uflng1w8i5d',
				summary: '12345678',
				replacesThroughSeq: 2,
				tokensBefore: 10_000,
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: { kind: 'log', entry },
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			expect(yield* Ref.get(updates)).toEqual([{ sessionId: identity.sessionId, contextWindowTokens: 2 }])
			expect(yield* Ref.get(persisted)).toEqual([
				expect.objectContaining({
					sessionId: identity.sessionId,
					codingAgentSessionId: rootAgentId,
					codingAgentEventId: entry.eventId,
					eventType: 'message',
					role: 'assistant',
					content: '12345678',
				}),
			])
		}),
	)

	it.effect('decodes and projects an encoded string assistant message on resume', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const persisted = yield* Ref.make<ReadonlyArray<string>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(persisted, (current) => [...current, input.content ?? '']).pipe(
						Effect.as({ eventId: 'event-1', transactionId: 'transaction-1' }),
					),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'log',
						entry: {
							_tag: 'assistant-message',
							seq: 1,
							eventId: EventId.create(),
							ts: 1,
							version: 1,
							agentId: rootAgentId,
							parentAgentId: null,
							toolCallId: null,
							messageId: MessageId.create(),
							message: { role: 'assistant', content: 'Cow grazes at dawn', options: {} },
							finish: { reason: 'stop', usage: {} },
						},
					} as unknown as FoldEvent,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			expect(yield* Ref.get(persisted)).toEqual(['Cow grazes at dawn'])
		}),
	)

	it.effect('projects a partial assistant message without usage after interruption', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const persisted = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const reports = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(persisted, (current) => [...current, input]).pipe(
						Effect.as({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-1' }),
					),
				updateSession: (input) =>
					Ref.update(updates, (current) => [...current, input]).pipe(
						Effect.as({ success: true, transactionId: 'transaction-2' }),
					),
				recordUsage: (input) =>
					Ref.update(reports, (current) => [...current, input]).pipe(Effect.as({ recorded: 1 })),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'log',
						entry: {
							_tag: 'assistant-message',
							seq: 1,
							eventId: EventId.create(),
							ts: 1,
							version: 1,
							agentId: rootAgentId,
							parentAgentId: null,
							toolCallId: null,
							messageId: MessageId.create(),
							message: { role: 'assistant', content: 'Partial answer', options: {} },
							finish: null,
						},
					} as unknown as FoldEvent,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			const events = yield* Ref.get(persisted)
			expect(events).toEqual([expect.objectContaining({ content: 'Partial answer' })])
			expect(events[0]).not.toHaveProperty('inputTokens')
			expect(events[0]).not.toHaveProperty('outputTokens')
			expect(yield* Ref.get(updates)).toEqual([])
			expect(yield* Ref.get(reports)).toEqual([])
		}),
	)

	it.effect('streams root deltas and ignores child deltas', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const childAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const processorLayer = FoldEventProcessorLive.pipe(Layer.provide(makeMockDaemonApiLayer()))

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'delta',
						agentId: rootAgentId,
						parentAgentId: null,
						toolCallId: null,
						part: { type: 'text-delta', id: 'root-text', delta: 'root' },
					},
				})
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'delta',
						agentId: childAgentId,
						parentAgentId: rootAgentId,
						toolCallId: null,
						part: { type: 'text-delta', id: 'child-text', delta: 'child' },
					},
				})
			}).pipe(Effect.provide(processorLayer), Effect.provide(producer))

			expect(yield* Ref.get(textDeltas)).toEqual(['root'])
		}),
	)

	it.effect('projects durable child rows without streaming child content deltas', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const childAgentId = AgentId.create()
			const parentToolUseId = ToolCallId.create()
			const childToolCallId = ToolCallId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const streamLifecycle = yield* Ref.make<ReadonlyArray<string>>([])
			const createdInputs = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const reports = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const producerService = makeRecordingProducer(textDeltas)
			const producer = Layer.succeed(StreamProducer, {
				...producerService,
				writeMessageStop: () => Ref.update(streamLifecycle, (current) => [...current, 'message-stop']),
				writeContentBlockStop: () =>
					Ref.update(streamLifecycle, (current) => [...current, 'content-block-stop']),
				writeConversationEvent: () => Ref.update(streamLifecycle, (current) => [...current, 'saved-event']),
			})
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(createdInputs, (current) => [...current, input]).pipe(
						Effect.as({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-1' }),
					),
				updateSession: (input) =>
					Ref.update(updates, (current) => [...current, input]).pipe(
						Effect.as({ success: true, transactionId: 'transaction-2' }),
					),
				recordUsage: (input) =>
					Ref.update(reports, (current) => [...current, input]).pipe(Effect.as({ recorded: 1 })),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				const history: LogEntry[] = []
				const emit = (entry: unknown) =>
					Effect.gen(function* () {
						const decoded = yield* decodePersistedFoldEntry(entry)
						history.push(decoded)
						yield* processor.processEmittedEvent({
							identity,
							history,
							rootAgentId,
							event: { kind: 'log', entry: decoded },
						})
					})

				yield* emit({
					_tag: 'agent_started',
					seq: 1,
					eventId: EventId.create(),
					ts: 1,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: parentToolUseId,
					mode: 'fresh',
					model: initialFoldModel,
					tools: ['bash'],
					skill: null,
					fork: null,
					agentType: 'bash',
				})
				yield* emit({
					_tag: 'user-message',
					seq: 2,
					eventId: EventId.create(),
					ts: 2,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: parentToolUseId,
					messageId: MessageId.create(),
					message: { role: 'user', content: 'Run pwd', options: {} },
				})
				yield* emit({
					_tag: 'assistant-message',
					seq: 3,
					eventId: EventId.create(),
					ts: 3,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: parentToolUseId,
					messageId: MessageId.create(),
					message: {
						role: 'assistant',
						content: [
							{ type: 'reasoning', text: 'Inspect cwd' },
							{ type: 'text', text: 'Running pwd' },
							{ type: 'tool-call', id: childToolCallId, name: 'bash', params: { command: 'pwd' } },
						],
						options: {},
					},
					finish: {
						reason: 'tool-calls',
						usage: {
							inputTokens: { total: 100, uncached: 100, cacheRead: 0, cacheWrite: 0 },
							outputTokens: { total: 10 },
						},
					},
				})
				yield* emit({
					_tag: 'tool-result',
					seq: 4,
					eventId: EventId.create(),
					ts: 4,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: childToolCallId,
					messageId: MessageId.create(),
					message: {
						role: 'tool',
						content: [
							{
								type: 'tool-result',
								id: childToolCallId,
								name: 'bash',
								result: { _tag: 'text', text: '\u001b[31m/tmp/fold\u001b[0m\n' },
								isFailure: false,
								options: {},
							},
						],
						options: {},
					},
				})
				yield* emit({
					_tag: 'agent-finished',
					seq: 5,
					eventId: EventId.create(),
					ts: 5,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: parentToolUseId,
					outcome: 'completed',
					resultText: 'Done',
					reason: null,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			const events = yield* Ref.get(createdInputs)
			expect(events).toHaveLength(5)
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						eventType: 'message',
						role: 'user',
						content: 'Run pwd',
						parentToolUseId,
					}),
					expect.objectContaining({
						eventType: 'tool_call',
						toolCallId: childToolCallId,
						parentToolUseId,
					}),
					expect.objectContaining({
						eventType: 'tool_result',
						toolResultForId: childToolCallId,
						toolResultContent: '\u001b[31m/tmp/fold\u001b[0m\n',
						parentToolUseId,
					}),
				]),
			)
			expect(events.every((event) => event.parentToolUseId === parentToolUseId)).toBe(true)
			expect(yield* Ref.get(streamLifecycle)).toEqual([
				'saved-event',
				'saved-event',
				'saved-event',
				'saved-event',
				'saved-event',
			])
			expect(yield* Ref.get(updates)).toEqual([
				expect.objectContaining({ usageReportKey: expect.any(String), modelUsage: expect.any(Object) }),
			])
			expect((yield* Ref.get(updates))[0]).not.toHaveProperty('contextWindowTokens')
			expect((yield* Ref.get(updates))[0]).not.toHaveProperty('contextWindowLimit')
			expect(yield* Ref.get(reports)).toHaveLength(1)
		}),
	)

	it.effect('threads nested child rows under the child agent tool call', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const childAgentId = AgentId.create()
			const grandchildAgentId = AgentId.create()
			const childParentToolUseId = ToolCallId.create()
			const grandchildParentToolUseId = ToolCallId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const createdInputs = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(createdInputs, (current) => [...current, input]).pipe(
						Effect.as({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-1' }),
					),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				const history: LogEntry[] = []
				const emit = (entry: unknown) =>
					Effect.gen(function* () {
						const decoded = yield* decodePersistedFoldEntry(entry)
						history.push(decoded)
						yield* processor.processEmittedEvent({
							identity,
							history,
							rootAgentId,
							event: { kind: 'log', entry: decoded },
						})
					})
				const started = (
					agentId: typeof childAgentId,
					parentAgentId: typeof rootAgentId,
					toolCallId: string,
				) => ({
					_tag: 'agent_started',
					seq: 1,
					eventId: EventId.create(),
					ts: 1,
					version: 1,
					agentId,
					parentAgentId,
					toolCallId,
					mode: 'fresh',
					model: initialFoldModel,
					tools: ['bash'],
					skill: null,
					fork: null,
					agentType: null,
				})

				yield* emit(started(childAgentId, rootAgentId, childParentToolUseId))
				yield* emit({
					_tag: 'assistant-message',
					seq: 2,
					eventId: EventId.create(),
					ts: 2,
					version: 1,
					agentId: childAgentId,
					parentAgentId: rootAgentId,
					toolCallId: childParentToolUseId,
					messageId: MessageId.create(),
					message: {
						role: 'assistant',
						content: [
							{
								type: 'tool-call',
								id: grandchildParentToolUseId,
								name: 'agent',
								params: { prompt: 'Inspect' },
							},
						],
						options: {},
					},
					finish: null,
				})
				yield* emit(started(grandchildAgentId, childAgentId, grandchildParentToolUseId))
				yield* emit({
					_tag: 'assistant-message',
					seq: 4,
					eventId: EventId.create(),
					ts: 4,
					version: 1,
					agentId: grandchildAgentId,
					parentAgentId: childAgentId,
					toolCallId: grandchildParentToolUseId,
					messageId: MessageId.create(),
					message: { role: 'assistant', content: 'Nested result', options: {} },
					finish: null,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			expect(yield* Ref.get(createdInputs)).toEqual([
				expect.objectContaining({
					eventType: 'tool_call',
					toolCallId: grandchildParentToolUseId,
					parentToolUseId: childParentToolUseId,
				}),
				expect.objectContaining({
					eventType: 'message',
					content: 'Nested result',
					parentToolUseId: grandchildParentToolUseId,
				}),
			])
		}),
	)

	it.effect('projects normalized Codex usage once and records matching idempotency keys', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const foldEventId = EventId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const createdInputs = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const reports = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Ref.update(createdInputs, (current) => [...current, input]).pipe(
						Effect.as({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-1' }),
					),
				updateSession: (input) =>
					Ref.update(updates, (current) => [...current, input]).pipe(
						Effect.as({ success: true, transactionId: 'transaction-2' }),
					),
				recordUsage: (input) =>
					Ref.update(reports, (current) => [...current, input]).pipe(Effect.as({ recorded: 1 })),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'log',
						entry: {
							_tag: 'assistant-message',
							seq: 2,
							eventId: foldEventId,
							ts: 1234,
							version: 1,
							agentId: rootAgentId,
							parentAgentId: null,
							toolCallId: null,
							messageId: MessageId.create(),
							message: {
								role: 'assistant',
								content: [
									{ type: 'reasoning', text: 'Think' },
									{ type: 'text', text: 'Answer' },
								],
								options: {},
							},
							finish: {
								reason: 'stop',
								usage: {
									inputTokens: { total: 1500, uncached: 500, cacheRead: 1000, cacheWrite: 0 },
									outputTokens: { total: 100 },
								},
							},
						},
					} as unknown as FoldEvent,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			const events = yield* Ref.get(createdInputs)
			expect(events).toHaveLength(2)
			expect(events.filter((event) => event.inputTokens !== undefined)).toEqual([
				expect.objectContaining({ eventType: 'thinking', inputTokens: 1500, outputTokens: 100 }),
			])
			expect(yield* Ref.get(updates)).toEqual([
				expect.objectContaining({
					contextWindowTokens: 1600,
					contextWindowLimit: 258_400,
					usageReportKey: foldEventId,
					modelUsage: {
						'gpt-5.6-sol': {
							input_tokens: 500,
							output_tokens: 100,
							cache_read_input_tokens: 1000,
							cache_creation_input_tokens: 0,
						},
					},
					totalCostUsd: 0.006,
				}),
			])
			expect(yield* Ref.get(reports)).toEqual([
				expect.objectContaining({
					reportKey: foldEventId,
					source: 'fold_run',
					occurredAt: 1234,
				}),
			])
		}),
	)

	it.effect('does not fail a completed response when Fold usage telemetry fails', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const producer = Layer.succeed(StreamProducer, makeRecordingProducer(textDeltas))
			const api = makeMockDaemonApiLayer({
				createConversationEvent: (input) =>
					Effect.succeed({ eventId: input.eventId ?? 'event-1', transactionId: 'transaction-1' }),
				updateSession: () => Effect.succeed({ success: true, transactionId: 'transaction-2' }),
				recordUsage: () => Effect.fail(new DaemonUsageRecordError({ cause: new Error('offline') })),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'log',
						entry: {
							_tag: 'assistant-message',
							seq: 1,
							eventId: EventId.create(),
							ts: 1,
							version: 1,
							agentId: rootAgentId,
							parentAgentId: null,
							toolCallId: null,
							messageId: MessageId.create(),
							message: { role: 'assistant', content: 'Done', options: {} },
							finish: {
								reason: 'stop',
								usage: { inputTokens: { total: 10, uncached: 10 }, outputTokens: { total: 2 } },
							},
						},
					} as unknown as FoldEvent,
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))
		}),
	)

	it.effect('persists an interrupted terminal row before publishing its saved marker', () =>
		Effect.gen(function* () {
			const rootAgentId = AgentId.create()
			const textDeltas = yield* Ref.make<ReadonlyArray<string>>([])
			const operations = yield* Ref.make<ReadonlyArray<string>>([])
			const producerService = makeRecordingProducer(textDeltas)
			const producer = Layer.succeed(StreamProducer, {
				...producerService,
				closeMessageAndDiscardUnmaterializedBlocks: () =>
					Ref.update(operations, (current) => [...current, 'discard']),
				writeConversationEvent: () => Ref.update(operations, (current) => [...current, 'publish']),
			})
			const api = makeMockDaemonApiLayer({
				updateSession: () => Effect.succeed({ success: true, transactionId: 'update-transaction' }),
				createConversationEvent: (input) =>
					Ref.update(operations, (current) => [...current, 'persist']).pipe(
						Effect.as({ eventId: input.eventId ?? 'generated-event', transactionId: 'event-transaction' }),
					),
			})

			yield* Effect.gen(function* () {
				const processor = yield* FoldEventProcessor
				yield* processor.processEmittedEvent({
					identity,
					history: [modelStartedEntry(rootAgentId)],
					rootAgentId,
					event: {
						kind: 'log',
						entry: {
							_tag: 'agent-finished',
							seq: 1,
							eventId: EventId.create(),
							ts: 1,
							version: 1,
							agentId: rootAgentId,
							parentAgentId: null,
							toolCallId: null,
							outcome: 'interrupted',
							resultText: null,
							reason: null,
						},
					},
				})
			}).pipe(Effect.provide(FoldEventProcessorLive.pipe(Layer.provide(api))), Effect.provide(producer))

			expect(yield* Ref.get(operations)).toEqual(['discard', 'persist', 'publish'])
		}),
	)
})
