import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import type { RiptideStreamDB } from '@/collections/stream'

export const useInProgressThinkingBlocks = (
	sessionId: string,
	db: RiptideStreamDB,
	savedEventIds: ReadonlySet<string>,
) => {
	const startsQuery = useLiveQuery(
		(q) =>
			q
				.from({ start: db.collections.thinkingBlockStarts })
				.where(({ start }) => eq(start.session_id, sessionId))
				.orderBy(({ start }) => start.message_seq, 'asc')
				.orderBy(({ start }) => start.block_seq, 'asc'),
		[db.collections.thinkingBlockStarts, sessionId],
	)

	const data = useMemo(
		() => startsQuery.data.filter((start) => !savedEventIds.has(start.conversation_event_id)),
		[startsQuery.data, savedEventIds],
	)

	return { ...startsQuery, data }
}
