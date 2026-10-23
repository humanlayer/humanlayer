import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const Editor = Schema.Literals(['cursor', 'code', 'zed'])
export type Editor = typeof Editor.Type

export const OpenInEditorPayload = Schema.Struct({
	path: Schema.String,
	editor: Schema.NullOr(Editor),
})
export type OpenInEditorPayload = typeof OpenInEditorPayload.Type

export class PathNotFoundError extends Schema.TaggedError<PathNotFoundError>()('PathNotFoundError', {
	path: Schema.String,
	message: Schema.String,
}) {}

export class EditorNotInstalledError extends Schema.TaggedError<EditorNotInstalledError>()('EditorNotInstalledError', {
	editor: Editor,
	message: Schema.String,
}) {}

export class EditorLaunchError extends Schema.TaggedError<EditorLaunchError>()('EditorLaunchError', {
	message: Schema.String,
}) {}

export class EditorAccessError extends Schema.TaggedError<EditorAccessError>()('EditorAccessError', {
	path: Schema.String,
	message: Schema.String,
}) {}

export const OpenInEditorError = Schema.Union([
	PathNotFoundError,
	EditorNotInstalledError,
	EditorAccessError,
	EditorLaunchError,
])
export type OpenInEditorError = typeof OpenInEditorError.Type

export const OpenInEditorSuccess = Schema.Void

export class OpenInEditor extends Rpc.make('OpenInEditor', {
	payload: OpenInEditorPayload,
	success: OpenInEditorSuccess,
	error: OpenInEditorError,
}) {}
