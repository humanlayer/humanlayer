import { Effect, Struct } from 'effect'
import * as Schema from 'effect/Schema'

export const WorkspaceSourceCommit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/i))
export type WorkspaceSourceCommit = typeof WorkspaceSourceCommit.Type

export const WorkspaceSpecRepo = Schema.Struct({
	localPath: Schema.NonEmptyString,
	targetPath: Schema.NonEmptyString,
	branch: Schema.NonEmptyString,
	sourceRef: Schema.NonEmptyString,
	branchRemote: Schema.optional(Schema.NonEmptyString),
	sourceCommit: Schema.optional(WorkspaceSourceCommit),
	setupCommand: Schema.optional(Schema.String),
	copyGlobs: Schema.Array(Schema.String).pipe(Schema.mutable, Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
	primary: Schema.Boolean,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceSpecRepo = typeof WorkspaceSpecRepo.Type

export const WorkspaceSpec = Schema.Struct({
	specVersion: Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(1))),
	directory: Schema.NonEmptyString,
	workspaceBaseDirectory: Schema.NonEmptyString,
	setupBlocksFirstSession: Schema.Boolean.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(false))),
	repos: Schema.Array(WorkspaceSpecRepo).pipe(Schema.mutable, Schema.check(Schema.isMinLength(1))),
})
	.mapFields(Struct.map(Schema.mutableKey))
	.check(
		Schema.makeFilter((spec) =>
			spec.repos.filter((repo) => repo.primary).length === 1
				? undefined
				: { path: ['repos'], issue: 'workspace spec must contain exactly one primary repo' },
		),
	)
export type WorkspaceSpec = typeof WorkspaceSpec.Type

// Compatibility names used by the existing workspace API surface.
export const WorkspaceSourceCommitSchema = WorkspaceSourceCommit
export const WorkspaceSpecRepoSchema = WorkspaceSpecRepo
export const WorkspaceSpecSchema = WorkspaceSpec
