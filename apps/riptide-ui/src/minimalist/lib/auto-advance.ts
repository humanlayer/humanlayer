import type { Task } from '@humanlayer/db/tables/tasks'
import type { TaskAutoAdvanceFlags } from '@humanlayer/schemas/effect/taskconfiguration'

import { useSync } from '@/components/providers/SyncProvider'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { useTask } from '@/minimalist/lib/data'
import { useUi } from '@/minimalist/lib/ui-state'
import { projectTaskAutoAdvanceFlags } from '@/modules/launcher-v3/launcher-v3-workflow'
import { useRiptideApi } from '@/orpc/client'

type Flag = keyof TaskAutoAdvanceFlags

const HAND_OFFS: Record<Flag, (prd: boolean) => string> = {
	autoAdvanceQuestionsToResearch: () => 'questions → research',
	autoAdvanceResearchToDesign: (prd) => (prd ? 'research → PRD' : 'research → design'),
	autoAdvancePlanToWorktree: () => 'plan → worktree',
	autoAdvanceWorktreeToImplementation: () => 'worktree → implementation',
	autoAdvanceImplementationToPr: () => 'implementation → PR',
}

/**
 * The hand-offs the task's workflow runs through, by the same rule the standard launcher uses for
 * its one auto-advance switch: questions → research → design (or PRD), and the worktree when it is
 * set up later, for guided workflows; implementation → PR for small and freeform ones.
 */
export function autoAdvanceFlags(task: Pick<Task, 'workflow_type' | 'worktree_timing'>): Flag[] {
	// Older tasks say `rpi`; the launcher now calls the same guided workflow `outline_only`.
	const workflowType = task.workflow_type === 'rpi' ? 'outline_only' : task.workflow_type
	const flags = projectTaskAutoAdvanceFlags({ workflowType, autoAdvance: true }, task.worktree_timing)
	return (Object.keys(flags) as Flag[]).filter((flag) => flags[flag])
}

/**
 * One switch for auto-advance: on when every hand-off in the task's workflow is on, and turning
 * it on or off sets all of them. Hand-offs outside the workflow are left alone.
 */
export function useTaskAutoAdvance(taskId: string | null | undefined) {
	const { task } = useTask(taskId)
	const { user } = useBrowserAuth()
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const { tasksCollection, taskUserSettingsCollection, taskOrganizationAclsCollection, taskUserAclsCollection } =
		useSync()
	const { canEditTask } = useTaskPermissions(
		task ?? undefined,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)
	const { settings, updateAutoAdvance } = useTaskSettings({
		task: task ?? undefined,
		userId: user?.id,
		tasksCollection,
		taskUserSettingsCollection,
		api,
	})
	const flags = task ? autoAdvanceFlags(task) : []
	const on = flags.length > 0 && flags.every((flag) => settings[flag])
	const prd = task?.workflow_type === 'prd_tdd'
	return {
		available: Boolean(task) && flags.length > 0 && canEditTask,
		on,
		handOffs: flags.map((flag) => HAND_OFFS[flag](prd)),
		toggle: () => {
			if (!task || flags.length === 0) return
			const next = !on
			const transaction = updateAutoAdvance({
				taskId: task.id,
				...Object.fromEntries(flags.map((flag) => [flag, next])),
			})
			transaction.isPersisted.promise.catch(() => showToast('Could not change auto-advance. Try again.'))
		},
	}
}
