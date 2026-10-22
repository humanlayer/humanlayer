import { and, eq, inArray, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

export function useSessionQueuedMessages(sessionId: string | undefined) {
	const { queuedMessagesCollection, eventsCollection } = useSync()

	const { data: messages } = useLiveQuery(
		(q) =>
			sessionId
				? q
						.from({ msgs: queuedMessagesCollection })
						.where(({ msgs }) => and(eq(msgs.session_id, sessionId), eq(msgs.status, 'pending')))
						.orderBy(({ msgs }) => msgs.created_at, 'asc')
				: undefined,
		[queuedMessagesCollection, sessionId],
	)

	// Delivery writes the conversation event with the queued message's id and flips the row to
	// delivered in one transaction, but the two tables sync on separate shapes. Until the
	// queued-message shape catches up, the delivered message would render twice.
	const pendingIds = useMemo(() => (messages ?? []).map((message) => message.id), [messages])
	const pendingIdsKey = pendingIds.join(',')
	const { data: deliveredEvents } = useLiveQuery(
		(q) =>
			sessionId && pendingIds.length > 0
				? q
						.from({ events: eventsCollection })
						.where(({ events }) => and(eq(events.session_id, sessionId), inArray(events.id, pendingIds)))
						.select(({ events }) => ({ id: events.id }))
				: undefined,
		[eventsCollection, sessionId, pendingIdsKey],
	)

	const pendingMessages = useMemo(() => {
		const deliveredIds = new Set((deliveredEvents ?? []).map((event) => event.id))
		return (messages ?? []).filter((message) => !deliveredIds.has(message.id))
	}, [messages, deliveredEvents])

	return { messages: pendingMessages, count: pendingMessages.length }
}
