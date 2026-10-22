import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { queryOptions, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { createWorkspaceSetupActions } from '@/actions/workspace-setup'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useRiptideApi } from '@/orpc/client'

export type WorkspaceStatus = RiptideApiOutputs['projectWorkspaces']['getStatus']
export type SetupRepository = WorkspaceStatus['materializations'][number]['repositories'][number]

/** Task setup mutations clear errors optimistically and wait for the synced transaction, as in the main UI. */
export function useTaskSetupActions() {
	const { taskWorkspaceSetupForHostCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	return useMemo(
		() =>
			createWorkspaceSetupActions(
				taskWorkspaceSetupForHostCollection,
				client.workspaceSetup,
				confirmTx.workspaceSetup,
			),
		[taskWorkspaceSetupForHostCollection, client.workspaceSetup, confirmTx.workspaceSetup],
	)
}

/**
 * The first repository whose setup failed, the first still being set up, and
 * whether setup has settled: every repository done, or one failed.
 */
export function readSetup(status: WorkspaceStatus | undefined): {
	failed: SetupRepository | undefined
	working: SetupRepository | undefined
	settled: boolean
} {
	const repositories = status?.materializations.flatMap((entry) => entry.repositories) ?? []
	const failed = repositories.find((repository) => repository.status.error)
	const working = repositories.find((repository) => repository.status.status !== 'done')
	return { failed, working, settled: repositories.length > 0 && (Boolean(failed) || !working) }
}

/** Polls while the host works, and stops once setup settles or the task turns out to have no workspace. */
function useSetupOptions() {
	const { queryClient: orpc } = useRiptideApi()
	return (taskId: string) =>
		queryOptions({
			...orpc.projectWorkspaces.getStatus.queryOptions({ input: { taskId }, context: { silent: true } }),
			retry: false,
			refetchInterval: (query) => (query.state.error || readSetup(query.state.data).settled ? false : 1_000),
		})
}

/**
 * A project task's workspace setup, for the card that stands in for the first turn.
 * `unknown` means the status couldn't be read, so polling stopped; `check` reads it again.
 */
export function useWorkspaceSetup(taskId: string) {
	const options = useSetupOptions()(taskId)
	const { data, isError, isFetching, refetch } = useQuery(options)
	return {
		...readSetup(data),
		unknown: isError && !data,
		checking: isFetching,
		check: () => void refetch(),
		queryKey: options.queryKey,
	}
}

/**
 * Which of these tasks' workspaces failed to set up. Their sessions still read
 * "waiting for workspace", but nothing will happen until someone retries.
 */
export function useFailedSetups(taskIds: readonly string[]): ReadonlySet<string> {
	const options = useSetupOptions()
	const results = useQueries({ queries: taskIds.map((taskId) => options(taskId)) })
	// A string key keeps the set stable between polls, so the task tree only recomputes when it changes.
	const key = taskIds.filter((_, index) => readSetup(results[index]?.data).failed).join(',')
	return useMemo(() => new Set(key ? key.split(',') : []), [key])
}
