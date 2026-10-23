import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

export const WorkspaceSetupStages = [
	'setup_requested',
	'preflight',
	'worktree',
	'copy_globs',
	'setup_command',
	'done',
] as const

export const WorkspaceSetupStage = Schema.Literals(WorkspaceSetupStages)
export type WorkspaceSetupStage = typeof WorkspaceSetupStage.Type

export const WorkspaceSetupError = Schema.Struct({
	localPath: Schema.NonEmptyString,
	stage: WorkspaceSetupStage,
	message: Schema.NonEmptyString,
	command: Schema.optional(Schema.String),
	exitCode: Schema.optional(Schema.Int),
	stderr: Schema.optional(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type WorkspaceSetupError = typeof WorkspaceSetupError.Type

export const WorkspaceSetupStageSchema = WorkspaceSetupStage
export const WorkspaceSetupErrorSchema = WorkspaceSetupError
