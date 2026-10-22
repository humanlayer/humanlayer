import { describe, expect, test } from 'vitest'

import { getWorkflowPhases } from './workflow-phases'

describe('getWorkflowPhases', () => {
	test('rpi returns 7 phases including PR', () => {
		const phases = getWorkflowPhases('rpi', 'never')

		expect(phases.map((phase) => phase.name)).toEqual([
			'rpi:research-questions',
			'rpi:research',
			'rpi:design',
			'rpi:structure',
			'rpi:plan',
			'rpi:implementation',
			'rpi:describe-pr',
		])
	})

	test('outline_only returns 6 phases with no plan phase and PR', () => {
		const phases = getWorkflowPhases('outline_only', 'never')

		expect(phases).toHaveLength(6)
		expect(phases.map((phase) => phase.name)).toEqual([
			'rpi:research-questions',
			'rpi:research',
			'rpi:design',
			'rpi:structure',
			'rpi:implementation',
			'rpi:describe-pr',
		])
		expect(phases.some((phase) => phase.name === 'rpi:plan')).toBe(false)
	})

	test('prd_tdd returns 7 phases with PRD, TDD, and PR phases', () => {
		const phases = getWorkflowPhases('prd_tdd', 'never')

		expect(phases.map((phase) => phase.title)).toEqual([
			'questions',
			'research',
			'PRD',
			'TDD',
			'outline',
			'implement',
			'PR',
		])
		expect(phases.map((phase) => phase.name)).toContain('rpi:design-prd')
		expect(phases.map((phase) => phase.name)).toContain('rpi:design-tdd')
	})

	test('oneshot returns implement and PR phases', () => {
		const phases = getWorkflowPhases('oneshot', null)

		expect(phases.map((phase) => phase.name)).toEqual(['rpi:implementation', 'rpi:describe-pr'])
	})

	test('oneshot timing=later does not add a deferred worktree phase', () => {
		const phases = getWorkflowPhases('oneshot', 'later')

		expect(phases.map((phase) => phase.name)).toEqual(['rpi:implementation', 'rpi:describe-pr'])
	})

	test('timing=now prepends synthetic worktree phase', () => {
		const phases = getWorkflowPhases('outline_only', 'now')

		expect(phases[0]).toEqual({ name: 'worktree-setup', title: 'worktree', synthetic: true })
		expect(phases[1]?.name).toBe('rpi:research-questions')
	})

	test('timing=later inserts worktree before implement', () => {
		const phases = getWorkflowPhases('outline_only', 'later')

		expect(phases.map((phase) => phase.name)).toEqual([
			'rpi:research-questions',
			'rpi:research',
			'rpi:design',
			'rpi:structure',
			'rpi:worktree-setup',
			'rpi:implementation',
			'rpi:describe-pr',
		])
		expect(phases.find((phase) => phase.name === 'rpi:worktree-setup')?.synthetic).toBeUndefined()
	})

	test('null timing behaves like later', () => {
		const phases = getWorkflowPhases('outline_only', null)

		expect(phases.map((phase) => phase.name)).toContain('rpi:worktree-setup')
		expect(phases.find((phase) => phase.name === 'rpi:worktree-setup')?.synthetic).toBeUndefined()
	})

	test('timing=never has no worktree phase', () => {
		const phases = getWorkflowPhases('rpi', 'never')

		expect(phases.some((phase) => phase.name.includes('worktree'))).toBe(false)
	})

	test.each(['now', 'later', 'never'] as const)('freeform has no graph phases for timing=%s', (timing) => {
		expect(getWorkflowPhases('freeform', timing)).toEqual([])
	})

	test('null workflowType returns empty array', () => {
		expect(getWorkflowPhases(null, 'later')).toEqual([])
	})
})
