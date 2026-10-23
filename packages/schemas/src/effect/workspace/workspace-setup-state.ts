import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

import { WorkspaceSetupStage } from './workspace-setup-error'

export const AcceptedWorkspaceSetupSkip = Schema.Struct({
	localPath: Schema.NonEmptyString,
	stage: Schema.Literals(['copy_globs', 'setup_command']),
	skippedByUserId: Schema.NonEmptyString,
	skippedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	command: Schema.optional(Schema.String),
	errorMessage: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type AcceptedWorkspaceSetupSkip = typeof AcceptedWorkspaceSetupSkip.Type

export const WorkspacePreflightProgress = Schema.Struct({
	resolvedSourceCommit: Schema.optional(Schema.String),
	branchRemote: Schema.optional(Schema.NonEmptyString),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspacePreflightProgress = typeof WorkspacePreflightProgress.Type

export const WorkspaceWorktreeProgress = Schema.Struct({
	targetPath: Schema.optional(Schema.String),
	remoteName: Schema.optional(Schema.NonEmptyString),
	remoteUrl: Schema.optional(Schema.String),
	upstreamRef: Schema.optional(Schema.NonEmptyString),
	published: Schema.optional(Schema.Boolean),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceWorktreeProgress = typeof WorkspaceWorktreeProgress.Type

export const RepoWorkspaceSetupProgress = Schema.Struct({
	localPath: Schema.NonEmptyString,
	status: WorkspaceSetupStage,
	preflight: Schema.optional(WorkspacePreflightProgress),
	worktree: Schema.optional(WorkspaceWorktreeProgress),
	copyGlobs: Schema.optional(
		Schema.Struct({ filesCopied: Schema.optional(Schema.Array(Schema.String).pipe(Schema.mutable)) }).mapFields(
			Struct.map(Schema.mutableKey),
		),
	),
	setupCommand: Schema.optional(
		Schema.Struct({ command: Schema.String, exitCode: Schema.optional(Schema.Int) }).mapFields(
			Struct.map(Schema.mutableKey),
		),
	),
}).mapFields(Struct.map(Schema.mutableKey))
export type RepoWorkspaceSetupProgress = typeof RepoWorkspaceSetupProgress.Type

export const WorkspaceSetupState = Schema.Struct({
	specVersion: Schema.Int.check(Schema.isGreaterThan(0)),
	startedAt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	finishedAt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	repos: Schema.Array(RepoWorkspaceSetupProgress).pipe(Schema.mutable),
	acceptedSkips: Schema.optional(Schema.Array(AcceptedWorkspaceSetupSkip).pipe(Schema.mutable)),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceSetupState = typeof WorkspaceSetupState.Type

export const AcceptedWorkspaceSetupSkipSchema = AcceptedWorkspaceSetupSkip
export const RepoWorkspaceSetupProgressSchema = RepoWorkspaceSetupProgress
export const WorkspaceSetupStateSchema = WorkspaceSetupState
