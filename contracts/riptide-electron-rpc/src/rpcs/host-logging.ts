import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const HostLogLevel = Schema.Literals(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
export type HostLogLevel = typeof HostLogLevel.Type

export const WriteHostLogPayload = Schema.Struct({
	level: HostLogLevel,
	message: Schema.String,
})
export type WriteHostLogPayload = typeof WriteHostLogPayload.Type

export class HostLogAccessError extends Schema.TaggedError<HostLogAccessError>()('HostLogAccessError', {
	message: Schema.String,
}) {}

export class WriteHostLog extends Rpc.make('WriteHostLog', {
	payload: WriteHostLogPayload,
	success: Schema.Void,
}) {}

export class GetLogDirectory extends Rpc.make('GetLogDirectory', {
	success: Schema.String,
}) {}

export class GetCurrentLogFiles extends Rpc.make('GetCurrentLogFiles', {
	success: Schema.Array(Schema.String),
	error: HostLogAccessError,
}) {}
