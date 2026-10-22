import type {
	ResolvedTaskWorkflow,
	ResolvedTaskWorkflowType,
	TaskAutoAdvanceFlags,
	WorktreeTiming,
} from '@humanlayer/schemas/effect/taskconfiguration'
import type { AutoAdvanceEdge } from '@humanlayer/ui/components/workflow-graph'

export type WorkflowSelectorPresentation = 'named' | 'task-size'
export type NamedWorkflowChoice = 'rpi' | 'prd-tdd' | 'freeform'
export type TaskSizeWorkflowChoice = 'small' | 'medium' | 'large' | 'exploratory'
export type WorkflowSelectorChoice = NamedWorkflowChoice | TaskSizeWorkflowChoice

export interface LauncherWorkflowOption<T extends WorkflowSelectorChoice = WorkflowSelectorChoice> {
	value: T
	label: string
	description: string
}

export const NAMED_WORKFLOW_OPTIONS: readonly LauncherWorkflowOption<NamedWorkflowChoice>[] = [
	{
		value: 'rpi',
		label: 'RPI',
		description: 'Research, design, outline, implement, and prepare the pull request',
	},
	{
		value: 'prd-tdd',
		label: 'PRD / TDD',
		description: 'Define product requirements and technical design before implementation',
	},
	{
		value: 'freeform',
		label: 'Freeform',
		description: 'Start direct work from the prompt without a guided workflow',
	},
]

export const TASK_SIZE_WORKFLOW_OPTIONS: readonly LauncherWorkflowOption<TaskSizeWorkflowChoice>[] = [
	{ value: 'small', label: 'Small', description: 'Jump to implementation and prepare a pull request' },
	{ value: 'medium', label: 'Medium', description: 'Research and outline the work before implementation' },
	{ value: 'large', label: 'Large', description: 'Define product and technical design before implementation' },
	{
		value: 'exploratory',
		label: 'Exploratory',
		description: 'Investigate directly without expecting a pull request',
	},
]

export const DEFAULT_RESOLVED_TASK_WORKFLOW: Readonly<ResolvedTaskWorkflow> = {
	workflowType: 'outline_only',
	autoAdvance: true,
}

export function resolveTaskWorkflow(choice: WorkflowSelectorChoice): ResolvedTaskWorkflow {
	switch (choice) {
		case 'rpi':
		case 'medium':
			return { workflowType: 'outline_only', autoAdvance: true }
		case 'prd-tdd':
		case 'large':
			return { workflowType: 'prd_tdd', autoAdvance: true }
		case 'small':
			return { workflowType: 'freeform', autoAdvance: true }
		case 'exploratory':
			return { workflowType: 'oneshot', autoAdvance: false }
		case 'freeform':
			return { workflowType: 'freeform', autoAdvance: false }
	}
}

export function workflowChoiceForResolved(
	presentation: WorkflowSelectorPresentation,
	workflow: ResolvedTaskWorkflow,
): WorkflowSelectorChoice {
	if (presentation === 'task-size') {
		switch (workflow.workflowType) {
			case 'outline_only':
				return 'medium'
			case 'prd_tdd':
				return 'large'
			case 'oneshot':
				return 'exploratory'
			case 'freeform':
				return 'small'
		}
	}

	switch (workflow.workflowType) {
		case 'outline_only':
			return 'rpi'
		case 'prd_tdd':
			return 'prd-tdd'
		case 'oneshot':
		case 'freeform':
			return 'freeform'
	}
}

export function workflowLabel(workflow: ResolvedTaskWorkflow): string {
	switch (workflow.workflowType) {
		case 'outline_only':
			return 'RPI'
		case 'prd_tdd':
			return 'PRD / TDD'
		case 'oneshot':
			return workflow.autoAdvance ? 'Small' : 'Exploratory'
		case 'freeform':
			return 'Freeform'
	}
}

export type WorkflowAutoAdvanceMemory = Partial<Record<ResolvedTaskWorkflowType, boolean>>

export function selectTaskWorkflow(
	current: ResolvedTaskWorkflow,
	choice: WorkflowSelectorChoice,
	memory: WorkflowAutoAdvanceMemory,
): { workflow: ResolvedTaskWorkflow; memory: WorkflowAutoAdvanceMemory } {
	const resolved = resolveTaskWorkflow(choice)
	const nextMemory = { ...memory, [current.workflowType]: current.autoAdvance }
	const choiceFixesAutoAdvance = choice === 'exploratory'
	const remembered = nextMemory[resolved.workflowType]
	const autoAdvance = choiceFixesAutoAdvance || remembered === undefined ? resolved.autoAdvance : remembered
	return {
		workflow: { workflowType: resolved.workflowType, autoAdvance },
		memory: { ...nextMemory, [resolved.workflowType]: autoAdvance },
	}
}

export function projectTaskAutoAdvanceFlags(
	workflow: ResolvedTaskWorkflow,
	worktreeTiming: WorktreeTiming,
): TaskAutoAdvanceFlags {
	const guided = workflow.workflowType === 'outline_only' || workflow.workflowType === 'prd_tdd'
	return {
		autoAdvanceQuestionsToResearch: workflow.autoAdvance && guided,
		autoAdvanceResearchToDesign: workflow.autoAdvance && guided,
		autoAdvancePlanToWorktree: false,
		autoAdvanceWorktreeToImplementation: workflow.autoAdvance && guided && worktreeTiming === 'later',
		autoAdvanceImplementationToPr:
			workflow.autoAdvance && (workflow.workflowType === 'oneshot' || workflow.workflowType === 'freeform'),
	}
}

export function getLauncherWorkflowAutoAdvanceEdges(
	workflow: ResolvedTaskWorkflow,
	worktreeTiming: WorktreeTiming,
): AutoAdvanceEdge[] {
	const flags = projectTaskAutoAdvanceFlags(workflow, worktreeTiming)
	const edges: AutoAdvanceEdge[] = []
	if (flags.autoAdvanceQuestionsToResearch) {
		edges.push({ fromLabel: 'rpi:research-questions', toLabel: 'rpi:research' })
	}
	if (flags.autoAdvanceResearchToDesign) {
		edges.push({
			fromLabel: 'rpi:research',
			toLabel: workflow.workflowType === 'prd_tdd' ? 'rpi:design-prd' : 'rpi:design',
		})
	}
	if (flags.autoAdvanceWorktreeToImplementation) {
		edges.push({ fromLabel: 'rpi:worktree-setup', toLabel: 'rpi:implementation' })
	}
	if (flags.autoAdvanceImplementationToPr) {
		edges.push({ fromLabel: 'rpi:implementation', toLabel: 'rpi:describe-pr' })
	}
	return edges
}
