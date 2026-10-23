import { describe, expect, test } from 'vitest'

import { isTaskEligible, isTaskEligibleForBoard, matchesTaskScope, type TaskScope } from './taskScope'

const ME = 'user-me'
const THEM = 'user-them'

function scope(overrides: Partial<TaskScope> = {}): TaskScope {
	return { mode: 'everything', selectedUserIds: [], currentUserId: ME, ...overrides }
}

function task(
	overrides: Partial<{ archived: boolean; is_draft: boolean; resource_owner_user_id: string | null }> = {},
) {
	return { archived: false, is_draft: false, resource_owner_user_id: ME, ...overrides }
}

describe('isTaskEligible', () => {
	const cases: Array<[string, ReturnType<typeof task>, TaskScope, boolean]> = [
		['active non-draft owned by me', task(), scope(), true],
		['active non-draft owned by a teammate', task({ resource_owner_user_id: THEM }), scope(), true],
		['archived task', task({ archived: true }), scope(), false],
		['archived draft of mine', task({ archived: true, is_draft: true }), scope(), false],
		['my own draft', task({ is_draft: true }), scope(), true],
		['my own draft under Mine', task({ is_draft: true }), scope({ mode: 'mine' }), true],
		["a teammate's draft", task({ is_draft: true, resource_owner_user_id: THEM }), scope(), false],
		[
			"a teammate's draft with that teammate selected",
			task({ is_draft: true, resource_owner_user_id: THEM }),
			scope({ selectedUserIds: [THEM] }),
			false,
		],
		[
			"a teammate's draft under Mine",
			task({ is_draft: true, resource_owner_user_id: THEM }),
			scope({ mode: 'mine' }),
			false,
		],
		['any draft with no authenticated user', task({ is_draft: true }), scope({ currentUserId: null }), false],
	]

	for (const [name, candidate, taskScope, expected] of cases) {
		test(`${name} -> ${expected}`, () => {
			expect(isTaskEligible(candidate, taskScope)).toBe(expected)
		})
	}

	test('treats a null is_draft as a non-draft', () => {
		expect(isTaskEligible({ archived: false, is_draft: null, resource_owner_user_id: THEM }, scope())).toBe(true)
	})
})

describe('isTaskEligibleForBoard', () => {
	test('keeps launched tasks and excludes owned drafts in every board mode', () => {
		expect(isTaskEligibleForBoard(task(), scope())).toBe(true)
		expect(isTaskEligibleForBoard(task({ resource_owner_user_id: THEM }), scope())).toBe(true)
		expect(isTaskEligibleForBoard(task({ is_draft: true }), scope())).toBe(false)
		expect(isTaskEligibleForBoard(task({ is_draft: true }), scope({ mode: 'mine' }))).toBe(false)
	})

	test('continues to exclude archived tasks', () => {
		expect(isTaskEligibleForBoard(task({ archived: true }), scope())).toBe(false)
	})
})

describe('matchesTaskScope', () => {
	const cases: Array<[string, ReturnType<typeof task>, Array<string | null>, TaskScope, boolean]> = [
		['Everything with no owners keeps my task', task(), [], scope(), true],
		['Everything with no owners keeps a teammate task', task({ resource_owner_user_id: THEM }), [], scope(), true],
		['Everything with owners keeps a selected owner', task(), [], scope({ selectedUserIds: [ME] }), true],
		[
			'Everything with owners drops an unselected owner',
			task({ resource_owner_user_id: THEM }),
			[],
			scope({ selectedUserIds: [ME] }),
			false,
		],
		[
			'Everything with owners drops an unowned task',
			task({ resource_owner_user_id: null }),
			[],
			scope({ selectedUserIds: [ME] }),
			false,
		],
		['Mine keeps a task I own', task(), [], scope({ mode: 'mine' }), true],
		[
			'Mine keeps a teammate task where I created a session',
			task({ resource_owner_user_id: THEM }),
			[THEM, ME],
			scope({ mode: 'mine' }),
			true,
		],
		[
			'Mine drops a teammate task with no session of mine',
			task({ resource_owner_user_id: THEM }),
			[THEM, null],
			scope({ mode: 'mine' }),
			false,
		],
		[
			'Mine with no authenticated user keeps nothing',
			task(),
			[ME],
			scope({ mode: 'mine', currentUserId: null }),
			false,
		],
	]

	for (const [name, candidate, creators, taskScope, expected] of cases) {
		test(`${name} -> ${expected}`, () => {
			expect(matchesTaskScope(candidate, creators, taskScope)).toBe(expected)
		})
	}

	test('Everything ignores selected owners while under Mine', () => {
		const mine = scope({ mode: 'mine', selectedUserIds: [THEM] })
		expect(matchesTaskScope(task({ resource_owner_user_id: THEM }), [], mine)).toBe(false)
	})
})
