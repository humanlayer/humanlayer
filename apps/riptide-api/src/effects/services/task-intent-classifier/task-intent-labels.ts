import type { TaskIntent } from '@humanlayer/schemas/task-intent'

const TASK_INTENT_LABELS = {
	research: { name: 'rpi:research', title: 'research' },
	design: { name: 'rpi:design', title: 'design' },
	implementation: { name: 'rpi:implementation', title: 'implementation' },
} as const

export function taskIntentLabels(intent: TaskIntent | undefined) {
	return intent && intent !== 'unknown' ? [TASK_INTENT_LABELS[intent]] : undefined
}
