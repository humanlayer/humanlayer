import type { TaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration'
import { describe, expect, test } from 'vitest'

import { getWorkflowRoutingContext } from './workflow-routing-hook'

describe('getWorkflowRoutingContext', () => {
	const workflowTypes: Array<TaskWorkflowType | null> = [
		'rpi',
		'oneshot',
		'outline_only',
		'prd_tdd',
		'freeform',
		null,
	]

	describe('structure-outline routing is workflow-type-independent', () => {
		for (const skillName of ['rpi:create-structure-outline', 'rpi:iterate-structure-outline']) {
			describe(skillName, () => {
				for (const workflowType of workflowTypes) {
					test(`${workflowType} + later → setup-worktree`, () => {
						const context = getWorkflowRoutingContext(workflowType, 'later', skillName)
						expect(context).toContain('/rpi:setup-worktree')
						expect(context).not.toContain('/rpi:create-plan')
					})

					test(`${workflowType} + null timing falls back to setup-worktree`, () => {
						const context = getWorkflowRoutingContext(workflowType, null, skillName)
						expect(context).toContain('/rpi:setup-worktree')
						expect(context).not.toContain('/rpi:create-plan')
					})

					test(`${workflowType} + now → implement-outline`, () => {
						const context = getWorkflowRoutingContext(workflowType, 'now', skillName)
						expect(context).toContain('/rpi:implement-outline')
						expect(context).not.toContain('/rpi:create-plan')
					})

					test(`${workflowType} + never → implement-outline`, () => {
						const context = getWorkflowRoutingContext(workflowType, 'never', skillName)
						expect(context).toContain('/rpi:implement-outline')
						expect(context).not.toContain('/rpi:create-plan')
					})
				}
			})
		}
	})

	describe('sessions already in a worktree never get a worktree suggestion', () => {
		for (const skillName of ['rpi:create-structure-outline', 'rpi:iterate-structure-outline']) {
			for (const timing of ['later', null] as const) {
				test(`${skillName} + ${timing} + in worktree → implement-outline`, () => {
					const context = getWorkflowRoutingContext(null, timing, skillName, true)
					expect(context).toContain('/rpi:implement-outline')
					expect(context).not.toContain('/rpi:setup-worktree')
				})
			}
		}

		test('rpi create-plan + later + in worktree → implement-plan', () => {
			const context = getWorkflowRoutingContext('rpi', 'later', 'rpi:create-plan', true)
			expect(context).toContain('/rpi:implement-plan')
			expect(context).not.toContain('/rpi:setup-worktree')
		})
	})

	describe('existing per-workflow_type rules still resolve', () => {
		test('rpi create-plan + now → implement-plan', () => {
			const context = getWorkflowRoutingContext('rpi', 'now', 'rpi:create-plan')
			expect(context).toContain('/rpi:implement-plan')
		})

		test('rpi create-plan + later → null (no override)', () => {
			expect(getWorkflowRoutingContext('rpi', 'later', 'rpi:create-plan')).toBeNull()
		})

		test('prd_tdd create-research → create-prd', () => {
			const context = getWorkflowRoutingContext('prd_tdd', 'later', 'rpi:create-research')
			expect(context).toContain('/rpi:create-prd')
		})
	})

	describe('non-matching inputs return null', () => {
		test('null skillName returns null', () => {
			expect(getWorkflowRoutingContext('rpi', 'later', null)).toBeNull()
		})

		test('unknown skill returns null', () => {
			expect(getWorkflowRoutingContext('rpi', 'later', 'rpi:describe-pr')).toBeNull()
		})
	})
})
