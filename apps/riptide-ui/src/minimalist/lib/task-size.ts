import type { ResolvedTaskWorkflow } from '@humanlayer/schemas/effect/taskconfiguration'
import { useLocalStorage } from '@uidotdev/usehooks'

import { DEFAULT_RESOLVED_TASK_WORKFLOW, TASK_SIZE_WORKFLOW_OPTIONS } from '@/modules/launcher-v3/launcher-v3-workflow'

export type TaskSize = 'small' | 'medium' | 'large' | 'unknown'

type TaskSizeOption = { value: TaskSize; label: string; description: string; workflow: ResolvedTaskWorkflow }

const sharedDescription = (value: 'small' | 'medium' | 'large') =>
	TASK_SIZE_WORKFLOW_OPTIONS.find((option) => option.value === value)?.description ?? ''

const UNKNOWN_SIZE: TaskSizeOption = {
	value: 'unknown',
	label: "Don't know yet",
	description: 'Explore a question, issue, or feature request',
	workflow: { workflowType: 'freeform', autoAdvance: false },
}

/**
 * How big the new task is, and the workflow each size launches. Small work and work you can't size
 * yet start freeform from the prompt; small work also aims at a pull request. Medium runs RPI and
 * large runs PRD / TDD, with the standard launcher's auto-advance defaults.
 */
export const TASK_SIZES: readonly TaskSizeOption[] = [
	{
		value: 'small',
		label: 'Small',
		description: sharedDescription('small'),
		workflow: { workflowType: 'freeform', autoAdvance: true },
	},
	{
		value: 'medium',
		label: 'Medium',
		description: `${sharedDescription('medium')} (RPI)`,
		workflow: DEFAULT_RESOLVED_TASK_WORKFLOW,
	},
	{
		value: 'large',
		label: 'Large',
		description: `${sharedDescription('large')} (PRD-TDD)`,
		workflow: { workflowType: 'prd_tdd', autoAdvance: true },
	},
	UNKNOWN_SIZE,
]

export function taskSizeOption(size: TaskSize): TaskSizeOption {
	return TASK_SIZES.find((option) => option.value === size) ?? UNKNOWN_SIZE
}

/** The size new tasks start with: the last one picked on this device. */
export function useTaskSize() {
	return useLocalStorage<TaskSize>('hl-min-task-size', 'unknown')
}

/** Whether a small task describes its pull request on its own once implementation is done. */
export function useSmallTaskAutoAdvance() {
	return useLocalStorage<boolean>('hl-min-small-auto-advance', true)
}

/** The workflow a new task of this size launches with. */
export function taskSizeWorkflow(size: TaskSize, smallAutoAdvance: boolean): ResolvedTaskWorkflow {
	const { workflow } = taskSizeOption(size)
	return size === 'small' ? { workflowType: workflow.workflowType, autoAdvance: smallAutoAdvance } : workflow
}
