import { beforeEach, describe, expect, test } from 'vitest'

import {
	HORIZONTAL_TABS_STORAGE_KEY,
	MAX_HORIZONTAL_TABS,
	useHorizontalTabsStore,
} from '@/hooks/stores/horizontalTabsStore'

function resetStore() {
	localStorage.clear()
	useHorizontalTabsStore.setState({ tabs: [], selectedTabId: null, hasHydrated: true })
}

describe('horizontal tabs store', () => {
	beforeEach(resetStore)

	test('creates one implicit tab from the current location', () => {
		const tab = useHorizontalTabsStore
			.getState()
			.initializeHorizontalTabs('/tasks/task-a?artifactId=artifact-a#comment-a')

		expect(useHorizontalTabsStore.getState()).toMatchObject({
			tabs: [tab],
			selectedTabId: tab.id,
		})
		expect(tab.href).toBe('/tasks/task-a?artifactId=artifact-a#comment-a')
	})

	test('appends a new tab while retaining the current tab href', () => {
		const first = useHorizontalTabsStore.getState().initializeHorizontalTabs('/tasks/task-a')
		const second = useHorizontalTabsStore
			.getState()
			.appendAndSelectTab('/sessions?tab=tasks', '/tasks/task-a?focus=workspace')

		expect(second).not.toBeNull()
		expect(useHorizontalTabsStore.getState().tabs).toEqual([
			{ ...first, href: '/tasks/task-a?focus=workspace' },
			second,
		])
		expect(useHorizontalTabsStore.getState().selectedTabId).toBe(second?.id)
	})

	test('closes the selected tab to its immediate left neighbor', () => {
		const first = useHorizontalTabsStore.getState().initializeHorizontalTabs('/tasks/task-a')
		const second = useHorizontalTabsStore.getState().appendAndSelectTab('/sessions/session-b', '/tasks/task-a')
		const third = useHorizontalTabsStore.getState().appendAndSelectTab('/settings', '/sessions/session-b')

		expect(second).not.toBeNull()
		expect(third).not.toBeNull()
		const selected = useHorizontalTabsStore.getState().closeTab(third!.id, '/settings?section=general')

		expect(selected).toEqual({ ...second!, href: '/sessions/session-b' })
		expect(useHorizontalTabsStore.getState().tabs).toEqual([first, { ...second!, href: '/sessions/session-b' }])
		expect(useHorizontalTabsStore.getState().selectedTabId).toBe(second?.id)
	})

	test('keeps the final implicit tab open', () => {
		const onlyTab = useHorizontalTabsStore.getState().initializeHorizontalTabs('/sessions?tab=tasks')

		expect(useHorizontalTabsStore.getState().closeTab(onlyTab.id, onlyTab.href)).toBeNull()
		expect(useHorizontalTabsStore.getState().tabs).toEqual([onlyTab])
	})

	test('rejects a tenth tab', () => {
		useHorizontalTabsStore.setState({
			tabs: Array.from({ length: MAX_HORIZONTAL_TABS }, (_, index) => ({
				id: `tab-${index + 1}`,
				href: `/tasks/${index + 1}`,
			})),
			selectedTabId: 'tab-9',
		})

		expect(useHorizontalTabsStore.getState().appendAndSelectTab('/sessions?tab=tasks', '/tasks/9')).toBeNull()
	})

	test('hydrates only a valid persisted tab model', async () => {
		localStorage.setItem(
			HORIZONTAL_TABS_STORAGE_KEY,
			JSON.stringify({
				state: {
					tabs: [
						{ id: 'task-tab', href: '/tasks/task-a' },
						{ id: 'session-tab', href: '/sessions/session-b?artifactId=artifact-b#comment-b' },
					],
					selectedTabId: 'session-tab',
				},
				version: 1,
			}),
		)

		await useHorizontalTabsStore.persist.rehydrate()

		expect(useHorizontalTabsStore.getState().tabs).toEqual([
			{ id: 'task-tab', href: '/tasks/task-a' },
			{ id: 'session-tab', href: '/sessions/session-b?artifactId=artifact-b#comment-b' },
		])
		expect(useHorizontalTabsStore.getState().selectedTabId).toBe('session-tab')
	})

	test('migrates saved tabs from the renamed storage key', async () => {
		localStorage.clear()
		localStorage.setItem(
			'riptide-native-tabs',
			JSON.stringify({
				state: { tabs: [{ id: 'task-tab', href: '/tasks/task-a' }], selectedTabId: 'task-tab' },
				version: 1,
			}),
		)

		await useHorizontalTabsStore.persist.rehydrate()

		expect(useHorizontalTabsStore.getState().tabs).toEqual([{ id: 'task-tab', href: '/tasks/task-a' }])
		expect(localStorage.getItem('riptide-native-tabs')).toBeNull()
		expect(localStorage.getItem(HORIZONTAL_TABS_STORAGE_KEY)).not.toBeNull()
	})

	test('discards malformed persisted tab state', async () => {
		localStorage.setItem(
			HORIZONTAL_TABS_STORAGE_KEY,
			JSON.stringify({
				state: { tabs: [{ id: 'bad', href: 'https://example.com' }], selectedTabId: 'bad' },
				version: 1,
			}),
		)

		await useHorizontalTabsStore.persist.rehydrate()

		expect(useHorizontalTabsStore.getState().tabs).toEqual([])
		expect(useHorizontalTabsStore.getState().selectedTabId).toBeNull()
	})
})
