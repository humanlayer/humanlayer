import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

import { Editor } from './open-in-editor.js'
import { DiscoveredGitRepository } from './repository-discovery.js'

export const WorkspaceConfigTarget = Schema.Literals(['repo', 'local'])
export type WorkspaceConfigTarget = typeof WorkspaceConfigTarget.Type

export const WorkspaceConfigReadResult = Schema.Struct({
	content: Schema.NullOr(Schema.String),
	exists: Schema.Boolean,
	isInsideGitRepository: Schema.optional(Schema.Boolean),
	selectedRepository: Schema.optional(DiscoveredGitRepository),
})
export type WorkspaceConfigReadResult = typeof WorkspaceConfigReadResult.Type

export class WorkspaceConfigError extends Schema.TaggedError<WorkspaceConfigError>()('WorkspaceConfigError', {
	operation: Schema.String,
	path: Schema.String,
	message: Schema.String,
}) {}

export class ReadWorkspaceConfig extends Rpc.make('ReadWorkspaceConfig', {
	payload: { directory: Schema.String, target: WorkspaceConfigTarget },
	success: WorkspaceConfigReadResult,
	error: WorkspaceConfigError,
}) {}

export class WriteWorkspaceConfig extends Rpc.make('WriteWorkspaceConfig', {
	payload: { directory: Schema.String, target: WorkspaceConfigTarget, content: Schema.String },
	success: Schema.Void,
	error: WorkspaceConfigError,
}) {}

export class EnsureWorkspaceConfigIgnored extends Rpc.make('EnsureWorkspaceConfigIgnored', {
	payload: { directory: Schema.String },
	success: Schema.Void,
	error: WorkspaceConfigError,
}) {}

export class OpenWorkspaceConfig extends Rpc.make('OpenWorkspaceConfig', {
	payload: {
		directory: Schema.String,
		target: WorkspaceConfigTarget,
		previewContent: Schema.String,
		editor: Schema.optional(Editor),
	},
	success: Schema.Void,
	error: WorkspaceConfigError,
}) {}
