import type { Task } from '@humanlayer/db/tables/tasks'
import { useMemo } from 'react'

import { getVisibleAutoAdvanceToggles } from '@/lib/workflow-auto-advance'
import { getWorkflowPhases } from '@/lib/workflow-phases'

/**
 * Workflow phases, visible auto-advance toggles, and the plan auto-advance
 * labels, all derived from the task's workflow type and worktree timing.
 */
export function useTaskWorkflowInfo(task: Pick<Task, 'workflow_type' | 'worktree_timing'> | undefined) {
	const workflowType = task?.workflow_type ?? null
	const worktreeTiming = task?.worktree_timing ?? null

	const workflowPhases = useMemo(
		() => getWorkflowPhases(workflowType, worktreeTiming),
		[workflowType, worktreeTiming],
	)
	const visibleAutoAdvanceToggles = useMemo(
		() => getVisibleAutoAdvanceToggles(workflowType, worktreeTiming),
		[workflowType, worktreeTiming],
	)

	const skipsDeferredWorktree = worktreeTiming === 'now' || worktreeTiming === 'never'
	// The persisted setting is still named plan-to-worktree, but the UI presents
	// the product behavior: auto-advance after plan to whichever next phase the task timing selects.
	const planAutoAdvanceLabel = skipsDeferredWorktree ? 'Plan → Implementation' : 'Plan → Worktree'
	const planAutoAdvanceTitle = skipsDeferredWorktree
		? 'Automatically launch implementation when plan session completes'
		: 'Automatically set up worktree when plan session completes'

	return { workflowPhases, visibleAutoAdvanceToggles, planAutoAdvanceLabel, planAutoAdvanceTitle }
}
