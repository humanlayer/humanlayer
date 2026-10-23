import type { CreateEventInputSchema } from '@humanlayer/riptide-api-contract/daemon/events/create'
import { Cause, Effect } from 'effect'
import type z from 'zod/v4'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import type { StreamProducerService } from '../../effects/services/stream-producer/stream-producer.service'
import type { InterruptStateService } from './interrupt-state.service'

export type CreateEventInput = z.infer<typeof CreateEventInputSchema>
export type StreamBlockType = 'text' | 'thinking' | 'tool_use'

/**
 * Finds the streamed placeholder ID for a completed content block so DB
 * persistence replaces the stream row.
 *
 * @param allBlockTypesInMessage - the block types of every block in the current
 *   assistant item's content array, in order. Captured for diagnostics when the
 *   lookup fails — reveals whether the SDK yielded accumulated blocks (e.g.
 *   [thinking, text]) vs single-block incremental items ([text]).
 */
export const getStreamEventIdForCompletedBlock = async (
	sessionId: string,
	streamProducer: StreamProducerService | undefined,
	blockIndex: number,
	blockType: StreamBlockType,
	agentName: string,
	allBlockTypesInMessage?: string[],
) => {
	return Effect.runPromise(
		Effect.gen(function* () {
			const producer = streamProducer
			if (!producer) {
				logger.warn(
					{ sessionId, blockIndex, blockType, agentName },
					`Stream producer unavailable for ${agentName} block ID lookup`,
				)
				return null
			}

			const exactMatch = yield* producer.getConversationEventIdForBlock(blockIndex, blockType)
			if (exactMatch) return exactMatch

			const nextTypedMatch = yield* producer.consumeNextConversationEventIdByType(blockType)
			if (nextTypedMatch) return nextTypedMatch

			// Both lookups failed. Capture the full producer map state so we can
			// diagnose exactly why:
			//   - producerBlockTypes: what content_block_start events were processed and at which indices
			//   - producerEventIds: the UUIDs assigned to each block index
			//   - consumedIds: which UUIDs have already been consumed by prior handleMessage calls
			//   - messageSeq: which API turn we're on
			//   - allBlockTypesInMessage: what blocks are in THIS assistant item (single vs accumulated)
			const debugState = yield* producer.getDebugState()

			logger.warn(
				{
					sessionId,
					blockIndex,
					blockType,
					agentName,
					allBlockTypesInMessage,
					producerBlockTypes: debugState?.blockTypesByBlockSeq,
					producerEventIds: debugState?.conversationEventIdsByBlockSeq,
					consumedIds: debugState?.consumedConversationEventIds,
					messageSeq: debugState?.messageSeq,
				},
				`Unable to match completed ${agentName} block to streamed conversation event ID`,
			)

			return null
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.sync(() => {
					const error = Cause.squash(cause)
					logger.error(
						{ sessionId, blockIndex, blockType, agentName, error, causeDetails: Cause.pretty(cause) },
						'Unexpected defect in stream event ID lookup (graceful degradation)',
					)
					Sentry.captureException(error, {
						tags: {
							error_type: 'stream_event_id_lookup_defect',
							session_id: sessionId,
							agent_name: agentName,
						},
						extra: { blockIndex, blockType, causeDetails: Cause.pretty(cause) },
					})
					return null
				}),
			),
		),
	)
}

/** Publishes the final persisted event into the stream so the UI can swap deltas for canonical content. */
export async function writeCompletedConversationEvent(
	streamProducer: StreamProducerService | undefined,
	eventInput: CreateEventInput,
	conversationEventId: string,
	agentName: string,
) {
	if (!streamProducer) return
	const now = Date.now()
	await Effect.runPromise(
		streamProducer
			.writeConversationEvent({
				conversation_event_id: conversationEventId,
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
			})
			.pipe(
				Effect.catchCause((cause) =>
					Effect.sync(() => {
						const error = Cause.squash(cause)
						logger.error(
							{
								sessionId: eventInput.sessionId,
								conversationEventId,
								agentName,
								error,
								causeDetails: Cause.pretty(cause),
							},
							'Failed to publish completed conversation event to stream (graceful degradation)',
						)
					}),
				),
			),
	)
}

/** Flushes stream writes and removes partial stream blocks left behind by interrupted or mismatched runs. */
export const cleanupAfterStreamEventLoop = (
	streamProducer: StreamProducerService,
	interruptState: InterruptStateService | undefined,
	sessionId: string,
	agentName: string,
) =>
	Effect.gen(function* () {
		yield* streamProducer.deleteUnmaterializedBlocks().pipe(
			Effect.catchCause((cause) =>
				Effect.sync(() => {
					const error = Cause.squash(cause)
					logger.error(
						{ sessionId, agentName, error, causeDetails: Cause.pretty(cause) },
						`Failed to delete unmaterialized ${agentName} stream rows`,
					)
				}),
			),
		)

		yield* streamProducer.flush().pipe(
			Effect.catchCause((cause) =>
				Effect.sync(() => {
					const error = Cause.squash(cause)
					// A cleanup flush timeout carries producer-state diagnostics on the inner
					// DurableStreamFlushError; surface them so DAEMON-7K shows slow_drain vs stalled
					// (instead of a bare "timeout") and the in-flight/pending backlog at the timeout.
					const diagnostics = (error as { cause?: { diagnostics?: unknown } })?.cause?.diagnostics
					logger.error(
						{ sessionId, agentName, error, diagnostics, causeDetails: Cause.pretty(cause) },
						`Failed to flush ${agentName} stream events`,
					)
					Sentry.captureException(error, {
						tags: {
							error_type: 'durable_stream_producer_cleanup_flush',
							session_id: sessionId,
							agent_name: agentName,
						},
						extra: { causeDetails: Cause.pretty(cause), diagnostics },
					})
				}),
			),
		)
	})
