import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const HostId = Schema.String.pipe(Schema.check(Schema.isUUID()))
export type HostId = typeof HostId.Type

export class HostIdPersistenceError extends Schema.TaggedError<HostIdPersistenceError>()('HostIdPersistenceError', {
	message: Schema.String,
}) {}

export class GetHostId extends Rpc.make('GetHostId', {
	success: HostId,
	error: HostIdPersistenceError,
}) {}
