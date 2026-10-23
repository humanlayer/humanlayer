export const LAUNCHER_WORKFLOWS = ['freeform'] as const

export type LauncherWorkflow = (typeof LAUNCHER_WORKFLOWS)[number]

export interface LauncherWorkflowOption {
	value: LauncherWorkflow
	label: string
	description: string
}

export const LAUNCHER_WORKFLOW_OPTIONS: readonly LauncherWorkflowOption[] = [
	{
		value: 'freeform',
		label: 'Freeform / Oneshot / Exploratory',
		description: 'Create a single session in a task that is open-ended',
	},
]

export function launcherWorkflowLabel(workflow: LauncherWorkflow): string {
	return LAUNCHER_WORKFLOW_OPTIONS.find(({ value }) => value === workflow)?.label ?? workflow
}
