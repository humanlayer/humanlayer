import { describe, expect, test } from 'vitest'

import { createProjectSidebarStore, moveInOrder, parseProjectSidebarOrder } from '@/hooks/stores/projectSidebarStore'

describe('local project sidebar ordering', () => {
	test('persists moves across reload and isolates users and organizations', () => {
		const store = createProjectSidebarStore('me', 'org')
		store.getState().observe([
			{ id: 'a', taskIds: ['one', 'two'] },
			{ id: 'b', taskIds: ['three'] },
		])
		store.getState().move(null, ['a', 'b'], 'a', 'b')
		store.getState().move('a', ['one', 'two'], 'one', 'two')
		expect(createProjectSidebarStore('me', 'org').getState().order).toEqual({
			projects: ['b', 'a'],
			tasks: { a: ['two', 'one'], b: ['three'] },
		})
		expect(createProjectSidebarStore('someone', 'org').getState().order.tasks).toEqual({})
		expect(createProjectSidebarStore('me', 'other-org').getState().order.tasks).toEqual({})
	})

	test('activity changes and temporary visibility loss do not reset order; new tasks are prepended', () => {
		const store = createProjectSidebarStore('me', 'org')
		store.getState().observe([{ id: 'p', taskIds: ['a', 'b'] }])
		store.getState().observe([{ id: 'p', taskIds: ['b', 'a'] }])
		store.getState().observe([])
		store.getState().observe([{ id: 'p', taskIds: ['new', 'b'] }])
		expect(store.getState().order.tasks.p).toEqual(['new', 'a', 'b'])
		store.getState().archive(['a'])
		expect(store.getState().order.tasks.p).toEqual(['new', 'b'])
	})

	test('only reorders visible slots and refuses cross-group IDs', () => {
		expect(moveInOrder(['a', 'hidden', 'b'], ['a', 'b'], 'a', 'b')).toEqual(['b', 'hidden', 'a'])
		expect(moveInOrder(['a', 'b'], ['a', 'b'], 'foreign', 'a')).toEqual(['a', 'b'])
	})

	test('sanitizes malformed and duplicate storage; retains stale IDs until archival is known', () => {
		expect(
			parseProjectSidebarOrder({ projects: ['a', 3, 'a'], tasks: { p: ['stale', null, 'stale'], bad: false } }),
		).toEqual({ projects: ['a'], tasks: { p: ['stale'], bad: [] } })
		localStorage.setItem('project-sidebar:v1:org:me', 'not json')
		expect(createProjectSidebarStore('me', 'org').getState().order).toEqual({ projects: [], tasks: {} })
	})
})
