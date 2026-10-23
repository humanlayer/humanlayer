import type { SDKCompactBoundaryMessage, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Option, Predicate, Stream } from 'effect'

export interface CompactionSummaryMessage {
	readonly uuid: string | undefined
	readonly text: string
}

export interface CompactBoundaryWithSummary extends SDKCompactBoundaryMessage {
	readonly summary: Option.Option<CompactionSummaryMessage>
}

export type PairedSDKMessage = Exclude<SDKMessage, SDKCompactBoundaryMessage> | CompactBoundaryWithSummary

type HeldBoundary = Option.Option<SDKCompactBoundaryMessage>

const isCompactBoundary = (message: SDKMessage): message is SDKCompactBoundaryMessage =>
	message.type === 'system' && message.subtype === 'compact_boundary'

const compactionSummaryOf = (
	message: Exclude<SDKMessage, SDKCompactBoundaryMessage>,
): Option.Option<CompactionSummaryMessage> => {
	if (message.type !== 'user' || message.isSynthetic !== true) return Option.none()
	const content = message.message.content
	return Predicate.isString(content) && content.length > 0
		? Option.some({ uuid: message.uuid, text: content })
		: Option.none()
}

const boundaryWith = (
	boundary: SDKCompactBoundaryMessage,
	summary: Option.Option<CompactionSummaryMessage>,
): CompactBoundaryWithSummary => ({ ...boundary, summary })

const releaseWithoutSummary = (held: HeldBoundary): ReadonlyArray<PairedSDKMessage> =>
	Option.match(held, {
		onNone: () => [],
		onSome: (boundary) => [boundaryWith(boundary, Option.none())],
	})

/**
 * The SDK marks a compaction summary only by position: it is the synthetic
 * user message emitted right after the compact boundary, with no field linking
 * the two. Each boundary is held for exactly one message so that summary rides
 * on the boundary itself and no downstream handler coordinates across messages.
 */
export const pairCompactBoundariesWithSummaries = <E, R>(
	messages: Stream.Stream<SDKMessage, E, R>,
): Stream.Stream<PairedSDKMessage, E, R> =>
	Stream.mapAccum(
		messages,
		(): HeldBoundary => Option.none(),
		(held, message): readonly [HeldBoundary, ReadonlyArray<PairedSDKMessage>] => {
			if (isCompactBoundary(message)) return [Option.some(message), releaseWithoutSummary(held)]
			if (Option.isNone(held)) return [held, [message]]
			const summary = compactionSummaryOf(message)
			return Option.isSome(summary)
				? [Option.none(), [boundaryWith(held.value, summary)]]
				: [Option.none(), [boundaryWith(held.value, Option.none()), message]]
		},
		{ onHalt: releaseWithoutSummary },
	)
