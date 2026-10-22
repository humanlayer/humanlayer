import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { buildDirectoryPreferenceKey, type DirectoryAxisPreferences } from '@/lib/task-workspace-preferences'
import type { LauncherRepositorySelectionPreference } from '@/modules/launcher-v3/launcher-v3-workspace'

interface WorkspacePreferencesState {
	largeWorkspaceAlwaysAllow: boolean
	directoryAxisPreferencesByKey: Record<string, DirectoryAxisPreferences>
	launcherRepositorySelectionsByKey: Record<string, LauncherRepositorySelectionPreference>
	setLargeWorkspaceAlwaysAllow: (value: boolean) => void
	getDirectoryAxisPreferences: (hostId: string, directory: string) => DirectoryAxisPreferences | null
	setDirectoryAxisPreferences: (hostId: string, directory: string, prefs: Partial<DirectoryAxisPreferences>) => void
	setLauncherRepositorySelection: (
		hostId: string,
		directory: string,
		selection: LauncherRepositorySelectionPreference,
	) => void
}

export const useWorkspacePreferencesStore = create<WorkspacePreferencesState>()(
	persist(
		(set, get) => ({
			largeWorkspaceAlwaysAllow: false,
			directoryAxisPreferencesByKey: {},
			launcherRepositorySelectionsByKey: {},
			setLargeWorkspaceAlwaysAllow: (value) => set({ largeWorkspaceAlwaysAllow: value }),
			getDirectoryAxisPreferences: (hostId, directory) => {
				if (!hostId || !directory) return null
				return get().directoryAxisPreferencesByKey[buildDirectoryPreferenceKey(hostId, directory)] ?? null
			},
			setDirectoryAxisPreferences: (hostId, directory, prefs) => {
				if (!hostId || !directory) return
				const key = buildDirectoryPreferenceKey(hostId, directory)
				set((state) => {
					const merged = { ...state.directoryAxisPreferencesByKey[key], ...prefs }
					// A stored entry must carry all three axes. The create paths always supply them, and the
					// repo-exclusions update path always targets an already-configured (complete) entry — so
					// skip writing rather than persist a corrupt partial.
					const { issueSource, workflow, workspaceTiming } = merged
					if (issueSource === undefined || workflow === undefined || workspaceTiming === undefined) {
						return state
					}
					return {
						directoryAxisPreferencesByKey: {
							...state.directoryAxisPreferencesByKey,
							[key]: { ...merged, issueSource, workflow, workspaceTiming },
						},
					}
				})
			},
			setLauncherRepositorySelection: (hostId, directory, selection) => {
				if (!hostId || !directory) return
				const key = buildDirectoryPreferenceKey(hostId, directory)
				set((state) => ({
					launcherRepositorySelectionsByKey: {
						...state.launcherRepositorySelectionsByKey,
						[key]: selection,
					},
				}))
			},
		}),
		{
			name: 'riptide-workspace-preferences',
			version: 3,
			migrate: (persistedState, version) => {
				// Version 2 adds optional repoExclusions field to DirectoryAxisPreferences
				// No transformation needed since the field is optional
				if (version < 2) {
					return persistedState
				}
				return persistedState
			},
			partialize: (state) => ({
				largeWorkspaceAlwaysAllow: state.largeWorkspaceAlwaysAllow,
				directoryAxisPreferencesByKey: state.directoryAxisPreferencesByKey,
				launcherRepositorySelectionsByKey: state.launcherRepositorySelectionsByKey,
			}),
		},
	),
)
