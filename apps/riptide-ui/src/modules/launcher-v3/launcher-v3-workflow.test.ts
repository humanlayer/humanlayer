import type { ResolvedTaskWorkflow } from '@humanlayer/schemas/effect/taskconfiguration'
import { describe, expect, it } from 'vitest'

import {
	getLauncherWorkflowAutoAdvanceEdges,
	projectTaskAutoAdvanceFlags,
	resolveTaskWorkflow,
	selectTaskWorkflow,
	workflowChoiceForResolved,
} from './launcher-v3-workflow'

describe('resolveTaskWorkflow', () => {
	it.each([
		['rpi', 'outline_only', true],
		['medium', 'outline_only', true],
		['prd-tdd', 'prd_tdd', true],
		['large', 'prd_tdd', true],
		['small', 'freeform', true],
		['exploratory', 'oneshot', false],
		['freeform', 'freeform', false],
	] as const)('resolves %s without emitting the legacy rpi value', (choice, workflowType, autoAdvance) => {
		const resolved = resolveTaskWorkflow(choice)
		expect(resolved).toEqual({ workflowType, autoAdvance })
		expect(resolved.workflowType).not.toBe('rpi')
	})

	it('maps the default resolved workflow into either presentation', () => {
		const workflow: ResolvedTaskWorkflow = { workflowType: 'outline_only', autoAdvance: true }
		expect(workflowChoiceForResolved('named', workflow)).toBe('rpi')
		expect(workflowChoiceForResolved('task-size', workflow)).toBe('medium')
	})

	it('restores the prior toggle when returning to a guided workflow', () => {
		const rpiOff: ResolvedTaskWorkflow = { workflowType: 'outline_only', autoAdvance: false }
		const prd = selectTaskWorkflow(rpiOff, 'prd-tdd', {})
		expect(prd.workflow).toEqual({ workflowType: 'prd_tdd', autoAdvance: true })

		const restored = selectTaskWorkflow(prd.workflow, 'rpi', prd.memory)
		expect(restored.workflow).toEqual(rpiOff)
	})

	it('starts Small with auto-advance on unless it was turned off, and keeps Exploratory off', () => {
		const current: ResolvedTaskWorkflow = { workflowType: 'oneshot', autoAdvance: false }
		expect(selectTaskWorkflow(current, 'small', {}).workflow).toEqual({
			workflowType: 'freeform',
			autoAdvance: true,
		})
		expect(selectTaskWorkflow(current, 'small', { freeform: false }).workflow.autoAdvance).toBe(false)
		expect(selectTaskWorkflow(current, 'exploratory', { oneshot: true }).workflow.autoAdvance).toBe(false)
		expect(workflowChoiceForResolved('task-size', { workflowType: 'freeform', autoAdvance: false })).toBe('small')
		expect(workflowChoiceForResolved('task-size', { workflowType: 'oneshot', autoAdvance: true })).toBe(
			'exploratory',
		)
	})

	it.each([true, false])('remembers Freeform auto-advance %s when switching workflows', (autoAdvance) => {
		const freeform: ResolvedTaskWorkflow = { workflowType: 'freeform', autoAdvance }
		const guided = selectTaskWorkflow(freeform, 'rpi', {})
		const restored = selectTaskWorkflow(guided.workflow, 'freeform', guided.memory)

		expect(restored.workflow).toEqual(freeform)
		expect(restored.memory.freeform).toBe(autoAdvance)
	})
})

describe('projectTaskAutoAdvanceFlags', () => {
	it.each(['now', 'later', 'never'] as const)('projects only PR for Freeform across %s timing', (timing) => {
		for (const autoAdvance of [true, false]) {
			expect(projectTaskAutoAdvanceFlags({ workflowType: 'freeform', autoAdvance }, timing)).toEqual({
				autoAdvanceQuestionsToResearch: false,
				autoAdvanceResearchToDesign: false,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: false,
				autoAdvanceImplementationToPr: autoAdvance,
			})
		}
	})

	it.each([
		[
			'RPI now',
			{ workflowType: 'outline_only', autoAdvance: true },
			'now',
			{ questions: true, design: true, worktree: false, pr: false },
		],
		[
			'RPI later',
			{ workflowType: 'outline_only', autoAdvance: true },
			'later',
			{ questions: true, design: true, worktree: true, pr: false },
		],
		[
			'PRD/TDD never',
			{ workflowType: 'prd_tdd', autoAdvance: true },
			'never',
			{ questions: true, design: true, worktree: false, pr: false },
		],
		[
			'Small',
			{ workflowType: 'oneshot', autoAdvance: true },
			'never',
			{ questions: false, design: false, worktree: false, pr: true },
		],
		[
			'Exploratory',
			{ workflowType: 'oneshot', autoAdvance: false },
			'never',
			{ questions: false, design: false, worktree: false, pr: false },
		],
		[
			'Freeform',
			{ workflowType: 'freeform', autoAdvance: false },
			'later',
			{ questions: false, design: false, worktree: false, pr: false },
		],
	] as const)('projects %s from the single toggle', (_name, workflow, timing, expected) => {
		const flags = projectTaskAutoAdvanceFlags(workflow, timing)
		expect(flags).toEqual({
			autoAdvanceQuestionsToResearch: expected.questions,
			autoAdvanceResearchToDesign: expected.design,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: expected.worktree,
			autoAdvanceImplementationToPr: expected.pr,
		})
	})

	it('turns every projected flag off when the toggle is off', () => {
		expect(
			Object.values(projectTaskAutoAdvanceFlags({ workflowType: 'prd_tdd', autoAdvance: false }, 'later')),
		).toEqual([false, false, false, false, false])
	})

	it('builds graph edges from the same projection', () => {
		expect(getLauncherWorkflowAutoAdvanceEdges({ workflowType: 'prd_tdd', autoAdvance: true }, 'later')).toEqual([
			{ fromLabel: 'rpi:research-questions', toLabel: 'rpi:research' },
			{ fromLabel: 'rpi:research', toLabel: 'rpi:design-prd' },
			{ fromLabel: 'rpi:worktree-setup', toLabel: 'rpi:implementation' },
		])
	})
})
