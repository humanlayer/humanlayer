import { and, eq, or, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useSessionActions } from '@/hooks/useSessionActions'
import { cleanupPtyForSession } from '@/integrations/desktop/pty'

/**
 * Supplies the task assignment dialog with valid target tasks and the action
 * that adds, moves, or removes the current session.
 */
export function useSessionTaskAssignment({
	session,
	onDone,
}: {
	session: { id: string; task_id: string | null }
	onDone: () => void
}) {
	const { tasksCollection } = useSync()
	const { user } = useAuth()
	const sessionActions = useSessionActions()

	// Users can move their sessions to active tasks they own. Keep the current
	// task visible even when it is archived or shared so the dialog has context.
	const { data: rawTasks } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => {
					const ownedActiveTask = and(eq(tasks.resource_owner_user_id, user.id), eq(tasks.archived, false))
					return session.task_id ? or(ownedActiveTask, eq(tasks.id, session.task_id)) : ownedActiveTask
				})
				.orderBy(({ tasks }) => tasks.updated_at, 'desc')
		},
		[tasksCollection, user?.id, session.task_id],
	)
	const taskOptions = useMemo(
		() => (rawTasks ?? []).map((task) => ({ id: task.id, name: task.name, archived: task.archived })),
		[rawTasks],
	)

	const handleTaskChange = useCallback(
		(taskId: string | null) => {
			if (taskId === session.task_id) {
				onDone()
				return
			}
			// Clean up session-scoped terminal before transitioning to task-scoped
			if (!session.task_id) {
				cleanupPtyForSession(session.id)
				useTerminalStore.getState().clearTerminalState(session.id)
			}
			onDone()
			const transaction = sessionActions.updateSessionTask({ sessionId: session.id, taskId })
			transaction.isPersisted.promise
				.then(() => {
					if (!taskId) toast.success('Removed from task')
					else if (!session.task_id) toast.success('Added to task')
					else toast.success('Changed task')
				})
				.catch(() => toast.error('Failed to update task'))
		},
		[session.id, session.task_id, sessionActions, onDone],
	)

	return { taskOptions, handleTaskChange }
}
