import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { TaskRepositorySourceSetupDialogWired } from '@/components/RepositorySourceSetupDialog'
import { isRepositorySourcesRequiredError, missingRepositorySources } from '@/lib/repository-sources'
import { useRiptideApi } from '@/orpc/client'

interface GuardedTaskLaunch {
	readonly taskId: string
	readonly hostId: string
	readonly launch: () => Promise<void>
}

type PendingTaskLaunch = GuardedTaskLaunch & {
	readonly repositories: Parameters<typeof TaskRepositorySourceSetupDialogWired>[0]['repositories']
}

/**
 * Preflights an existing task against its immutable workspace snapshot and retains the exact
 * validated launch callback until source preferences have been saved. The save event retries
 * directly; no effect observes mutation state.
 */
export function useRepositorySourceLaunchGuard() {
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const [pending, setPending] = useState<PendingTaskLaunch | null>(null)

	const requireSources = useCallback(
		async (launch: GuardedTaskLaunch): Promise<boolean> => {
			const options = api.projectWorkspaces.repositorySources.get.queryOptions({
				input: { taskId: launch.taskId, hostId: launch.hostId },
			})
			const result = await queryClient.fetchQuery(options)
			if (result.placementExists || missingRepositorySources(result.sources).length === 0) return false
			setPending({ ...launch, repositories: result.repositories })
			return true
		},
		[api.projectWorkspaces.repositorySources.get, queryClient],
	)

	const run = useCallback(
		async (launch: GuardedTaskLaunch) => {
			try {
				if (await requireSources(launch)) return
			} catch {
				// Creation repeats the check authoritatively. Do not block on a transient preflight read.
			}
			try {
				await launch.launch()
			} catch (error) {
				if (!isRepositorySourcesRequiredError(error)) throw error
				// The authoritative guard won a race with preflight. Re-read the immutable workspace
				// membership so the recovery dialog contains the exact repositories creation checked.
				if (!(await requireSources(launch))) {
					// Another launch may have inserted the placement while we re-read. In that case no
					// prompt is needed, but this launch still needs to be submitted.
					await launch.launch()
				}
			}
		},
		[requireSources],
	)

	const repositorySourceSetupDialog = pending ? (
		<TaskRepositorySourceSetupDialogWired
			key={`${pending.taskId}:${pending.hostId}`}
			taskId={pending.taskId}
			repositories={pending.repositories}
			hostId={pending.hostId}
			onCancel={() => setPending(null)}
			onSaved={async () => {
				const launch = pending
				setPending(null)
				await run(launch)
			}}
		/>
	) : null

	return { guardProjectSessionLaunch: run, repositorySourceSetupDialog }
}
