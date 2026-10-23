import type { Workflow } from './shared'

export function workflowUsesRpiArtifactPipeline(workflow: Workflow | undefined): boolean {
	return workflow === 'rpi' || workflow === 'outline_only' || workflow === 'prd_tdd'
}

export function workflowCreatesImplementationArtifact(workflow: Workflow | undefined): boolean {
	return workflow === 'oneshot'
}
