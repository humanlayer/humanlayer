import type { Task } from '@humanlayer/db/tables/tasks'
import type { ResolvedTaskWorkflowType } from '@humanlayer/schemas/effect/taskconfiguration'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useTaskAutoAdvance } from '@/minimalist/lib/auto-advance'
import { useTask } from '@/minimalist/lib/data'
import { useUi } from '@/minimalist/lib/ui-state'
import { projectTaskAutoAdvanceFlags } from '@/modules/launcher-v3/launcher-v3-workflow'
import { useRiptideApi } from '@/orpc/client'

type WorkflowOption = { value: ResolvedTaskWorkflowType; label: string; description: string }

/** The workflows a task can switch to. Oneshot is only listed for tasks that already use it. */
export const TASK_WORKFLOWS: readonly WorkflowOption[] = [
	{ value: 'freeform', label: 'Freeform', description: 'Work straight from the prompt' },
	{ value: 'outline_only', label: 'RPI', description: 'Research and outline the work before implementation' },
	{ value: 'prd_tdd', label: 'PRD-TDD', description: 'Define product and technical design before implementation' },
]

const ONESHOT: WorkflowOption = {
	value: 'oneshot',
	label: 'Oneshot',
	description: 'Implement from the ticket, then prepare a pull request',
}

/** Older tasks say `rpi`; the launcher now calls the same guided workflow `outline_only`. */
export function resolvedWorkflowType(type: Task['workflow_type']): ResolvedTaskWorkflowType {
	return type === 'rpi' ? 'outline_only' : type
}

export function workflowOptions(current: ResolvedTaskWorkflowType): readonly WorkflowOption[] {
	return current === 'oneshot' ? [...TASK_WORKFLOWS, ONESHOT] : TASK_WORKFLOWS
}

export function workflowOption(type: Task['workflow_type']): WorkflowOption {
	const resolved = resolvedWorkflowType(type)
	return workflowOptions(resolved).find((option) => option.value === resolved) ?? ONESHOT
}

/**
 * The task's workflow, and a way for its owner to change it. A change keeps auto-advance as it
 * was: on stays on for the new workflow's hand-offs, off stays off.
 */
export function useTaskWorkflow(taskId: string) {
	const { task } = useTask(taskId)
	const { user } = useBrowserAuth()
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const autoAdvance = useTaskAutoAdvance(taskId)
	const current = resolvedWorkflowType(task?.workflow_type ?? 'freeform')
	return {
		current,
		canChange: Boolean(task && user?.id && task.resource_owner_user_id === user.id),
		change: async (workflowType: ResolvedTaskWorkflowType) => {
			if (!task || workflowType === current) return
			const flags = projectTaskAutoAdvanceFlags(
				{ workflowType, autoAdvance: autoAdvance.on },
				task.worktree_timing,
			)
			try {
				await api.tasks.update({
					taskId: task.id,
					workflowType,
					autoAdvanceQuestionsToResearch: flags.autoAdvanceQuestionsToResearch,
					autoAdvanceResearchToDesign: flags.autoAdvanceResearchToDesign,
					autoAdvancePlanToWorktree: flags.autoAdvancePlanToWorktree,
					autoAdvanceWorktreeToImplementation: flags.autoAdvanceWorktreeToImplementation,
					autoAdvanceImplementationToPr: flags.autoAdvanceImplementationToPr,
				})
			} catch {
				showToast('Could not change the workflow. The task keeps its current one. Try again.')
			}
		},
	}
}
