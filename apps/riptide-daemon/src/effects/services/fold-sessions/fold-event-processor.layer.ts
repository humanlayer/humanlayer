import { runtimeForAgent } from '@humanlayer/fold-core'
import type {
	AgentFinishedLogEntry,
	AgentStartedLogEntry,
	AssistantMessageLogEntry,
	CompactionLogEntry,
	LogEntry,
	SessionStartedLogEntry,
	ToolResultLogEntry,
	UserMessageLogEntry,
} from '@humanlayer/fold-core'
import * as Sentry from '@sentry/bun'
import { Cause, Clock, Effect, Layer, Predicate, Ref, Schema } from 'effect'
import { Prompt } from 'effect/ai'
import { uuidv7 } from 'uuidv7'

import { DaemonApi, type CreateConversationEventInput } from '../daemon-api/daemon-api.service'
import { StreamProducer } from '../stream-producer/stream-producer.service'
import { FoldEventProcessor } from './fold-event-processor.service'
import {
	FoldEventModelMissingError,
	FoldEventParentMissingError,
	FoldEventProcessingError,
} from './fold-sessions.errors'
import type { ProcessFoldEventInput } from './fold-sessions.schemas'
import { renderFoldToolResult } from './fold-tool-result'
import { decodeFoldUsage } from './fold-usage'

const retryWrites = { times: 2 } as const

const isSessionStartedEntry = (entry: LogEntry): entry is SessionStartedLogEntry =>
	Predicate.isTagged('session_started')(entry)
const isAgentStartedEntry = (entry: LogEntry): entry is AgentStartedLogEntry =>
	Predicate.isTagged('agent_started')(entry)
const isUserMessageEntry = (entry: LogEntry): entry is UserMessageLogEntry => Predicate.isTagged('user-message')(entry)
const isAssistantMessageEntry = (entry: LogEntry): entry is AssistantMessageLogEntry =>
	Predicate.isTagged('assistant-message')(entry)
const isToolResultEntry = (entry: LogEntry): entry is ToolResultLogEntry => Predicate.isTagged('tool-result')(entry)
const isAgentFinishedEntry = (entry: LogEntry): entry is AgentFinishedLogEntry =>
	Predicate.isTagged('agent-finished')(entry)
const isCompactionEntry = (entry: LogEntry): entry is CompactionLogEntry => Predicate.isTagged('compaction')(entry)

const estimateSummaryTokens = (summary: string): number => Math.ceil(summary.length / 4)

type PersistConversationEventInput = Omit<CreateConversationEventInput, 'eventId'> & {
	readonly eventId?: CreateConversationEventInput['eventId']
}

export const FoldEventProcessorLive = Layer.effect(
	FoldEventProcessor,
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const childParentToolUseIds = yield* Ref.make(new Map<string, string>())
		const childKey = (sessionId: string, agentId: string) => `${sessionId}:${agentId}`
		const persistAndPublish = Effect.fn('fold.persistConversationEvent')(function* (
			input: PersistConversationEventInput,
		) {
			const eventId = input.eventId ?? uuidv7()
			const now = yield* Clock.currentTimeMillis
			const create = api.createConversationEvent({ ...input, eventId }).pipe(Effect.retry(retryWrites))
			const publish = StreamProducer.pipe(
				Effect.flatMap((producer) =>
					producer.writeConversationEvent({
						conversation_event_id: eventId,
						session_id: input.sessionId,
						coding_agent_session_id: input.codingAgentSessionId,
						coding_agent_event_id: input.codingAgentEventId,
						event_type: input.eventType,
						role: input.role,
						content: input.content ?? null,
						tool_call_id: input.toolCallId ?? null,
						tool_name: input.toolName ?? null,
						tool_input_json: input.toolInputJson ?? null,
						parent_tool_use_id: input.parentToolUseId ?? null,
						tool_result_for_id: input.toolResultForId ?? null,
						tool_result_content: input.toolResultContent ?? null,
						input_tokens: input.inputTokens ?? null,
						output_tokens: input.outputTokens ?? null,
						created_at: now,
						updated_at: now,
					}),
				),
			)
			yield* create
			yield* publish
		})

		const processEvent = Effect.fn('fold.processEmittedEvent')(function* (input: ProcessFoldEventInput) {
			const producer = yield* StreamProducer
			const event = input.event
			if (event.kind === 'delta') {
				if (event.agentId !== input.rootAgentId) return
				if (event.part.type === 'text-delta') {
					const write = producer.writeTextDeltaForSource
					yield* write
						? write({ sourceBlockId: event.part.id, content: event.part.delta })
						: producer.writeTextDelta(event.part.delta)
				}
				if (event.part.type === 'reasoning-delta') {
					const write = producer.writeThinkingDeltaForSource
					yield* write
						? write({ sourceBlockId: event.part.id, content: event.part.delta })
						: producer.writeThinkingDelta(event.part.delta)
				}
				return
			}

			const entry = event.entry
			if (Predicate.isTagged(entry, 'session_title')) return
			if (isSessionStartedEntry(entry)) {
				yield* api
					.updateSession({
						sessionId: input.identity.sessionId,
						codingAgentSessionId: entry.sessionId,
					})
					.pipe(Effect.retry(retryWrites))
				return
			}
			if (isAgentStartedEntry(entry)) {
				if (entry.parentAgentId !== null && entry.toolCallId !== null) {
					const toolCallId = entry.toolCallId
					yield* Ref.update(childParentToolUseIds, (current) =>
						new Map(current).set(childKey(input.identity.sessionId, entry.agentId), toolCallId),
					)
				}
				return
			}

			// Session-level errors have no parent to route through. Preserve the Fold
			// diagnostic and let the runner own the failed-session transition.
			if (entry.agentId === null) {
				return yield* new FoldEventProcessingError({
					sessionId: input.identity.sessionId,
					cause: entry,
					message: `Fold session error (${entry.errorType}): ${entry.message}`,
				})
			}
			const agentId = entry.agentId
			const isRootAgent = agentId === input.rootAgentId
			if (
				!isRootAgent &&
				!isToolResultEntry(entry) &&
				entry.parentAgentId !== null &&
				entry.toolCallId !== null
			) {
				const toolCallId = entry.toolCallId
				yield* Ref.update(childParentToolUseIds, (current) =>
					new Map(current).set(childKey(input.identity.sessionId, agentId), toolCallId),
				)
			}
			const parentToolUseId = isRootAgent
				? undefined
				: (yield* Ref.get(childParentToolUseIds)).get(childKey(input.identity.sessionId, agentId))
			if (!isRootAgent && parentToolUseId === undefined) {
				return yield* new FoldEventParentMissingError({
					sessionId: input.identity.sessionId,
					agentId,
				})
			}

			if (isUserMessageEntry(entry)) {
				if (isRootAgent) return
				const message = yield* Schema.decodeUnknownEffect(Prompt.UserMessage)(entry.message)
				const content = message.content.every((part) => part.type === 'text')
					? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
					: JSON.stringify(message.content)
				yield* persistAndPublish({
					sessionId: input.identity.sessionId,
					codingAgentSessionId: entry.agentId,
					codingAgentEventId: entry.eventId,
					eventType: 'message',
					role: 'user',
					content,
					parentToolUseId,
				})
				return
			}
			if (isCompactionEntry(entry)) {
				if (isRootAgent) {
					yield* api
						.updateSession({
							sessionId: input.identity.sessionId,
							contextWindowTokens: estimateSummaryTokens(entry.summary),
						})
						.pipe(Effect.retry(retryWrites))
				}
				yield* persistAndPublish({
					sessionId: input.identity.sessionId,
					codingAgentSessionId: entry.agentId,
					codingAgentEventId: entry.eventId,
					eventType: 'message',
					role: 'assistant',
					content: entry.summary,
					parentToolUseId,
				})
				return
			}
			if (isAssistantMessageEntry(entry)) {
				const message = yield* Schema.decodeUnknownEffect(Prompt.AssistantMessage)(entry.message)
				const activeModel =
					entry.finish === null ? null : runtimeForAgent(input.history, entry.agentId).activeModel
				if (entry.finish !== null && activeModel === null) {
					return yield* new FoldEventModelMissingError({
						sessionId: input.identity.sessionId,
						agentId: entry.agentId,
						eventId: entry.eventId,
						seq: entry.seq,
					})
				}
				const usageModel =
					activeModel === null ? null : { provider: activeModel.providerId, model: activeModel.modelId }
				const usage =
					entry.finish === null || usageModel === null
						? undefined
						: yield* decodeFoldUsage(entry.finish.usage, usageModel)
				const supportedParts = message.content
					.map((part, blockSeq) => ({ part, blockSeq }))
					.filter(
						({ part }) => part.type === 'text' || part.type === 'reasoning' || part.type === 'tool-call',
					)
				const usageBlockSeq =
					supportedParts.find(({ part }) => part.type === 'text' || part.type === 'reasoning')?.blockSeq ??
					supportedParts[0]?.blockSeq
				for (const [blockSeq, part] of message.content.entries()) {
					if (part.type !== 'text' && part.type !== 'reasoning' && part.type !== 'tool-call') continue
					const attachUsageToBlock = usage !== undefined && blockSeq === usageBlockSeq
					if (isRootAgent && (part.type === 'text' || part.type === 'reasoning')) {
						yield* producer.writeContentBlockStop(blockSeq)
					}
					const eventId =
						part.type === 'tool-call' || !isRootAgent
							? undefined
							: ((yield* producer.getConversationEventIdForBlock(
									blockSeq,
									part.type === 'text' ? 'text' : 'thinking',
								)) ?? undefined)
					const eventInput: PersistConversationEventInput =
						part.type === 'tool-call'
							? {
									sessionId: input.identity.sessionId,
									codingAgentSessionId: entry.agentId,
									codingAgentEventId: entry.eventId,
									eventId,
									eventType: 'tool_call',
									role: 'assistant',
									toolCallId: part.id,
									toolName: part.name,
									toolInputJson: part.params,
									parentToolUseId,
								}
							: {
									sessionId: input.identity.sessionId,
									codingAgentSessionId: entry.agentId,
									codingAgentEventId: entry.eventId,
									eventId,
									eventType: part.type === 'text' ? 'message' : 'thinking',
									role: 'assistant',
									content: part.text,
									parentToolUseId,
								}
					if (attachUsageToBlock) {
						yield* persistAndPublish({
							...eventInput,
							inputTokens: usage.contextInputTokens,
							outputTokens: usage.outputTokens,
						})
					} else {
						yield* persistAndPublish(eventInput)
					}
				}
				if (usage !== undefined && usageBlockSeq !== undefined && usageModel !== null) {
					const sessionUsage = {
						modelUsage: { [usageModel.model]: usage.billingUsage },
						usageReportKey: entry.eventId,
					}
					const sessionUsageWithCost =
						usage.costUsd === undefined ? sessionUsage : { ...sessionUsage, totalCostUsd: usage.costUsd }
					if (isRootAgent) {
						yield* api
							.updateSession({
								sessionId: input.identity.sessionId,
								contextWindowTokens: usage.contextWindowTokens,
								contextWindowLimit: usage.contextWindowLimit,
								...sessionUsageWithCost,
							})
							.pipe(Effect.retry(retryWrites))
					} else {
						yield* api
							.updateSession({
								sessionId: input.identity.sessionId,
								...sessionUsageWithCost,
							})
							.pipe(Effect.retry(retryWrites))
					}

					const usageEntry =
						usage.costUsd === undefined
							? { model: usageModel.model, tokens: usage.billingUsage }
							: { model: usageModel.model, tokens: usage.billingUsage, costUsd: usage.costUsd }
					yield* api
						.recordUsage({
							sessionId: input.identity.sessionId,
							reportKey: entry.eventId,
							source: 'fold_run',
							occurredAt: entry.ts,
							entries: [usageEntry],
						})
						.pipe(
							Effect.catchTag('DaemonUsageRecordError', (error) =>
								Effect.logError('Failed to record Fold usage').pipe(
									Effect.annotateLogs({
										sessionId: input.identity.sessionId,
										eventId: entry.eventId,
										model: usageModel.model,
										error,
									}),
									Effect.andThen(
										Effect.sync(() =>
											Sentry.captureException(error, {
												tags: {
													error_type: 'fold_usage_record',
													session_id: input.identity.sessionId,
												},
												extra: { eventId: entry.eventId, model: usageModel.model },
											}),
										),
									),
								),
							),
						)
				}
				if (isRootAgent) yield* producer.writeMessageStop()
				return
			}
			if (isToolResultEntry(entry)) {
				for (const part of entry.message.content) {
					if (part.type !== 'tool-result') continue
					yield* persistAndPublish({
						sessionId: input.identity.sessionId,
						codingAgentSessionId: entry.agentId,
						codingAgentEventId: entry.eventId,
						eventType: 'tool_result',
						role: 'user',
						toolResultForId: part.id,
						toolResultContent: renderFoldToolResult(part.result),
						parentToolUseId,
					})
				}
				return
			}
			if (isAgentFinishedEntry(entry)) {
				if (!isRootAgent) {
					yield* Ref.update(childParentToolUseIds, (current) => {
						const next = new Map(current)
						next.delete(childKey(input.identity.sessionId, entry.agentId))
						return next
					})
					return
				}
				if (entry.outcome === 'interrupted' || entry.outcome === 'error') {
					yield* producer.closeMessageAndDiscardUnmaterializedBlocks?.() ?? Effect.void
				}
				const update =
					entry.outcome === 'completed' || entry.outcome === 'stopped'
						? api.updateSession({ sessionId: input.identity.sessionId, status: 'ready_for_input' })
						: entry.outcome === 'interrupted'
							? api.updateSession({ sessionId: input.identity.sessionId, status: 'interrupted' })
							: api.updateSession({
									sessionId: input.identity.sessionId,
									status: 'failed',
									errorMessage:
										entry.reason ?? entry.resultText ?? 'The Fold session ended with an error.',
								})
				yield* update.pipe(Effect.retry(retryWrites))
				if (entry.outcome === 'interrupted' || entry.outcome === 'error') {
					const content =
						entry.outcome === 'interrupted'
							? '<system-information>Session interrupted by user</system-information>'
							: `<system-information>Session failed due to error: ${entry.reason ?? entry.resultText ?? 'Unknown error'}</system-information>`
					yield* persistAndPublish({
						sessionId: input.identity.sessionId,
						codingAgentSessionId: entry.agentId,
						codingAgentEventId: entry.eventId,
						eventType: 'message',
						role: 'user',
						content,
					})
				}
			}
		})
		const processEmittedEvent: typeof FoldEventProcessor.Service.processEmittedEvent = (input) =>
			processEvent(input).pipe(
				Effect.tapError((error) => {
					const cause = Cause.fail(error)
					return Effect.logError('Failed to project a Fold event', cause).pipe(
						Effect.annotateLogs({ sessionId: input.identity.sessionId }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(Cause.squash(cause), {
									tags: { error_type: 'fold_event_processing', session_id: input.identity.sessionId },
									extra: { cause: Cause.pretty(cause) },
								}),
							),
						),
					)
				}),
				Effect.catchTags({ FoldEventProcessingError: (error) => Effect.fail(error) }, (cause) =>
					Effect.fail(
						new FoldEventProcessingError({
							sessionId: input.identity.sessionId,
							cause,
							message: 'Failed to project a Fold event.',
						}),
					),
				),
			)

		return { processEmittedEvent }
	}),
)
