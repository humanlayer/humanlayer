import { useQuery } from '@tanstack/react-query'

import { deriveProjectWorkspaceLaunchState, type ProjectWorkspaceLaunchState } from '@/lib/project-workspace-launch'
import { useRiptideApi } from '@/orpc/client'

/**
 * Repository sources for a project-backed task on one host, as the session launcher
 * needs them. None of the project workspace tables sync through Electric, so this is a
 * query; `TaskRepositorySourceSetupDialogWired` invalidates it when sources are saved.
 * Returns null when the task is not project-backed or no host is selected.
 */
export function useProjectWorkspaceLaunch(input: {
	readonly taskId: string | null
	readonly workspaceId: string | null
	readonly hostId: string
}): ProjectWorkspaceLaunchState | null {
	const { queryClient: api } = useRiptideApi()
	const enabled = input.taskId !== null && input.workspaceId !== null && input.hostId !== ''
	const query = useQuery({
		...api.projectWorkspaces.repositorySources.get.queryOptions({
			input: { taskId: input.taskId ?? '', hostId: input.hostId },
		}),
		enabled,
	})
	if (!enabled) return null
	return deriveProjectWorkspaceLaunchState({ data: query.data, error: query.error })
}
