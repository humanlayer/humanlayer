import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { SidebarSessionRow } from '@/components/sidebar-task-tree/useSidebarTaskTreeQuery'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useStandaloneSessions } from '@/hooks/useStandaloneSessions'
import { useRiptideApi } from '@/orpc/client'
import { projectsV2ListQuery } from '@/queries/projects-v2'

import { selectProjectSidebarTasks } from './derive-project-sidebar'
import { readProjectMetadata } from './project-sidebar-reads'
import { useProjectSidebarWorkspaces } from './useProjectSidebarWorkspaces'

export function useProjectSidebarData(userId: string) {
	const { queryClient: api } = useRiptideApi()
	const { tasksCollection, sessionsCollection, taskWorkspaceSetupForHostCollection } = useSync()
	// Deliberately uncapped and independent of board scope. This includes historical session creators.
	const taskQuery = useLiveQuery((q) => q.from({ task: tasksCollection }), [tasksCollection])
	const sessionQuery = useLiveQuery((q) => q.from({ session: sessionsCollection }), [sessionsCollection])
	const setupQuery = useLiveQuery(
		(q) => q.from({ setup: taskWorkspaceSetupForHostCollection }),
		[taskWorkspaceSetupForHostCollection],
	)
	const projectsQuery = useQuery(projectsV2ListQuery(api))
	const archivedProjectsQuery = useQuery({
		...api.projects.v2.list.queryOptions({ input: { archived: true } }),
		queryKey: ['projects', 'v2', 'archived'],
	})
	const unread = useUnreadStore((state) => state.unreadSessionIds)
	const standalone = useStandaloneSessions({ userId, limit: 5 })
	const tasks = useMemo(
		() => selectProjectSidebarTasks(taskQuery.data ?? [], sessionQuery.data ?? [], userId),
		[taskQuery.data, sessionQuery.data, userId],
	)
	const sessions: SidebarSessionRow[] = (sessionQuery.data ?? [])
		.filter((session) => !session.archived && session.status !== 'draft')
		.map((session) => ({
			sessionId: session.id,
			taskId: session.task_id,
			ownerUserId: session.resource_owner_user_id,
			hostId: session.host_id,
			sessionName: session.title,
			sessionTitle: session.summary,
			sessionStatus: session.status,
			sessionCreatedAt: session.created_at,
			sessionLastActivityAt: session.last_activity_at,
			messageCount: session.num_events,
			labels: session.labels,
		}))
	const { workspaces, workspaceError, retryWorkspaces } = useProjectSidebarWorkspaces(tasks, sessions)
	const metadata = readProjectMetadata(projectsQuery, archivedProjectsQuery)
	return {
		tasks,
		sessions,
		workspaces,
		unread,
		projects: metadata.projects,
		projectsState: metadata.projectsState,
		standaloneSessions: standalone.sessions,
		legacySetup: new Set(
			(setupQuery.data ?? [])
				.filter((setup) => setup.status !== 'done' && !setup.error)
				.map((setup) => `${setup.task_id}:${setup.host_id}`),
		),
		isReady: taskQuery.isReady && sessionQuery.isReady && setupQuery.isReady && standalone.isReady,
		error: metadata.error ?? (taskQuery.isError || sessionQuery.isError || setupQuery.isError),
		workspaceError,
		retry: () => {
			void projectsQuery.refetch()
			void archivedProjectsQuery.refetch()
			retryWorkspaces()
		},
	}
}
