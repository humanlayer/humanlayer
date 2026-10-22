import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

import { NormalizedRepositoryIdentity, RepositoryRemoteUrl } from './project-recipe'

export const GitCommitSha = Schema.NonEmptyString.check(Schema.isPattern(/^[0-9a-f]{40}$/i))
export type GitCommitSha = typeof GitCommitSha.Type

export const WorkspaceRepository = Schema.Struct({
	remoteUrl: RepositoryRemoteUrl,
	repositoryIdentity: NormalizedRepositoryIdentity,
	defaultBranch: Schema.NonEmptyString,
	branch: Schema.NonEmptyString,
	baseCommit: Schema.optionalKey(GitCommitSha),
	default: Schema.Boolean,
	description: Schema.optionalKey(Schema.NonEmptyString),
	autoPushBranch: Schema.Boolean,
	copyGlobs: Schema.Array(Schema.String).pipe(Schema.mutable),
	setupCommand: Schema.optionalKey(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceRepository = typeof WorkspaceRepository.Type

export const WorkspaceRepositories = Schema.Array(WorkspaceRepository)
	.pipe(Schema.mutable, Schema.check(Schema.isMinLength(1)))
	.check(
		Schema.makeFilter((repositories) =>
			new Set(repositories.map((repository) => repository.repositoryIdentity)).size === repositories.length
				? undefined
				: { path: [], issue: 'workspace repositories must have unique repository identities' },
		),
		Schema.makeFilter((repositories) =>
			repositories.filter((repository) => repository.default).length === 1
				? undefined
				: { path: [], issue: 'workspace repositories must contain exactly one default repository' },
		),
	)
export type WorkspaceRepositories = typeof WorkspaceRepositories.Type
