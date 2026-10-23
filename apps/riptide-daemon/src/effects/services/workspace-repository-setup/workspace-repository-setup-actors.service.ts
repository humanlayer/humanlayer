import type { WorkspaceRepositoryStatusIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Context, type Effect } from 'effect'

export interface WorkspaceRepositorySetupActorsService {
	readonly enqueue: (identity: WorkspaceRepositoryStatusIdentity) => Effect.Effect<void>
}

export class WorkspaceRepositorySetupActors extends Context.Service<
	WorkspaceRepositorySetupActors,
	WorkspaceRepositorySetupActorsService
>()('WorkspaceRepositorySetupActors') {}
