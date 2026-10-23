import { NEXT_STEP_BUTTON_LABELS } from '@humanlayer/ui/constants/rpi-skills'

// Re-export for backwards compatibility
export { NEXT_STEP_BUTTON_LABELS }

export function getNextStepButtonLabel(nextStepType: string): string {
	return NEXT_STEP_BUTTON_LABELS[nextStepType] ?? 'proceed'
}
