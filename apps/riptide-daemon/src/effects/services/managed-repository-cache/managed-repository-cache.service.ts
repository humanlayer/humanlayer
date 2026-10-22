import type { WorktreeMaterialization, RepositorySourceCandidate } from '@humanlayer/schemas/effect/project-workspace'
import { Context, type Effect, type FileSystem, type Path } from 'effect'
import * as Schema from 'effect/Schema'

import type { GitCommandRunner, GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import type { RepositorySourceContext } from './repository-source-context'

export type ManagedRepositoryCacheRequirements =
	| FileSystem.FileSystem
	| Path.Path
	| GitCommandRunner
	| GitCommandRunnerRequirements
	| RepositorySourceContext

export class ManagedRepositoryCacheError extends Schema.TaggedError<ManagedRepositoryCacheError>()(
	'ManagedRepositoryCacheError',
	{
		message: Schema.String,
		repositoryIdentity: Schema.String,
		path: Schema.String,
		command: Schema.optionalKey(Schema.String),
		exitCode: Schema.optionalKey(Schema.Int),
		stderr: Schema.optionalKey(Schema.String),
	},
) {}

export interface ManagedRepositoryInput {
	readonly repositoryIdentity: string
	readonly remoteUrl: string
}

export interface RefreshManagedRepositoryInput extends ManagedRepositoryInput {
	readonly sourcePath: string
	readonly defaultBranch: string
	readonly workspaceBranch: string
	readonly workspaceId: string
}

export interface MaterializeManagedRepositoryInput extends ManagedRepositoryInput {
	readonly sourcePath: string
	readonly targetPath: string
	readonly branch: string
	readonly resolvedCommit: string
	readonly workspaceId?: string
	readonly sourceKind?: RepositorySourceCandidate['sourceKind']
}

export interface PublishManagedRepositoryBranchInput extends ManagedRepositoryInput {
	readonly materializationPath: string
	readonly sourcePath?: string
	readonly branch: string
}

export interface ManagedRepositoryCacheService {
	readonly repositoryPath: (
		input: ManagedRepositoryInput,
	) => Effect.Effect<string, ManagedRepositoryCacheError, Path.Path | RepositorySourceContext>
	readonly prepare: (
		input: PrepareManagedRepositoryInput,
	) => Effect.Effect<string, ManagedRepositoryCacheError, ManagedRepositoryCacheRequirements>
	readonly refresh: (
		input: RefreshManagedRepositoryInput,
	) => Effect.Effect<string, ManagedRepositoryCacheError, ManagedRepositoryCacheRequirements>
	readonly materialize: (
		input: MaterializeManagedRepositoryInput,
	) => Effect.Effect<WorktreeMaterialization, ManagedRepositoryCacheError, ManagedRepositoryCacheRequirements>
	readonly publishBranch: (
		input: PublishManagedRepositoryBranchInput,
	) => Effect.Effect<void, ManagedRepositoryCacheError, ManagedRepositoryCacheRequirements>
}

export interface PrepareManagedRepositoryInput extends ManagedRepositoryInput {
	readonly sourcePath?: string
}

export class ManagedRepositoryCache extends Context.Service<ManagedRepositoryCache, ManagedRepositoryCacheService>()(
	'ManagedRepositoryCache',
) {}
