import type { AgentEvent, AgentRun } from '@humanlayer/agentlayer-core'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { AssistantModelMessage, TextPart, ToolCallPart, ToolModelMessage, ToolResultPart } from 'ai'
import { Effect } from 'effect'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import type { DaemonRuntime } from '../../effects/runtime'
import {
	StreamProducer,
	StreamProducerLiveForSession,
	type StreamProducerService,
} from '../../effects/services/stream-producer/stream-producer.service'
import type { ORPCClient } from '../claudecode/types'
import type { InterruptStateService } from '../shared/interrupt-state.service'
import {
	type CreateEventInput,
	cleanupAfterStreamEventLoop,
	getStreamEventIdForCompletedBlock,
	writeCompletedConversationEvent,
} from '../shared/streaming-events'
import { handleCodelayerStreamEvent } from './stream-event-handler'

/**
 * Detects binary content by checking for null bytes.
 * Null bytes never appear in legitimate text (same heuristic git uses for binary detection).
 */
function containsBinaryData(str: string): boolean {
	return str.includes('\0')
}

/**
 * Stringify a ToolResultPart output to a string for storage.
 */
function stringifyToolOutput(output: ToolResultPart['output']): string {
	switch (output.type) {
		case 'text':
		case 'error-text':
			return output.value
		case 'json':
		case 'error-json':
			return JSON.stringify(output.value)
		case 'execution-denied':
			return output.reason ?? '[execution denied]'
		case 'content':
			return JSON.stringify(output.value)
		default: {
			// Exhaustive check - TypeScript will error if new types are added
			const _exhaustive: never = output
			return JSON.stringify(_exhaustive)
		}
	}
}

function normalizeToolName(name: string | undefined): string {
	return name?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
}

function canonicalizeToolName(name: string | undefined): string | undefined {
	if (!name) return name

	const normalized = normalizeToolName(name)
	if (
		normalized === 'agent' ||
		normalized === 'task' ||
		normalized === 'subagent' ||
		normalized === 'functionsagent'
	) {
		return 'agent'
	}

	return name
}

function isCompactionPrompt(content: string): boolean {
	return content.startsWith('<conversation>\n')
}

/**
 * Child agent events are forwarded into the parent stream with agentId and/or parentToolCallId.
 * These events should not update the top-level session context window metrics.
 */
function isChildAgentEvent(event: AgentEvent): boolean {
	return !!event.agentId || !!event.parentToolCallId
}

/** Creates the DB event, then mirrors that completed event into the durable stream. */
async function createAndStreamConversationEvent(
	orpc: ORPCClient,
	streamProducer: StreamProducerService | undefined,
	eventInput: CreateEventInput,
): Promise<void> {
	const result = await orpc.sessions.events.create(eventInput)
	await writeCompletedConversationEvent(streamProducer, eventInput, result.eventId, 'CodeLayer')
}

/** Persists a completed assistant text/thinking block, reusing its streamed placeholder ID when available. */
async function createAssistantContentEvent(
	orpc: ORPCClient,
	sessionId: string,
	eventType: 'message' | 'thinking',
	content: string,
	parentToolUseId: string | null,
	streamProducer: StreamProducerService | undefined,
	blockIndex: number,
	streamBlockType?: 'text' | 'thinking',
): Promise<void> {
	const eventId = streamBlockType
		? await getStreamEventIdForCompletedBlock(sessionId, streamProducer, blockIndex, streamBlockType, 'CodeLayer')
		: undefined
	const eventInput: CreateEventInput = {
		sessionId,
		codingAgentSessionId: sessionId,
		eventType,
		role: 'assistant',
		content,
		parentToolUseId,
	}
	if (eventId) eventInput.eventId = eventId

	await createAndStreamConversationEvent(orpc, streamProducer, eventInput)
}

/** Emits `message_stop` for the synthetic CodeLayer stream message if one is open. */
/** Closes a synthetic message and deletes streamed blocks that never became persisted events. */
async function closeAndDiscardUnmaterializedBlocks(streamProducer: StreamProducerService): Promise<void> {
	await Effect.runPromise(
		streamProducer.closeMessageAndDiscardUnmaterializedBlocks?.() ??
			streamProducer.writeMessageStop().pipe(Effect.andThen(streamProducer.deleteUnmaterializedBlocks())),
	)
}

/**
 * Process an assistant message and create session events for each content part.
 * @param parentToolUseId - If this message is from a sub-agent, the ID of the parent Agent tool call
 */
async function processAssistantMessage(
	orpc: ORPCClient,
	sessionId: string,
	message: AssistantModelMessage,
	parentToolUseId: string | null,
	streamProducer?: StreamProducerService,
	isTopLevelMessage = true,
): Promise<string | null> {
	const { content } = message
	const shouldMaterializeStream = isTopLevelMessage && parentToolUseId === null

	if (typeof content === 'string') {
		if (!content) return null
		await createAssistantContentEvent(
			orpc,
			sessionId,
			'message',
			content,
			parentToolUseId,
			streamProducer,
			0,
			shouldMaterializeStream ? 'text' : undefined,
		)
		return content
	}

	const persistedTextParts: string[] = []
	for (const [blockIndex, part] of content.entries()) {
		if (part.type === 'text') {
			const textPart = part as TextPart
			if (!textPart.text) continue
			await createAssistantContentEvent(
				orpc,
				sessionId,
				'message',
				textPart.text,
				parentToolUseId,
				streamProducer,
				blockIndex,
				shouldMaterializeStream ? 'text' : undefined,
			)
			persistedTextParts.push(textPart.text)
		} else if (part.type === 'tool-call') {
			const toolCallPart = part as ToolCallPart
			await createAndStreamConversationEvent(orpc, streamProducer, {
				sessionId,
				codingAgentSessionId: sessionId,
				eventType: 'tool_call',
				role: 'assistant',
				toolCallId: toolCallPart.toolCallId,
				toolName: canonicalizeToolName(toolCallPart.toolName),
				toolInputJson: toolCallPart.input as Record<string, unknown>,
				parentToolUseId,
			})
		} else if (part.type === 'reasoning' && 'text' in part && typeof part.text === 'string') {
			if (!part.text) continue
			await createAssistantContentEvent(
				orpc,
				sessionId,
				'thinking',
				part.text,
				parentToolUseId,
				streamProducer,
				blockIndex,
				shouldMaterializeStream ? 'thinking' : undefined,
			)
		}
		// other parts are skipped
	}
	return persistedTextParts.length > 0 ? persistedTextParts.join('\n') : null
}

/**
 * Process a tool message and create session events for each tool result.
 * @param parentToolUseId - If this message is from a sub-agent, the ID of the parent Agent tool call
 */
async function processToolMessage(
	orpc: ORPCClient,
	sessionId: string,
	message: ToolModelMessage,
	parentToolUseId: string | null,
	streamProducer?: StreamProducerService,
): Promise<void> {
	for (const part of message.content) {
		if (part.type === 'tool-result') {
			const toolResultPart = part as ToolResultPart
			const resultString = stringifyToolOutput(toolResultPart.output)

			await createAndStreamConversationEvent(orpc, streamProducer, {
				sessionId,
				codingAgentSessionId: sessionId,
				eventType: 'tool_result',
				role: 'user',
				toolResultForId: toolResultPart.toolCallId,
				toolResultContent: containsBinaryData(resultString)
					? `[binary content, ${resultString.length} bytes]`
					: resultString,
				parentToolUseId,
			})
		}
	}
}

/**
 * Process CodeLayer agent events and create session events in the database.
 * Maps Vercel AI SDK ModelMessage types to the daemon's event schema.
 * Updates context_window_tokens on the session when tokenUsage events are received.
 */
export async function processCodelayerEvents(
	agentRun: AgentRun,
	session: Session,
	orpc: ORPCClient,
	daemonRuntime: DaemonRuntime,
	interruptState?: InterruptStateService,
): Promise<void> {
	const sessionId = session.id
	return await daemonRuntime.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const streamProducer = yield* StreamProducer
				return yield* Effect.tryPromise(() =>
					processCodelayerEventsWithStreamProducer(agentRun, session, orpc, streamProducer, interruptState),
				).pipe(
					Effect.ensuring(
						cleanupAfterStreamEventLoop(streamProducer, interruptState, sessionId, 'CodeLayer'),
					),
				)
			}).pipe(Effect.provide(StreamProducerLiveForSession({ sessionId }))),
		),
	)
}

export async function processCodelayerEventsWithStreamProducer(
	agentRun: AgentRun,
	session: Session,
	orpc: ORPCClient,
	streamProducer: StreamProducerService,
	interruptState?: InterruptStateService,
): Promise<void> {
	const sessionId = session.id
	let pendingStepFinishMessageStop = false

	logger.info({ sessionId }, 'CodeLayer starting event processing')

	let eventCount = 0
	const eventTypeCounts = new Map<string, number>()
	for await (const event of agentRun) {
		eventCount++
		eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1)
		try {
			// Extract parentToolCallId for sub-agent grouping in UI
			// The agent-sdk forwards child events with parentToolCallId set
			const parentToolUseId = (event as AgentEvent).parentToolCallId ?? null
			const isTopLevelEvent = !isChildAgentEvent(event)

			switch (event.type) {
				case 'textStart':
					if (pendingStepFinishMessageStop) {
						await closeAndDiscardUnmaterializedBlocks(streamProducer)
						pendingStepFinishMessageStop = false
					}
					await Effect.runPromise(handleCodelayerStreamEvent(event, streamProducer))
					break

				case 'reasoningStart':
					if (pendingStepFinishMessageStop) {
						await closeAndDiscardUnmaterializedBlocks(streamProducer)
						pendingStepFinishMessageStop = false
					}
					await Effect.runPromise(handleCodelayerStreamEvent(event, streamProducer))
					break

				case 'textDelta':
				case 'textEnd':
				case 'reasoningDelta':
				case 'reasoningEnd':
					await Effect.runPromise(handleCodelayerStreamEvent(event, streamProducer))
					break

				case 'toolInputStart':
				case 'toolInputDelta':
				case 'toolInputEnd':
					break

				case 'stepFinish':
					if (isTopLevelEvent) {
						pendingStepFinishMessageStop = true
					}
					break

				case 'message': {
					const { message } = event
					if (message.role === 'assistant') {
						logger.debug(
							{ sessionId, role: 'assistant', parentToolUseId },
							'CodeLayer processing assistant message',
						)
						await processAssistantMessage(
							orpc,
							sessionId,
							message,
							parentToolUseId,
							streamProducer,
							isTopLevelEvent,
						)
						if (isTopLevelEvent) {
							await closeAndDiscardUnmaterializedBlocks(streamProducer)
							pendingStepFinishMessageStop = false
						}
					} else if (message.role === 'tool') {
						if (isTopLevelEvent && pendingStepFinishMessageStop) {
							await closeAndDiscardUnmaterializedBlocks(streamProducer)
							pendingStepFinishMessageStop = false
						}
						await processToolMessage(orpc, sessionId, message, parentToolUseId, streamProducer)
					} else if (message.role === 'user') {
						if (isTopLevelEvent && pendingStepFinishMessageStop) {
							await closeAndDiscardUnmaterializedBlocks(streamProducer)
							pendingStepFinishMessageStop = false
						}
						const content =
							typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
						if (isCompactionPrompt(content)) break
						await createAndStreamConversationEvent(orpc, streamProducer, {
							sessionId,
							codingAgentSessionId: sessionId,
							eventType: 'message',
							role: 'user',
							content,
							parentToolUseId,
						})
					}
					// system messages are not stored as events
					break
				}

				case 'approvalRequested':
					// Approval events are handled by the approval hook; log for visibility
					logger.debug(
						{ sessionId, toolName: event.toolName, toolCallId: event.toolCallId },
						'CodeLayer approval requested',
					)
					break

				case 'tokenUsage': {
					// Update session context window metrics from the runtime event.
					// The tokenUsage event is emitted after each generateText call,
					// providing the current context window usage and, when available,
					// the runtime-resolved context window limit.
					//
					// DELIBERATELY cache-INCLUSIVE, unlike session_usage_events.input_tokens.
					// AgentLayer derives contextWindowTokens as `usage.inputTokens + usage.outputTokens`
					// where inputTokens is the total prompt (cache reads included). That is the
					// right number here: a context window IS the whole prompt occupying it, and cached
					// tokens still occupy it. Do NOT apply the cache subtraction used by
					// token-usage.ts's toConventionalTokenMap — that one exists to satisfy the
					// billing-style contract on the usage table, which measures tokens *charged by
					// category*, not window occupancy.
					const { contextWindowTokens, contextWindowLimit } = event.usage
					if (isChildAgentEvent(event)) {
						logger.debug(
							{
								sessionId,
								agentId: event.agentId,
								parentToolCallId: event.parentToolCallId,
								contextWindowTokens,
								contextWindowLimit,
							},
							'CodeLayer skipping child context window metrics update',
						)
						break
					}
					logger.debug(
						{ sessionId, contextWindowTokens, contextWindowLimit },
						'CodeLayer updating context window metrics',
					)
					if (contextWindowLimit === undefined) {
						await orpc.sessions.update({ sessionId, contextWindowTokens })
					} else {
						await orpc.sessions.update({ sessionId, contextWindowTokens, contextWindowLimit })
					}
					break
				}

				case 'compaction':
					logger.info(
						{
							sessionId,
							agentId: event.agentId,
							parentToolCallId: event.parentToolCallId,
							trigger: event.trigger,
							priorContextWindowTokens: event.priorContextWindowTokens,
							replacedMessageCount: event.replacedMessageCount,
							retainedMessageCount: event.retainedMessageCount,
							summaryModel: event.summaryUsage.model,
							summaryUsage: event.summaryUsage.usage,
						},
						'CodeLayer context compacted',
					)
					break

				default:
					logger.debug({ sessionId, event }, 'Unhandled CodeLayer agent event')
			}
		} catch (error) {
			// Non-blocking: log error but continue processing events
			logger.error({ err: error, sessionId, eventType: event.type }, 'Failed to process CodeLayer agent event')
			Sentry.captureException(error)
		}
	}

	if (pendingStepFinishMessageStop) {
		await closeAndDiscardUnmaterializedBlocks(streamProducer)
	}

	// Log if the run ended due to interrupt
	const eventTypeSummary = Object.fromEntries(eventTypeCounts)
	if (interruptState && (await Effect.runPromise(interruptState.wasInterrupted))) {
		logger.info({ sessionId, eventCount, eventTypeSummary }, 'CodeLayer event processing complete (interrupted)')
	} else {
		logger.info({ sessionId, eventCount, eventTypeSummary }, 'CodeLayer event processing complete')
	}
}
