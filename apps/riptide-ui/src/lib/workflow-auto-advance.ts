import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'

export type AutoAdvanceToggleId =
	| 'auto_advance_plan_to_worktree'
	| 'auto_advance_worktree_to_implementation'
	| 'auto_advance_implementation_to_pr'

export function getVisibleAutoAdvanceToggles(
	workflowType: TaskWorkflowType | null,
	worktreeTiming: WorktreeTiming | null,
): Set<AutoAdvanceToggleId> {
	const visible = new Set<AutoAdvanceToggleId>()
	const effectiveWorktreeTiming = worktreeTiming ?? 'later'

	if (workflowType) {
		visible.add('auto_advance_implementation_to_pr')
	}

	if (!workflowType || workflowType === 'oneshot') {
		return visible
	}

	if (workflowType === 'rpi') {
		// This legacy flag is shown as "auto-advance after plan" in product terms.
		// For worktree_timing=later it means Plan -> Worktree; for now/never the
		// backend resolves the same flag to Plan -> Implementation.
		visible.add('auto_advance_plan_to_worktree')
	}

	if (effectiveWorktreeTiming !== 'later') {
		return visible
	}

	visible.add('auto_advance_worktree_to_implementation')

	return visible
}
