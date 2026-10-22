import { queryOptions, useQueries } from '@tanstack/react-query'

import type { SidebarSessionRow } from '@/components/sidebar-task-tree/useSidebarTaskTreeQuery'
import { useRiptideApi } from '@/orpc/client'

import type { ProjectTaskInput } from './derive-project-sidebar'
import { readWorkspace, workspaceRefetchInterval } from './project-sidebar-reads'

/** Authoritative, task-scoped workspace reads; no client filesystem or host-colocation assumptions. */
export function useProjectSidebarWorkspaces(tasks: ProjectTaskInput[], sessions: SidebarSessionRow[]) {
	const { queryClient: api } = useRiptideApi()
	const workspaceTasks = tasks.filter((task) => task.workspaceId)
	const launchingTasks = new Set(
		sessions
			.filter((session) => ['ready_for_launch', 'launching', 'resuming'].includes(session.sessionStatus ?? ''))
			.map((session) => session.taskId),
	)
	const queries = useQueries({
		queries: workspaceTasks.map((task) =>
			queryOptions({
				...api.projectWorkspaces.getStatus.queryOptions({ input: { taskId: task.taskId } }),
				refetchInterval: (query) => workspaceRefetchInterval(launchingTasks.has(task.taskId), query.state.data),
			}),
		),
	})
	return {
		workspaces: new Map(workspaceTasks.map((task, index) => [task.taskId, readWorkspace(queries[index])])),
		workspaceError: queries.some((query) => query.isError),
		retryWorkspaces: () => {
			for (const query of queries) void query.refetch()
		},
	}
}
