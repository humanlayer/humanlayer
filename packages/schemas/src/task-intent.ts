import z from 'zod/v4'

export const TaskIntentSchema = z.enum(['unknown', 'research', 'design', 'implementation'])
export type TaskIntent = z.infer<typeof TaskIntentSchema>

/** A first session's intent, as the session label the auto-advance rules read. */
export const TASK_INTENT_LABELS = {
	research: { name: 'rpi:research', title: 'research' },
	design: { name: 'rpi:design', title: 'design' },
	implementation: { name: 'rpi:implementation', title: 'implementation' },
} as const satisfies Record<Exclude<TaskIntent, 'unknown'>, { name: string; title: string }>
