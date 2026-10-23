import type { WorkspaceSetupStage } from '@humanlayer/schemas/effect/workspace'
import { Data } from 'effect'

/** Durable-state inconsistency detected while converging a workspace row. */
export class WorkspaceConvergenceStateError extends Data.TaggedError('WorkspaceConvergenceStateError')<{
	readonly taskId: string
	readonly hostId: string
	readonly localPath: string
	readonly stage: WorkspaceSetupStage
	readonly message: string
	readonly command?: string
	readonly exitCode?: number
	readonly stderr?: string
}> {}
