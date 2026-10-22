import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/** Ticket id/url of a task, for ticket badges. Returns undefined when there is no task or no ticket. */
export function useTaskTicket(taskId: string | null | undefined) {
	const { tasksCollection } = useSync()

	const { data } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ tasks: tasksCollection })
						.where(({ tasks }) => eq(tasks.id, taskId))
						.select(({ tasks }) => ({ ticket_id: tasks.ticket_id, ticket_url: tasks.ticket_url }))
				: undefined,
		[tasksCollection, taskId],
	)

	return data?.[0]
}
