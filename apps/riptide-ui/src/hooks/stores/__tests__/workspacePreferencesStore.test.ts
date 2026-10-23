import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { buildDirectoryPreferenceKey } from '@/lib/task-workspace-preferences'

describe('workspacePreferencesStore launcher repository selections', () => {
	beforeEach(() => {
		localStorage.clear()
		useWorkspacePreferencesStore.setState({ launcherRepositorySelectionsByKey: {} })
	})

	it('remembers repository inclusion and the default repository by host and directory', () => {
		useWorkspacePreferencesStore.getState().setLauncherRepositorySelection('host-1', '/projects/repo/', {
			repositoryLocalPaths: ['web', 'api'],
			excludedLocalPaths: ['api'],
			defaultLaunchRepositoryLocalPath: 'web',
		})

		const key = buildDirectoryPreferenceKey('host-1', '/projects/repo')
		expect(useWorkspacePreferencesStore.getState().launcherRepositorySelectionsByKey[key]).toEqual({
			repositoryLocalPaths: ['web', 'api'],
			excludedLocalPaths: ['api'],
			defaultLaunchRepositoryLocalPath: 'web',
		})
		expect(localStorage.getItem('riptide-workspace-preferences')).toContain(key)
	})
})
