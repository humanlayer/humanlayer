import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class OpenNewWindowError extends Schema.TaggedError<OpenNewWindowError>()('OpenNewWindowError', {
	message: Schema.String,
}) {}

export class OpenNewWindow extends Rpc.make('OpenNewWindow', {
	success: Schema.Void,
	error: OpenNewWindowError,
}) {}
