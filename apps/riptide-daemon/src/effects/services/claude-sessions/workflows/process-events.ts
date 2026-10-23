import type {
	SDKAssistantMessage,
	SDKPartialAssistantMessage,
	SDKRateLimitInfo,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { Session } from '@humanlayer/db/tables/sessions'
import { usageWindowLabel } from '@humanlayer/schemas/zod/host/usage-limits'
import { Clock, Crypto, Data, Deferred, Duration, Effect, Fiber, Option, Queue, Ref, Schema, Stream } from 'effect'

import { handleClaudeStreamEvent } from '@/agents/claudecode/stream-event-handler'
import { getMessageIdFromMessage, getTokenUsageFromMessage } from '@/agents/claudecode/token-usage'
import type { InterruptStateService } from '@/agents/shared/interrupt-state.service'
import type { CreateEventInput } from '@/agents/shared/streaming-events'
import { StreamProducer, type StreamProducerService } from '@/effects/services/stream-producer/stream-producer.service'
import { discoverAgentCommands } from '@/lib/agent-commands/discover'
import { captureAgentCommandsReportFailureAndContinue, toAgentCommands } from '@/lib/agent-commands/report'
import { recordAttributedAgentActivity } from '@/lib/git/commit-attribution'
import {
	HostUsageLimits,
	rateLimitRejectionParksTurnUntilReset,
	rateLimitResetToMs,
} from '@/lib/usage-limits/host-usage-limits'

import type { DaemonConversationEventCreateError, DaemonSessionUpdateError } from '../../daemon-api/daemon-api.errors'
import { DaemonApi } from '../../daemon-api/daemon-api.service'
import {
	ClaudeContentBlockSchema,
	ClaudeContentBlockTypeSchema,
	ClaudeModelFallbackSchema,
	ClaudeResultUsageSchema,
	type ClaudeContentBlock,
	type ClaudeResultUsage,
	getClaudeStreamBlockType,
	isKnownClaudeContentBlockType,
	subtractClaudeResultUsage,
	transformClaudeContentBlock,
	transformClaudeResultUsage,
} from '../event-transformations'
import type { ClaudeSdkError } from '../sdk/claude-sdk-error'
import type { ClaudeSdkSession } from '../sdk/claude-sdk-session.service'
import {
	type CompactionSummaryMessage,
	type PairedSDKMessage,
	pairCompactBoundariesWithSummaries,
} from './pair-compact-boundaries-with-summaries'

export class ClaudeSessionDataError extends Data.TaggedError('ClaudeSessionDataError')<{
	readonly sessionId: string
	readonly cause: unknown
}> {}

export type ProcessClaudeEventsError =
	| ClaudeSdkError
	| ClaudeSessionDataError
	| DaemonSessionUpdateError
	| DaemonConversationEventCreateError

export interface ProcessClaudeEventsInput {
	readonly session: Session
	readonly sdkSession: ClaudeSdkSession
	readonly interruptState: InterruptStateService
	readonly closeInputOnResult?: boolean
	readonly onResult?: Effect.Effect<void>
}

type UnconsumedEmittedBlock = Array<{
	readonly conversationEventId: string
	readonly blockSeq: number
	readonly messageSeq: number
	readonly blockType: 'text' | 'thinking'
	readonly content: string
}>

type DurablePublicationCommand =
	| {
			readonly _tag: 'PublishPartialEvent'
			readonly event: SDKPartialAssistantMessage['event']
	  }
	| {
			readonly _tag: 'LookupCanonicalEventId'
			readonly blockIndex: number
			readonly blockType: 'text' | 'thinking'
			readonly reply: Deferred.Deferred<string | undefined>
	  }
	| {
			readonly _tag: 'GetUnconsumedEmittedBlocks'
			readonly reply: Deferred.Deferred<UnconsumedEmittedBlock>
	  }
	| {
			readonly _tag: 'WriteCanonicalEvent'
			readonly eventInput: CreateEventInput
			readonly eventId: string
	  }
	| {
			readonly _tag: 'Close'
			readonly reply: Deferred.Deferred<void>
	  }
const DurablePublicationCommand = Data.taggedEnum<DurablePublicationCommand>()

interface DurablePublicationWorker {
	readonly publishPartialEvent: (event: SDKPartialAssistantMessage['event']) => Effect.Effect<void>
	readonly lookupCanonicalEventId: (
		blockIndex: number,
		blockType: 'text' | 'thinking',
	) => Effect.Effect<string | undefined>
	readonly getUnconsumedEmittedBlocks: Effect.Effect<UnconsumedEmittedBlock>
	readonly writeCanonicalEvent: (eventInput: CreateEventInput, eventId: string) => Effect.Effect<void>
	readonly close: Effect.Effect<void>
}

const lookupCanonicalEventIdFromProducer = (
	sessionId: string,
	producer: StreamProducerService,
	blockIndex: number,
	blockType: 'text' | 'thinking',
): Effect.Effect<string | undefined> =>
	Effect.gen(function* () {
		const exact = yield* producer.getConversationEventIdForBlock(blockIndex, blockType)
		if (exact) return exact
		const shifted = yield* producer.consumeNextConversationEventIdByType(blockType)
		if (shifted) return shifted

		yield* Effect.logWarning('Unable to reconcile completed Claude block with streamed block').pipe(
			Effect.annotateLogs({ sessionId, blockIndex, blockType }),
		)
		return undefined
	})

const writeCanonicalEventToProducer = (
	producer: StreamProducerService,
	eventInput: CreateEventInput,
	eventId: string,
) =>
	Clock.currentTimeMillis.pipe(
		Effect.flatMap((now) =>
			producer.writeConversationEvent({
				conversation_event_id: eventId,
				session_id: eventInput.sessionId,
				coding_agent_session_id: eventInput.codingAgentSessionId,
				coding_agent_event_id: eventInput.codingAgentEventId ?? null,
				event_type: eventInput.eventType,
				role: eventInput.role,
				content: eventInput.content ?? null,
				tool_call_id: eventInput.toolCallId ?? null,
				tool_name: eventInput.toolName ?? null,
				tool_input_json: eventInput.toolInputJson ?? null,
				parent_tool_use_id: eventInput.parentToolUseId ?? null,
				tool_result_for_id: eventInput.toolResultForId ?? null,
				tool_result_content: eventInput.toolResultContent ?? null,
				input_tokens: eventInput.inputTokens ?? null,
				output_tokens: eventInput.outputTokens ?? null,
				created_at: now,
				updated_at: now,
			}),
		),
	)

const completeUnavailableReply = (command: DurablePublicationCommand): Effect.Effect<void> =>
	DurablePublicationCommand.$match(command, {
		LookupCanonicalEventId: ({ reply }) => Deferred.succeed(reply, undefined).pipe(Effect.asVoid),
		GetUnconsumedEmittedBlocks: ({ reply }) => Deferred.succeed(reply, []).pipe(Effect.asVoid),
		Close: ({ reply }) => Deferred.succeed(reply, undefined).pipe(Effect.asVoid),
		PublishPartialEvent: () => Effect.void,
		WriteCanonicalEvent: () => Effect.void,
	})

const makeDurablePublicationWorker = (
	sessionId: string,
	producer: StreamProducerService,
): Effect.Effect<DurablePublicationWorker, never, import('effect').Scope.Scope> =>
	Effect.gen(function* () {
		const commands = yield* Queue.bounded<DurablePublicationCommand>(32)
		const currentCommand = yield* Ref.make<DurablePublicationCommand | undefined>(undefined)

		const processCommand = (command: DurablePublicationCommand): Effect.Effect<boolean> =>
			DurablePublicationCommand.$match(command, {
				PublishPartialEvent: ({ event }) => handleClaudeStreamEvent(event, producer).pipe(Effect.as(true)),
				LookupCanonicalEventId: ({ blockIndex, blockType, reply }) =>
					lookupCanonicalEventIdFromProducer(sessionId, producer, blockIndex, blockType).pipe(
						Effect.flatMap((eventId) => Deferred.succeed(reply, eventId)),
						Effect.as(true),
					),
				GetUnconsumedEmittedBlocks: ({ reply }) =>
					producer.getUnconsumedEmittedBlocks().pipe(
						Effect.flatMap((blocks) => Deferred.succeed(reply, blocks)),
						Effect.as(true),
					),
				WriteCanonicalEvent: ({ eventInput, eventId }) =>
					writeCanonicalEventToProducer(producer, eventInput, eventId).pipe(Effect.as(true)),
				Close: ({ reply }) =>
					producer
						.deleteUnmaterializedBlocks()
						.pipe(
							Effect.andThen(producer.flush()),
							Effect.andThen(Deferred.succeed(reply, undefined)),
							Effect.as(false),
						),
			})

		const worker = Effect.gen(function* () {
			let continueProcessing = true
			while (continueProcessing) {
				const command = yield* Queue.take(commands)
				yield* Ref.set(currentCommand, command)
				continueProcessing = yield* processCommand(command)
				yield* Ref.set(currentCommand, undefined)
			}
		})
		const completePendingPublicationRequests = Effect.gen(function* () {
			const inFlightCommand = yield* Ref.get(currentCommand)
			const queuedCommandCount = yield* Queue.size(commands)
			yield* Effect.logInfo('Claude publication worker interruption cleanup started').pipe(
				Effect.annotateLogs({
					sessionId,
					inFlightCommand: inFlightCommand?._tag ?? 'none',
					queuedCommandCount,
				}),
			)
			const pendingCommands = yield* Queue.takeBetween(commands, 0, Number.POSITIVE_INFINITY)
			if (inFlightCommand) yield* completeUnavailableReply(inFlightCommand)
			yield* Effect.forEach(pendingCommands, completeUnavailableReply)
			yield* Queue.shutdown(commands)
			yield* Effect.logInfo('Claude publication worker interruption cleanup completed').pipe(
				Effect.annotateLogs({ sessionId, drainedCommandCount: pendingCommands.length }),
			)
		}).pipe(Effect.uninterruptible)
		const fiber = yield* worker.pipe(
			Effect.onInterrupt(() => completePendingPublicationRequests),
			Effect.forkScoped,
		)

		const offer = (command: DurablePublicationCommand) =>
			Queue.offer(commands, command).pipe(
				Effect.flatMap((accepted) => (accepted ? Effect.void : completeUnavailableReply(command))),
			)
		const request = <A>(
			makeCommand: (reply: Deferred.Deferred<A>) => DurablePublicationCommand,
		): Effect.Effect<A> =>
			Deferred.make<A>().pipe(
				Effect.tap((reply) => offer(makeCommand(reply))),
				Effect.flatMap(Deferred.await),
			)

		return {
			publishPartialEvent: (event) => offer(DurablePublicationCommand.PublishPartialEvent({ event })),
			lookupCanonicalEventId: (blockIndex, blockType) =>
				request((reply) => DurablePublicationCommand.LookupCanonicalEventId({ blockIndex, blockType, reply })),
			getUnconsumedEmittedBlocks: request((reply) =>
				DurablePublicationCommand.GetUnconsumedEmittedBlocks({ reply }),
			),
			writeCanonicalEvent: (eventInput, eventId) =>
				offer(DurablePublicationCommand.WriteCanonicalEvent({ eventInput, eventId })),
			close: request<void>((reply) => DurablePublicationCommand.Close({ reply })).pipe(
				Effect.andThen(Fiber.join(fiber)),
				Effect.asVoid,
			),
		}
	})

const decodeClaudeContentBlock = (input: {
	readonly sessionId: string
	readonly blockIndex: number
	readonly rawBlock: unknown
}) =>
	Effect.gen(function* () {
		const { type } = yield* Schema.decodeUnknownEffect(ClaudeContentBlockTypeSchema)(input.rawBlock).pipe(
			Effect.mapError((cause) => new ClaudeSessionDataError({ sessionId: input.sessionId, cause })),
		)

		if (!isKnownClaudeContentBlockType(type)) {
			yield* Effect.logWarning('Skipping unsupported Claude content block').pipe(
				Effect.annotateLogs({ sessionId: input.sessionId, blockIndex: input.blockIndex, blockType: type }),
			)
			return null
		}

		return yield* Schema.decodeUnknownEffect(ClaudeContentBlockSchema)(input.rawBlock).pipe(
			Effect.mapError((cause) => new ClaudeSessionDataError({ sessionId: input.sessionId, cause })),
		)
	})

const decodeClaudeContentBlocks = (input: { readonly sessionId: string; readonly rawBlocks: ReadonlyArray<unknown> }) =>
	Effect.forEach(input.rawBlocks, (rawBlock, blockIndex) =>
		decodeClaudeContentBlock({ sessionId: input.sessionId, blockIndex, rawBlock }),
	)

const persistCompactionSummary = (input: {
	readonly sessionId: string
	readonly codingAgentSessionId: string
	readonly boundaryEventId: string
	readonly summary: CompactionSummaryMessage
}) =>
	Effect.gen(function* () {
		const api = yield* DaemonApi
		yield* api.createConversationEvent({
			eventId: input.summary.uuid,
			sessionId: input.sessionId,
			codingAgentSessionId: input.codingAgentSessionId,
			codingAgentEventId: input.summary.uuid,
			eventType: 'system',
			role: 'system',
			content: JSON.stringify({
				kind: 'context_compaction_summary',
				boundaryEventId: input.boundaryEventId,
				summary: input.summary.text,
			}),
		})
	})

const persistClaudeMessage = (input: {
	readonly session: Session
	readonly codingAgentSessionId: string
	readonly message: SDKAssistantMessage | SDKUserMessage
	readonly seenUsageMessageIds: Set<string>
	readonly publicationWorker: DurablePublicationWorker
}) =>
	Effect.gen(function* () {
		const api = yield* DaemonApi

		const sessionId = input.session.id
		const role = input.message.message.role
		if (role !== 'assistant' && role !== 'user') {
			yield* Effect.logWarning('Skipping unsupported Claude message role').pipe(
				Effect.annotateLogs({ sessionId, role }),
			)
			return
		}

		const rawContent = input.message.message.content
		const content: string | Array<ClaudeContentBlock | null> =
			typeof rawContent === 'string'
				? rawContent
				: yield* decodeClaudeContentBlocks({ sessionId, rawBlocks: rawContent })
		const blocks = typeof content === 'string' ? [content] : content
		const messageId = getMessageIdFromMessage(input.message)
		const alreadyCounted = messageId !== undefined && input.seenUsageMessageIds.has(messageId)
		const usage = alreadyCounted ? null : getTokenUsageFromMessage(input.message)
		let usageAttached = false

		const streamedFinalKeys = new Set<string>()
		for (const [index, block] of blocks.entries()) {
			if (block === null) continue
			const type = getClaudeStreamBlockType(block)
			if (type === 'text' || type === 'thinking') streamedFinalKeys.add(`${index}:${type}`)
		}
		const recoveredThinking = new Map<number, { readonly id: string; readonly content: string }>()
		if (role === 'assistant') {
			const unconsumed = yield* input.publicationWorker.getUnconsumedEmittedBlocks
			for (const block of unconsumed) {
				if (block.blockType !== 'thinking' || block.content.length === 0) continue
				if (streamedFinalKeys.has(`${block.blockSeq}:thinking`)) continue
				recoveredThinking.set(block.blockSeq, { id: block.conversationEventId, content: block.content })
			}
		}

		const persist = (eventInput: CreateEventInput) =>
			api.createConversationEvent(eventInput).pipe(
				Effect.tap((result) => input.publicationWorker.writeCanonicalEvent(eventInput, result.eventId)),
				Effect.asVoid,
			)

		const maxIndex = Math.max(blocks.length - 1, ...recoveredThinking.keys())
		for (let index = 0; index <= maxIndex; index++) {
			const recovered = recoveredThinking.get(index)
			if (recovered) {
				const reconciledId = yield* input.publicationWorker.lookupCanonicalEventId(index, 'thinking')
				yield* persist({
					eventId: reconciledId ?? recovered.id,
					sessionId,
					codingAgentSessionId: input.codingAgentSessionId,
					codingAgentEventId: input.message.uuid,
					eventType: 'thinking',
					role,
					content: recovered.content,
					parentToolUseId: input.message.parent_tool_use_id ?? null,
					inputTokens: usageAttached ? undefined : usage?.inputTokens,
					outputTokens: usageAttached ? undefined : usage?.outputTokens,
				})
				usageAttached = true
			}

			const block = blocks[index]
			if (block === undefined || block === null) continue
			const streamType = getClaudeStreamBlockType(block)
			const eventId =
				role === 'assistant' && (streamType === 'text' || streamType === 'thinking')
					? yield* input.publicationWorker.lookupCanonicalEventId(index, streamType)
					: undefined

			if (typeof block !== 'string' && block.type === 'tool_use') {
				// Journals authorship (the ONE on-disk store every producer shares, so inferred-tier
				// evidence survives a daemon restart) in one call —
				// gate, cwd normalization, and fire-and-forget all owned by the policy adapter.
				recordAttributedAgentActivity({
					workingDirectory: input.session.working_directory,
					sessionId,
					toolName: block.name,
					toolInput: block.input,
				})
			}
			const eventInput = transformClaudeContentBlock({
				sessionId,
				codingAgentSessionId: input.codingAgentSessionId,
				codingAgentEventId: input.message.uuid,
				role,
				content: block,
				parentToolUseId: input.message.parent_tool_use_id,
				inputTokens: usageAttached ? undefined : usage?.inputTokens,
				outputTokens: usageAttached ? undefined : usage?.outputTokens,
				eventId,
			})
			if (!eventInput) continue
			yield* persist(eventInput)
			usageAttached = true
		}

		if (usage && usageAttached && messageId !== undefined) {
			input.seenUsageMessageIds.add(messageId)
		}
	}).pipe(Effect.withSpan('claude.persist_message', { attributes: { session_id: input.session.id } }))

const usageSnapshotTimeout = Duration.seconds(15)

// On a rejection the CLI either ends the turn with a result right away or waits and retries the
// request itself once the window resets. The grace lets that retry's first events arrive and cancel
// the release, so the release only acts when the SDK stayed silent past the reset.
const USAGE_LIMIT_RELEASE_GRACE_MS = 60_000
// With no reset time, wait out the shortest plan window: a five-hour rejection has reset by then,
// and a later rejection parks the session again.
const USAGE_LIMIT_RELEASE_FALLBACK_MS = 5 * 60 * 60 * 1000

// While the CLI waits out a rejected window it reports each wait as an api_retry, so that message
// means the SDK is still waiting, not that the session moved on.
const keepsUsageLimitReleaseScheduled = (event: PairedSDKMessage): boolean =>
	event.type === 'rate_limit_event' || (event.type === 'system' && event.subtype === 'api_retry')

const usageLimitReachedMessage = (rateLimitType: string | undefined): string =>
	rateLimitType === undefined
		? 'Claude usage limit reached.'
		: `Claude ${usageWindowLabel(rateLimitType)} usage limit reached.`

/** Processes the ordered SDK event stream for one scoped Claude session. */
export const processClaudeEvents = (input: ProcessClaudeEventsInput) =>
	Effect.scoped(
		Effect.gen(function* () {
			const api = yield* DaemonApi
			const streamProducer = yield* StreamProducer
			const crypto = yield* Crypto.Crypto
			const usageLimits = yield* HostUsageLimits
			const sessionId = input.session.id
			let codingAgentSessionId = input.session.coding_agent_session_id ?? undefined
			let previousResultUsage: ClaudeResultUsage | undefined
			let parkedOnUsageLimit = false
			let usageLimitRelease: Fiber.Fiber<void> | undefined
			const cancelUsageLimitRelease = Effect.suspend(() => {
				const release = usageLimitRelease
				usageLimitRelease = undefined
				return release === undefined ? Effect.void : Fiber.interrupt(release)
			})
			const releaseParkedSessionAfter = (delayMs: number) =>
				Effect.sleep(Duration.millis(delayMs)).pipe(
					Effect.andThen(
						Effect.gen(function* () {
							if (!parkedOnUsageLimit || (yield* input.interruptState.wasInterrupted)) return
							parkedOnUsageLimit = false
							yield* Effect.logInfo('Usage limit window has passed with no SDK activity; resuming').pipe(
								Effect.annotateLogs({ sessionId }),
							)
							yield* api.updateSession({ sessionId, status: 'running' })
						}).pipe(Effect.uninterruptible),
					),
					Effect.catch((error: unknown) =>
						Effect.logWarning('Could not resume a session parked on the usage limit').pipe(
							Effect.annotateLogs({ sessionId, error }),
						),
					),
				)
			const scheduleUsageLimitRelease = (info: SDKRateLimitInfo) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis
					const recorded =
						info.rateLimitType === undefined
							? undefined
							: (yield* usageLimits.current)?.claude?.windows[info.rateLimitType]?.resets_at
					const resetMs = rateLimitResetToMs(info.resetsAt) ?? recorded ?? null
					const releaseAt =
						(resetMs !== null && resetMs > now ? resetMs : now + USAGE_LIMIT_RELEASE_FALLBACK_MS) +
						USAGE_LIMIT_RELEASE_GRACE_MS
					yield* cancelUsageLimitRelease
					usageLimitRelease = yield* releaseParkedSessionAfter(releaseAt - now).pipe(Effect.forkScoped)
				})
			const seenUsageMessageIds = new Set<string>()
			const recordUsageSnapshot = input.sdkSession.controls.readUsage.pipe(
				Effect.timeout(usageSnapshotTimeout),
				Effect.flatMap((snapshot) =>
					snapshot === undefined ? Effect.void : usageLimits.applyClaudeUsageSnapshot(snapshot),
				),
				Effect.catch((error: unknown) =>
					Effect.logWarning('Could not read Claude usage snapshot').pipe(
						Effect.annotateLogs({ sessionId, error }),
					),
				),
			)
			const publicationWorker = yield* makeDurablePublicationWorker(sessionId, streamProducer)

			// The SDK reports skills as bare names; their descriptions and scope only exist on disk.
			const reportWorkspaceAgentCommands = (report: { readonly cwd: string }) =>
				Effect.gen(function* () {
					const supported = yield* input.sdkSession.controls.supportedCommands
					const { skills } = yield* discoverAgentCommands({ workspacePath: report.cwd })
					yield* api.reportAgentCommands({
						hostId: input.session.host_id,
						agent: 'claude',
						workspacePath: report.cwd,
						commands: toAgentCommands(supported),
						skills,
					})
				}).pipe(
					captureAgentCommandsReportFailureAndContinue({
						hostId: input.session.host_id,
						workspacePath: report.cwd,
						sessionId,
					}),
					Effect.withSpan('agent_commands.report_workspace'),
				)

			yield* Stream.runForEach(
				pairCompactBoundariesWithSummaries(input.sdkSession.output),
				(event: PairedSDKMessage) =>
					Effect.gen(function* () {
						if (!keepsUsageLimitReleaseScheduled(event)) yield* cancelUsageLimitRelease
						switch (event.type) {
							case 'system':
								if (event.subtype === 'init') {
									codingAgentSessionId = event.session_id
									yield* api.updateSession({
										sessionId,
										codingAgentSessionId,
										status: 'running',
										resolvedModel: event.model,
										isCompacting: false,
									})
									yield* reportWorkspaceAgentCommands({ cwd: event.cwd }).pipe(Effect.forkScoped)
									yield* recordUsageSnapshot.pipe(Effect.forkScoped)
									break
								}
								if (event.subtype === 'status') {
									if (event.status === 'compacting') {
										yield* api.updateSession({ sessionId, isCompacting: true })
									} else if (event.compact_result !== undefined) {
										yield* api.updateSession({ sessionId, isCompacting: false })
									}
									break
								}
								if (event.subtype === 'compact_boundary') {
									if (!codingAgentSessionId) break
									const { trigger, pre_tokens, post_tokens, duration_ms } = event.compact_metadata
									const preTokens =
										Number.isFinite(pre_tokens) && pre_tokens >= 0 ? pre_tokens : undefined
									const postTokens =
										typeof post_tokens === 'number' &&
										Number.isFinite(post_tokens) &&
										post_tokens > 0
											? post_tokens
											: undefined
									const durationMs =
										typeof duration_ms === 'number' &&
										Number.isFinite(duration_ms) &&
										duration_ms >= 0
											? duration_ms
											: undefined
									// post_tokens is measured by the agent against the rebuilt context
									// (system prompt and tools included); without this write the meter
									// keeps the pre-compaction count until the next assistant turn.
									if (postTokens !== undefined) {
										yield* api.updateSession({ sessionId, contextWindowTokens: postTokens })
									}
									const compactionPayload: {
										kind: 'context_compaction'
										trigger: 'manual' | 'auto'
										preTokens?: number
										postTokens?: number
										durationMs?: number
									} = {
										kind: 'context_compaction',
										trigger,
									}
									if (preTokens !== undefined) compactionPayload.preTokens = preTokens
									if (postTokens !== undefined) compactionPayload.postTokens = postTokens
									if (durationMs !== undefined) compactionPayload.durationMs = durationMs
									yield* api.createConversationEvent({
										// The boundary uuid keys the row, so an oRPC retry or a stream
										// replay hits ON CONFLICT (id) instead of inserting a second divider.
										eventId: event.uuid,
										sessionId,
										codingAgentSessionId,
										codingAgentEventId: event.uuid,
										eventType: 'system',
										role: 'system',
										content: JSON.stringify(compactionPayload),
									})
									if (Option.isSome(event.summary)) {
										yield* persistCompactionSummary({
											sessionId,
											codingAgentSessionId,
											boundaryEventId: event.uuid,
											summary: event.summary.value,
										})
									}
									break
								}
								if (event.subtype === 'model_refusal_fallback') {
									const fallback = yield* Schema.decodeUnknownEffect(ClaudeModelFallbackSchema)(
										event,
									).pipe(Effect.mapError((cause) => new ClaudeSessionDataError({ sessionId, cause })))
									if (codingAgentSessionId && fallback.content) {
										yield* api.createConversationEvent({
											sessionId,
											codingAgentSessionId,
											eventType: 'message',
											role: 'assistant',
											content: fallback.content,
										})
									}
									if (fallback.fallback_model) {
										yield* api.updateSession({
											sessionId,
											model: fallback.fallback_model,
											resolvedModel: fallback.fallback_model,
										})
									}
								}
								break
							case 'assistant':
							case 'user':
								if (!codingAgentSessionId) {
									yield* Effect.logError('Received Claude message before system init').pipe(
										Effect.annotateLogs({ sessionId, eventType: event.type }),
									)
									break
								}
								if (event.type === 'assistant' && (yield* input.interruptState.wasInterrupted)) break
								if (event.type === 'user' && typeof event.message.content === 'string') break
								yield* persistClaudeMessage({
									session: input.session,
									codingAgentSessionId,
									message: event,
									seenUsageMessageIds,
									publicationWorker,
								})
								break
							case 'rate_limit_event': {
								const info = event.rate_limit_info
								if (typeof info !== 'object' || info === null) {
									yield* Effect.logWarning('Skipping rate limit event without rate limit info').pipe(
										Effect.annotateLogs({ sessionId }),
									)
									break
								}
								yield* usageLimits.applyClaudeRateLimitEvent(info)
								if (rateLimitRejectionParksTurnUntilReset(info)) {
									yield* scheduleUsageLimitRelease(info)
									if (parkedOnUsageLimit) break
									parkedOnUsageLimit = true
									yield* Effect.logWarning(
										'Claude usage limit reached; session waits for the window to reset',
									).pipe(
										Effect.annotateLogs({
											sessionId,
											rateLimitType: info.rateLimitType,
											resetsAt: info.resetsAt,
										}),
									)
									yield* api.updateSession({
										sessionId,
										status: 'waiting_for_usage_limit',
										errorMessage: usageLimitReachedMessage(info.rateLimitType),
									})
									break
								}
								yield* cancelUsageLimitRelease
								if (parkedOnUsageLimit) {
									parkedOnUsageLimit = false
									if (!(yield* input.interruptState.wasInterrupted)) {
										yield* api.updateSession({ sessionId, status: 'running' })
									}
								}
								break
							}
							case 'stream_event':
								yield* publicationWorker.publishPartialEvent(
									(event as SDKPartialAssistantMessage).event,
								)
								break
							case 'result': {
								const parsed = yield* Schema.decodeUnknownEffect(ClaudeResultUsageSchema)(event).pipe(
									Effect.mapError((cause) => new ClaudeSessionDataError({ sessionId, cause })),
								)
								const usage = transformClaudeResultUsage(
									subtractClaudeResultUsage(parsed, previousResultUsage),
								)
								previousResultUsage = parsed
								parkedOnUsageLimit = false
								if (input.onResult !== undefined) yield* input.onResult
								const reportKey =
									'uuid' in event && event.uuid
										? String(event.uuid)
										: yield* crypto.randomUUIDv7.pipe(
												Effect.mapError(
													(cause) => new ClaudeSessionDataError({ sessionId, cause }),
												),
											)
								if (!(yield* input.interruptState.wasInterrupted)) {
									yield* api.updateSession({
										sessionId,
										status: event.subtype === 'success' ? 'ready_for_input' : 'failed',
										errorMessage: event.subtype === 'success' ? undefined : event.subtype,
										totalCostUsd: usage.totalCostUsd,
										modelUsage: usage.modelUsage,
										usageReportKey: reportKey,
									})
								}
								if (input.closeInputOnResult) {
									yield* input.sdkSession.input.close
								}
								if (usage.entries.length > 0) {
									const occurredAt = yield* Clock.currentTimeMillis
									yield* api
										.recordUsage({
											sessionId,
											reportKey,
											source: 'claude_sdk_result',
											occurredAt,
											entries: [...usage.entries],
										})
										.pipe(
											Effect.catchTag('DaemonUsageRecordError', (error) =>
												Effect.logError('Failed to record Claude usage').pipe(
													Effect.annotateLogs({ sessionId, error }),
												),
											),
										)
								}
								break
							}
						}
					}),
			)
			yield* publicationWorker.close
			yield* input.sdkSession.markCompleted
		}),
	).pipe(Effect.withSpan('claude.process_events', { attributes: { session_id: input.session.id } }))
