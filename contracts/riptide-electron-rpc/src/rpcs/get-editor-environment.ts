import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class EditorEnvironmentError extends Schema.TaggedError<EditorEnvironmentError>()('EditorEnvironmentError', {
	message: Schema.String,
}) {}

export class GetEditorEnvironment extends Rpc.make('GetEditorEnvironment', {
	success: Schema.NullOr(Schema.String),
	error: EditorEnvironmentError,
}) {}
