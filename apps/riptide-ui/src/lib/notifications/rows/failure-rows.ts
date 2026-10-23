import type { NotificationRow } from '../notification-row'
import type { RowContext } from './row-context'
import { firstLine, sessionName, toMillis } from './row-text'

export function sessionFailureRows(context: RowContext): NotificationRow[] {
	const rows: NotificationRow[] = []
	for (const session of context.sources.sessions) {
		if (session.status !== 'failed' || session.archived || session.created_by !== context.userId) continue
		const key = `session_failed:${session.id}`
		const at = toMillis(session.updated_at)
		if (!context.isOutstanding(key, at)) continue
		rows.push({
			key,
			kind: 'session_failed',
			at,
			actors: [{ agent: true }],
			count: 1,
			subject: sessionName(session),
			taskName: context.taskName(session.task_id),
			detail: session.error_message ? firstLine(session.error_message) : null,
			destination: { kind: 'session', sessionId: session.id },
			dismissible: true,
		})
	}
	return rows
}

export function workspaceSetupRows(context: RowContext): NotificationRow[] {
	const rows: NotificationRow[] = []
	for (const setup of context.sources.workspaceSetups) {
		if (!setup.error) continue
		const task = context.task(setup.task_id)
		if (!task || task.resource_owner_user_id !== context.userId) continue
		const key = `workspace_setup_failed:${setup.id}`
		const at = toMillis(setup.updated_at)
		if (!context.isOutstanding(key, at)) continue
		rows.push({
			key,
			kind: 'workspace_setup_failed',
			at,
			actors: [{ agent: true }],
			count: 1,
			subject: task.name,
			taskName: null,
			detail: firstLine(setup.error.message),
			destination: { kind: 'workspace-setup', taskId: task.id },
			dismissible: true,
		})
	}
	return rows
}
