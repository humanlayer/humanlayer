import type { NotificationRow } from '../notification-row'
import type { RowContext } from './row-context'
import { sessionName, toMillis } from './row-text'

export function readyForInputRows(context: RowContext): NotificationRow[] {
	const rows: NotificationRow[] = []
	for (const session of context.sources.sessions) {
		if (!context.sources.unreadSessionIds.has(session.id)) continue
		if (session.status !== 'ready_for_input' || session.archived || session.created_by !== context.userId) continue
		const key = `ready_for_input:${session.id}`
		const at = toMillis(session.updated_at)
		if (!context.isOutstanding(key, at)) continue
		rows.push({
			key,
			kind: 'ready_for_input',
			at,
			actors: [{ agent: true }],
			count: 1,
			subject: sessionName(session),
			taskName: context.taskName(session.task_id),
			detail: null,
			destination: { kind: 'session', sessionId: session.id },
			dismissible: true,
		})
	}
	return rows
}
