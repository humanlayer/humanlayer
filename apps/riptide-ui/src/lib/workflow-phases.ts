import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import type { WorkflowPhase } from '@humanlayer/ui/components/workflow-graph'

const WORKFLOW_PHASE_MAP: Record<TaskWorkflowType, WorkflowPhase[]> = {
	rpi: [
		{ name: 'rpi:research-questions', title: 'questions' },
		{ name: 'rpi:research', title: 'research' },
		{ name: 'rpi:design', title: 'design' },
		{ name: 'rpi:structure', title: 'outline' },
		{ name: 'rpi:plan', title: 'plan' },
		{ name: 'rpi:implementation', title: 'implement' },
		{ name: 'rpi:describe-pr', title: 'PR' },
	],
	outline_only: [
		{ name: 'rpi:research-questions', title: 'questions' },
		{ name: 'rpi:research', title: 'research' },
		{ name: 'rpi:design', title: 'design' },
		{ name: 'rpi:structure', title: 'outline' },
		{ name: 'rpi:implementation', title: 'implement' },
		{ name: 'rpi:describe-pr', title: 'PR' },
	],
	prd_tdd: [
		{ name: 'rpi:research-questions', title: 'questions' },
		{ name: 'rpi:research', title: 'research' },
		{ name: 'rpi:design-prd', title: 'PRD' },
		{ name: 'rpi:design-tdd', title: 'TDD' },
		{ name: 'rpi:structure', title: 'outline' },
		{ name: 'rpi:implementation', title: 'implement' },
		{ name: 'rpi:describe-pr', title: 'PR' },
	],
	oneshot: [
		{ name: 'rpi:implementation', title: 'implement' },
		{ name: 'rpi:describe-pr', title: 'PR' },
	],
	freeform: [],
}

const WORKTREE_PHASE: WorkflowPhase = { name: 'rpi:worktree-setup', title: 'worktree' }
const SYNTHETIC_WORKTREE_PHASE: WorkflowPhase = {
	name: 'worktree-setup',
	title: 'worktree',
	synthetic: true,
}

export function getWorkflowPhases(
	workflowType: TaskWorkflowType | null,
	worktreeTiming: WorktreeTiming | null,
): WorkflowPhase[] {
	if (!workflowType) return []

	const basePhases = WORKFLOW_PHASE_MAP[workflowType] ?? []
	if (basePhases.length === 0) return []
	const effectiveWorktreeTiming = worktreeTiming ?? 'later'

	if (effectiveWorktreeTiming === 'now') {
		return [SYNTHETIC_WORKTREE_PHASE, ...basePhases]
	}

	if (effectiveWorktreeTiming === 'later' && workflowType !== 'oneshot') {
		const implementationIndex = basePhases.findIndex((phase) => phase.name === 'rpi:implementation')
		if (implementationIndex === -1) return basePhases

		return [...basePhases.slice(0, implementationIndex), WORKTREE_PHASE, ...basePhases.slice(implementationIndex)]
	}

	return basePhases
}
