import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { useWorkspacePreferencesStore } from '@/hooks/stores/workspacePreferencesStore'
import { buildDirectoryPreferenceKey } from '@/lib/task-workspace-preferences'

describe('workspacePreferencesStore', () => {
	beforeEach(() => {
		useWorkspacePreferencesStore.setState({
			largeWorkspaceAlwaysAllow: false,
			directoryAxisPreferencesByKey: {},
		})
	})

	afterEach(() => {
		useWorkspacePreferencesStore.setState({
			largeWorkspaceAlwaysAllow: false,
			directoryAxisPreferencesByKey: {},
		})
	})

	test('sets large workspace always-allow preference', () => {
		useWorkspacePreferencesStore.getState().setLargeWorkspaceAlwaysAllow(true)
		expect(useWorkspacePreferencesStore.getState().largeWorkspaceAlwaysAllow).toBe(true)

		useWorkspacePreferencesStore.getState().setLargeWorkspaceAlwaysAllow(false)
		expect(useWorkspacePreferencesStore.getState().largeWorkspaceAlwaysAllow).toBe(false)
	})

	test('stores directory axis preferences by normalized host and directory key', () => {
		const prefs = { issueSource: 'linear' as const, workflow: 'rpi' as const, workspaceTiming: 'later' as const }
		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('host-abc', '/home/user/project/', prefs)

		expect(
			useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-abc', '/home/user/project'),
		).toEqual(prefs)
	})

	test('keeps different host and directory preference pairs independent', () => {
		const prefs1 = { issueSource: 'inline' as const, workflow: 'rpi' as const, workspaceTiming: 'later' as const }
		const prefs2 = {
			issueSource: 'jira' as const,
			workflow: 'freeform' as const,
			workspaceTiming: 'never' as const,
		}

		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('host-1', '/repo/a', prefs1)
		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('host-2', '/repo/b', prefs2)

		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-1', '/repo/a')).toEqual(prefs1)
		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-2', '/repo/b')).toEqual(prefs2)
		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-1', '/repo/b')).toBeNull()
		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-2', '/repo/a')).toBeNull()
	})

	test('empty host or directory is ignored', () => {
		const prefs = { issueSource: 'inline' as const, workflow: 'rpi' as const, workspaceTiming: 'later' as const }
		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('', '/repo', prefs)
		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('host-abc', '', prefs)

		expect(useWorkspacePreferencesStore.getState().directoryAxisPreferencesByKey).toEqual({})
		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('', '/repo')).toBeNull()
		expect(useWorkspacePreferencesStore.getState().getDirectoryAxisPreferences('host-abc', '')).toBeNull()
	})

	test('uses buildDirectoryPreferenceKey for persisted map keys', () => {
		const prefs = { issueSource: 'inline' as const, workflow: 'oneshot' as const, workspaceTiming: 'now' as const }
		useWorkspacePreferencesStore.getState().setDirectoryAxisPreferences('host-abc', '/repo/', prefs)

		const key = buildDirectoryPreferenceKey('host-abc', '/repo')
		expect(useWorkspacePreferencesStore.getState().directoryAxisPreferencesByKey[key]).toEqual(prefs)
	})
})
