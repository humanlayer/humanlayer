import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'
import { useTaskWorkspaceView } from '@/hooks/live-queries/useTaskWorkspaceView'
import { resolveWorkspaceBaseDirectory } from '@/lib/workspace-launch'

/**
 * Workspace base directory used for file-link resolution on multi-repo
 * `worktree:now` tasks: the current user's recorded local base
 * (task_user_settings.workspace_base_directory) when set, else the task
 * snapshot's non-expanded `~/...` base — openFileInEditor expands `~`
 * against the local home before probing.
 *
 * Returns null for single-repo / legacy tasks (and while rows are syncing),
 * so passing the result through to openFileInEditor is a zero-behavior-change
 * no-op outside multi-repo workspaces.
 */
export function useWorkspaceBaseDirectory(
	taskId: string | null | undefined,
	userId: string | undefined,
): string | null {
	const { tasksCollection, taskUserSettingsCollection } = useSync()

	const { data: taskData } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId))
		},
		[tasksCollection, taskId],
	)
	const task = taskData?.[0]

	const { data: settingsData } = useLiveQuery(
		(q) => {
			if (!taskId || !userId) return undefined
			return q
				.from({ settings: taskUserSettingsCollection })
				.where(({ settings }) => and(eq(settings.task_id, taskId), eq(settings.user_id, userId)))
		},
		[taskUserSettingsCollection, taskId, userId],
	)
	const userWorkspaceBaseDirectory = settingsData?.[0]?.workspace_base_directory ?? null
	const workspaceView = useTaskWorkspaceView(
		task
			? { ...task, workspace_spec: task.workspace_spec ?? null, workspace_state: task.workspace_state ?? null }
			: null,
		settingsData?.[0]?.host_id,
	)

	return resolveWorkspaceBaseDirectory(workspaceView, userWorkspaceBaseDirectory)
}
