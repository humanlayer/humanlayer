import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

export const WorkspaceStateRepo = Schema.Struct({
	path: Schema.String,
	description: Schema.optional(Schema.String),
	remoteUrl: Schema.optional(Schema.String),
	sourceRef: Schema.String,
	sourceCommit: Schema.optional(Schema.String),
	branch: Schema.String,
	branchRemote: Schema.optional(Schema.NonEmptyString),
	primary: Schema.Boolean,
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceStateRepo = typeof WorkspaceStateRepo.Type

export const WorkspaceState = Schema.Struct({
	workspaceBaseDirectory: Schema.String,
	repos: Schema.Array(WorkspaceStateRepo).pipe(Schema.mutable),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceState = typeof WorkspaceState.Type

export const WorkspaceStateRepoSchema = WorkspaceStateRepo
export const WorkspaceStateSchema = WorkspaceState
