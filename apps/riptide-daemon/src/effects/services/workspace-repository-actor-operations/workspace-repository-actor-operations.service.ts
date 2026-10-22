import type { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { Context, Data, type Effect } from 'effect'

import type {
	DaemonWorkspaceRepositoryApiError,
	DaemonWorkspaceRepositoryStatusChanged,
} from '../daemon-api/daemon-api.errors'
import type { DaemonApi } from '../daemon-api/daemon-api.service'
import type {
	ManagedRepositoryCache,
	ManagedRepositoryCacheRequirements,
} from '../managed-repository-cache/managed-repository-cache.service'
import type { RepositorySourceResolver } from './repository-source-resolver'

export type WorkspaceRepositoryActorOperationRequirements =
	| DaemonApi
	| ManagedRepositoryCache
	| ManagedRepositoryCacheRequirements
	| RepositorySourceResolver

export class WorkspaceRepositoryParked extends Data.TaggedError('WorkspaceRepositoryParked')<{
	readonly snapshot: WorkspaceRepositoryActorSnapshot
}> {}

export type WorkspaceRepositoryActorOperationError =
	| DaemonWorkspaceRepositoryApiError
	| DaemonWorkspaceRepositoryStatusChanged
	| WorkspaceRepositoryParked

export interface WorkspaceRepositoryActorOperationsService {
	readonly start: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<WorkspaceRepositoryActorSnapshot, WorkspaceRepositoryActorOperationError, DaemonApi>
	readonly checkSource: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly cloneSource: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly refreshSource: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly resolveCommit: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly materialize: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly publishBranch: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly copyFiles: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
	readonly runSetupCommand: (
		snapshot: WorkspaceRepositoryActorSnapshot,
	) => Effect.Effect<
		WorkspaceRepositoryActorSnapshot,
		WorkspaceRepositoryActorOperationError,
		WorkspaceRepositoryActorOperationRequirements
	>
}

export class WorkspaceRepositoryActorOperations extends Context.Service<
	WorkspaceRepositoryActorOperations,
	WorkspaceRepositoryActorOperationsService
>()('WorkspaceRepositoryActorOperations') {}
