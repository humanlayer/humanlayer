import { useMemo } from 'react'
import { toast } from 'sonner'

import type { TaskDetailTask } from '@/hooks/task-detail/useTaskDetailData'
import type { useTaskSettings } from '@/hooks/useTaskSettings'
import { captureException } from '@/integrations/sentry/sentry'

type UpdateAutoAdvance = ReturnType<typeof useTaskSettings>['updateAutoAdvance']

/**
 * Toggle handlers for the per-phase auto-advance settings on the task detail
 * page sidebar. All five follow the same optimistic-update + error-toast
 * pattern via a shared factory.
 */
export function useTaskAutoAdvanceToggles({
	task,
	updateAutoAdvance,
}: {
	task: TaskDetailTask | undefined
	updateAutoAdvance: UpdateAutoAdvance
}) {
	// Factory for auto-advance toggle handlers — all follow the same pattern
	type AutoAdvanceField = keyof Omit<Parameters<UpdateAutoAdvance>[0], 'taskId'>
	return useMemo(() => {
		const makeToggle = (field: AutoAdvanceField) => (checked: boolean) => {
			if (!task) return
			const transaction = updateAutoAdvance({
				taskId: task.id,
				[field]: checked,
			} as Parameters<UpdateAutoAdvance>[0])
			transaction.isPersisted.promise.catch((error) => {
				toast.error('Failed to update auto-advance setting')
				captureException(error, { extra: { action: 'updateAutoAdvance', taskId: task.id } })
			})
		}

		return {
			handleAutoAdvanceToggle: makeToggle('autoAdvanceQuestionsToResearch'),
			handleResearchToDesignToggle: makeToggle('autoAdvanceResearchToDesign'),
			handlePlanToWorktreeToggle: makeToggle('autoAdvancePlanToWorktree'),
			handleWorktreeToImplementationToggle: makeToggle('autoAdvanceWorktreeToImplementation'),
			handleImplementationToPrToggle: makeToggle('autoAdvanceImplementationToPr'),
		}
	}, [task, updateAutoAdvance])
}
