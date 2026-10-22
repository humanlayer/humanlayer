import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'

import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import type { TableSession } from '@/components/session-table/types'
import { useTaskWorkspaceSetup } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { compareSessionsByActivityMinute } from '@/lib/activitySorting'
import { getWorkflowPhases } from '@/lib/workflow-phases'
import { useRiptideApi } from '@/orpc/client'
import { toTableSession } from '@/utils/session-transforms'

/**
 * Shared data layer for the task detail page: only what the provider's
 * feature hooks (sessions table, artifact panel, terminal, archive, hotkeys)
 * need across sections. Display-only queries live in the components that
 * render them — e.g. useIsTaskSharedWithOrg in TaskSessionsArea,
 * useFirstOnlineHostId/useTaskOwnerDisplay in TaskSummaryCard, and
 * useTaskSettings/useTaskWorkflowInfo in
 * TaskSidebarPanel.
 */
export function useTaskDetailData(taskId: string) {
	const {
		tasksCollection,
		sessionsCollection,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
		taskUserSettingsCollection,
	} = useSync()
	const { syncAuthReady } = useSyncInternal()
	const { client } = useRiptideApi()

	// Query task
	const {
		data: taskData,
		isReady: isTaskQueryReady,
		isLoading: isTaskLoading,
	} = useLiveQuery(
		(q) => q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)),
		[tasksCollection, taskId],
	)
	const task = taskData?.[0]
	// Electric marks a shape ready on any error, the missing access token included, so a
	// collection that never authenticated reports ready with zero rows. The page turns this
	// flag into "Task not found", so hold it until sync can authenticate.
	const isTaskReady = isTaskQueryReady && syncAuthReady

	// Permission helpers
	const { user } = useAuth()
	const { isOwner, canEditTask, canCreateSession } = useTaskPermissions(
		task,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)

	// Task settings — only the ownership/working-directory pieces the terminal needs.
	// The sidebar owns its own useTaskSettings call for the auto-advance toggles.
	const {
		isOwner: isTaskOwner,
		userWorkingDirectory,
		userHostId,
		userWorkspaceBaseDirectory,
		hasUserSettings,
	} = useTaskSettings({
		task,
		userId: user?.id,
		taskUserSettingsCollection,
		tasksCollection,
		api: { tasks: client.tasks },
	})

	// Query sessions for this task (no orderBy needed - sorting handled in useMemo)
	const { data: sessionData, isReady: sessionsReady } = useLiveQuery(
		(q) => q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.task_id, taskId)),
		[sessionsCollection, taskId],
	)

	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	// Keep active sessions before archived sessions, then sort each group by activity.
	const sessions: TableSession[] = useMemo(() => {
		if (!sessionsReady || !sessionData) return []
		return [...sessionData]
			.sort((a, b) => {
				// Primary: archived ASC (non-archived first)
				if (a.archived !== b.archived) return a.archived ? 1 : -1
				return compareSessionsByActivityMinute(a, b)
			})
			.map((s) => ({
				...toTableSession(s),
				taskName: task?.name,
				isUnread: unreadSessionIds.has(s.id),
			}))
	}, [sessionData, task?.name, sessionsReady, unreadSessionIds])

	// Sidebar-tab availability flag for the artifact panel; the sidebar itself
	// re-derives the full data with useTaskWorkflowInfo.
	const hasWorkflowGraph = useMemo(
		() => getWorkflowPhases(task?.workflow_type ?? null, task?.worktree_timing ?? null).length > 0,
		[task?.workflow_type, task?.worktree_timing],
	)
	// Resolve terminal working directory based on ownership:
	// - Owner: use task.default_working_directory
	// - Non-owner: use task_user_settings.working_directory (requires prior session creation)
	const resolvedWorkingDirectory = useMemo(() => {
		if (isTaskOwner) {
			return task?.default_working_directory ?? null
		}
		// Non-owner: only use the working directory from their task_user_settings
		return userWorkingDirectory
	}, [isTaskOwner, task?.default_working_directory, userWorkingDirectory])
	const workspaceSetup = useTaskWorkspaceSetup(
		taskId,
		userHostId,
		task?.workspace_spec?.setupBlocksFirstSession ?? false,
	)

	return {
		task,
		isTaskReady,
		isTaskLoading,
		userId: user?.id,
		isOwner,
		canEditTask,
		canCreateSession,
		isTaskOwner,
		userHostId,
		userWorkspaceBaseDirectory,
		hasUserSettings,
		resolvedWorkingDirectory,
		sessions,
		hasWorkflowGraph,
		workspaceSetup,
	}
}

export type TaskDetailTask = NonNullable<ReturnType<typeof useTaskDetailData>['task']>
