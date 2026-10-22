import { describe, expect, test } from 'vitest'

import { getVisibleAutoAdvanceToggles } from './workflow-auto-advance'

describe('getVisibleAutoAdvanceToggles', () => {
	test('rpi + later shows plan, worktree, and PR toggles', () => {
		expect([...getVisibleAutoAdvanceToggles('rpi', 'later')]).toEqual([
			'auto_advance_implementation_to_pr',
			'auto_advance_plan_to_worktree',
			'auto_advance_worktree_to_implementation',
		])
	})

	test('rpi + null timing behaves like later', () => {
		expect([...getVisibleAutoAdvanceToggles('rpi', null)]).toEqual([
			'auto_advance_implementation_to_pr',
			'auto_advance_plan_to_worktree',
			'auto_advance_worktree_to_implementation',
		])
	})

	test('rpi + now shows plan auto-advance but hides worktree-session toggle', () => {
		expect([...getVisibleAutoAdvanceToggles('rpi', 'now')]).toEqual([
			'auto_advance_implementation_to_pr',
			'auto_advance_plan_to_worktree',
		])
	})

	test('outline_only + later hides plan to worktree but shows worktree to implementation', () => {
		expect([...getVisibleAutoAdvanceToggles('outline_only', 'later')]).toEqual([
			'auto_advance_implementation_to_pr',
			'auto_advance_worktree_to_implementation',
		])
	})

	test('prd_tdd + later hides plan to worktree but shows worktree to implementation', () => {
		expect([...getVisibleAutoAdvanceToggles('prd_tdd', 'later')]).toEqual([
			'auto_advance_implementation_to_pr',
			'auto_advance_worktree_to_implementation',
		])
	})

	test('oneshot only shows implementation to PR', () => {
		expect([...getVisibleAutoAdvanceToggles('oneshot', 'later')]).toEqual(['auto_advance_implementation_to_pr'])
	})

	test('null workflow hides workflow-specific toggles', () => {
		expect([...getVisibleAutoAdvanceToggles(null, 'later')]).toEqual([])
	})
})
