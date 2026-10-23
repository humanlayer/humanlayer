type StreamConversationEventLike = {
	conversation_event_id: string
	message_seq: number
	timestamp: number
	id?: string
}

type StreamBlockStartLike = {
	conversation_event_id: string
	message_seq: number
	timestamp: number
}

/**
 * Finds the newest streamed event whose final conversation row has arrived from sync.
 *
 * Streaming rows are temporary UI rows backed by the durable stream. Once Electric delivers the
 * same conversation event, the normal conversation timeline owns rendering for that event and for
 * older completed stream rows. This gives the handoff logic a concrete boundary without relying on
 * Electric-only rows that never appeared in the stream.
 */
export function findNewestStreamEventAlreadyDeliveredBySync(
	streamConversationEvents: StreamConversationEventLike[],
	syncedConversationEventIds: ReadonlySet<string>,
): StreamConversationEventLike | null {
	let newestStreamEventAlreadyDeliveredBySync: StreamConversationEventLike | null = null

	for (const event of streamConversationEvents) {
		if (!syncedConversationEventIds.has(event.conversation_event_id)) continue
		if (
			!newestStreamEventAlreadyDeliveredBySync ||
			compareStreamTimelinePosition(event, newestStreamEventAlreadyDeliveredBySync) > 0
		) {
			newestStreamEventAlreadyDeliveredBySync = event
		}
	}

	return newestStreamEventAlreadyDeliveredBySync
}

/**
 * Decides whether a temporary streaming block should be hidden during stream-to-sync handoff.
 *
 * A block is stale when it is older than the newest streamed event already delivered by sync and
 * the block itself has not arrived through sync. Keeping only newer blocks preserves the live tail
 * while preventing ghost streaming rows from lingering after final conversation events render.
 */
export function shouldHideStreamBlockBecauseNewerSyncRowsRendered(
	block: StreamBlockStartLike,
	newestStreamEventAlreadyDeliveredBySync: StreamConversationEventLike | null,
	syncedConversationEventIds: ReadonlySet<string>,
): boolean {
	if (!newestStreamEventAlreadyDeliveredBySync) return false
	if (syncedConversationEventIds.has(block.conversation_event_id)) return false

	return compareStreamTimelinePosition(block, newestStreamEventAlreadyDeliveredBySync) < 0
}

/** Orders stream records by the same timeline fields the stream producer emits. */
function compareStreamTimelinePosition(
	a: { message_seq: number; timestamp: number; id?: string; conversation_event_id?: string },
	b: { message_seq: number; timestamp: number; id?: string; conversation_event_id?: string },
) {
	const messageSeqDiff = a.message_seq - b.message_seq
	if (messageSeqDiff !== 0) return messageSeqDiff

	const timestampDiff = a.timestamp - b.timestamp
	if (timestampDiff !== 0) return timestampDiff

	return (a.conversation_event_id ?? a.id ?? '').localeCompare(b.conversation_event_id ?? b.id ?? '')
}
