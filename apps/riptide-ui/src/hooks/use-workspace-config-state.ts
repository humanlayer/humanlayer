/**
 * use-workspace-config-state.ts
 *
 * Workspace config state for the V2 new-task form, modelled without effects:
 *   - useWorkspaceConfigLoadState — React Query load of .humanlayer/workspace.json
 *     for the selected directory. Replaces the previous useEffect + store sync;
 *     the query handles caching and cancellation (no stale-response races when
 *     the directory changes mid-load), and dedupes across consuming components.
 *   - useWorkspaceRepoSelection — repo exclusions derived from persisted
 *     per-directory preferences. Toggling writes straight back to preferences,
 *     so the derived set recomputes (no store mirror, no init effect).
 *   - usePrimaryRepoOverride — per-task primary-repo override scoped to the
 *     selected directory, so it resets implicitly when the directory changes.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { useEffectiveHost } from '@/hooks/use-effective-host'
import { readWorkspaceConfig } from '@/integrations/desktop/workspace-config'
import { buildDirectoryPreferenceKey } from '@/lib/task-workspace-preferences'
import { isElectron, isTauri } from '@/lib/utils'
import { readWorkspaceConfigLoadState, type WorkspaceConfigLoadState } from '@/lib/workspace-config'

const WORKSPACE_CONFIG_QUERY_KEY = 'workspace-config-load-state'

/** Stable reference for the pending state, so consumers don't see a new object each render. */
const LOADING_STATE: WorkspaceConfigLoadState = { status: 'loading' }

/** Stable React Query key for a directory's workspace config load state. */
export function workspaceConfigQueryKey(directory: string) {
	return [WORKSPACE_CONFIG_QUERY_KEY, directory] as const
}

function sameRepoLocalPaths(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false
	const leftSet = new Set(left)
	return right.every((path) => leftSet.has(path))
}

/**
 * Loads the workspace config load state for the selected directory.
 * Deduped across components by query key; safe to call from each consumer.
 *
 * Callers pass their watched `directory` form value rather than this module
 * reading the store form — the store form is null until NewTaskFormV2's mount
 * effect registers it, and `useWatch` on a null control throws.
 */
export function useWorkspaceConfigLoadState(directory: string): WorkspaceConfigLoadState {
	const query = useQuery({
		queryKey: workspaceConfigQueryKey(directory),
		queryFn: async (): Promise<WorkspaceConfigLoadState> => {
			if (!directory || (!isTauri() && !isElectron())) {
				return { status: 'missing' }
			}
			try {
				return await readWorkspaceConfigLoadState(directory, readWorkspaceConfig)
			} catch (err) {
				console.error('[useWorkspaceConfigLoadState] Failed to load workspace config:', err)
				return {
					status: 'error',
					file: 'workspace.json',
					message: err instanceof Error ? err.message : 'Failed to load workspace config',
				}
			}
		},
	})

	return query.data ?? LOADING_STATE
}

/** Returns an invalidator for the workspace config query (manual refresh / post-write reload). */
export function useInvalidateWorkspaceConfig(): () => Promise<void> {
	const queryClient = useQueryClient()
	return () => queryClient.invalidateQueries({ queryKey: [WORKSPACE_CONFIG_QUERY_KEY] })
}

/**
 * Effective repo exclusions for the loaded config, derived from persisted
 * per-directory preferences. Toggling writes back to the preferences store.
 * Takes the caller's watched `directory` (see useWorkspaceConfigLoadState).
 */
export function useWorkspaceRepoSelection(loadState: WorkspaceConfigLoadState, directory: string) {
	const { hostId } = useEffectiveHost()

	const prefsKey = hostId && directory ? buildDirectoryPreferenceKey(hostId, directory) : null
	const storedExclusions = useWorkspacePreferencesStore((s) =>
		prefsKey ? s.directoryAxisPreferencesByKey[prefsKey]?.repoExclusions : undefined,
	)
	const setDirectoryAxisPreferences = useWorkspacePreferencesStore((s) => s.setDirectoryAxisPreferences)

	const repoLocalPaths = useMemo(
		() => (loadState.status === 'ready' ? loadState.config.repos.map((repo) => repo.localPath) : []),
		[loadState],
	)

	const excludedLocalPaths = useMemo(() => {
		if (
			loadState.status === 'ready' &&
			storedExclusions &&
			sameRepoLocalPaths(storedExclusions.repoLocalPaths, repoLocalPaths)
		) {
			return new Set(storedExclusions.excludedLocalPaths.filter((path) => repoLocalPaths.includes(path)))
		}
		return new Set<string>()
	}, [loadState.status, storedExclusions, repoLocalPaths])

	const persistExclusions = (next: Set<string>) => {
		if (loadState.status !== 'ready' || !hostId || !directory) return
		setDirectoryAxisPreferences(hostId, directory, {
			repoExclusions: { repoLocalPaths, excludedLocalPaths: Array.from(next) },
		})
	}

	const toggleRepo = (localPath: string) => {
		const next = new Set(excludedLocalPaths)
		if (next.has(localPath)) next.delete(localPath)
		else next.add(localPath)
		persistExclusions(next)
	}

	const setAllSelected = (selected: boolean) => {
		persistExclusions(selected ? new Set<string>() : new Set(repoLocalPaths))
	}

	return { excludedLocalPaths, toggleRepo, setAllSelected }
}

/**
 * Per-task primary-repo override, scoped to the selected directory so it resets
 * implicitly when the directory changes (no reset effect needed).
 */
export function usePrimaryRepoOverride(directory: string) {
	const override = useNewTaskFormStore((s) => s.primaryRepoOverride)
	const setOverride = useNewTaskFormStore((s) => s.setPrimaryRepoOverride)

	const primaryLocalPath = override && override.directory === directory ? override.localPath : null
	const setPrimaryLocalPath = (localPath: string) => setOverride(directory, localPath)

	return { primaryLocalPath, setPrimaryLocalPath }
}
