import type { CreatedWithExperimentFlags } from '@humanlayer/db/zodschemas/created-with-experiment-flags'
import z from 'zod/v4'

export const TASK_COMPOSER_EXPERIMENT_KEY = 'task_composer'

export const TaskComposerSnapshotSchema = z.strictObject({
	assigned_group: z.enum(['v2_form', 'v3_composer']),
	actual_form: z.enum(['v2_form', 'v3_composer', 'v2_form_mobile']),
})
export type TaskComposerSnapshot = z.infer<typeof TaskComposerSnapshotSchema>

export const CreatedWithExperimentFlagsSchema = z.strictObject({
	[TASK_COMPOSER_EXPERIMENT_KEY]: TaskComposerSnapshotSchema,
})
export type { CreatedWithExperimentFlags }

export function buildCreatedWithExperimentFlags(taskComposer: TaskComposerSnapshot): CreatedWithExperimentFlags {
	return { [TASK_COMPOSER_EXPERIMENT_KEY]: taskComposer }
}

export function getTaskComposerSnapshot(
	flags: CreatedWithExperimentFlags | null | undefined,
): TaskComposerSnapshot | undefined {
	const parsed = TaskComposerSnapshotSchema.safeParse(flags?.[TASK_COMPOSER_EXPERIMENT_KEY])
	return parsed.success ? parsed.data : undefined
}

export function getTaskComposerSnapshotWithV2Default(
	flags: CreatedWithExperimentFlags | null | undefined,
): TaskComposerSnapshot {
	return getTaskComposerSnapshot(flags) ?? { assigned_group: 'v2_form', actual_form: 'v2_form' }
}
