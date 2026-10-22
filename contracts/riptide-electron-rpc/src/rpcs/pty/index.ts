import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const PtyEvent = Schema.Union([
	Schema.Struct({
		event: Schema.Literal('output'),
		data: Schema.Struct({ data: Schema.Array(Schema.Number) }),
	}),
	Schema.Struct({
		event: Schema.Literal('exit'),
		data: Schema.Struct({ code: Schema.NullOr(Schema.Number) }),
	}),
])
export type PtyEvent = typeof PtyEvent.Type

// Electron transport handshake. Renderer adapters consume this and only expose PtyEvent.
export const PtyTransportEvent = Schema.Union([Schema.Struct({ event: Schema.Literal('attached') }), PtyEvent])
export type PtyTransportEvent = typeof PtyTransportEvent.Type

export const PtySize = Schema.Struct({
	cols: Schema.Number,
	rows: Schema.Number,
})
export type PtySize = typeof PtySize.Type

export class PtyCreateError extends Schema.TaggedError<PtyCreateError>()('PtyCreateError', {
	message: Schema.String,
}) {}

export class PtyNotFoundError extends Schema.TaggedError<PtyNotFoundError>()('PtyNotFoundError', {
	ptyId: Schema.String,
	message: Schema.String,
}) {}

export class PtyOperationError extends Schema.TaggedError<PtyOperationError>()('PtyOperationError', {
	ptyId: Schema.String,
	operation: Schema.Literals(['write', 'resize', 'kill']),
	message: Schema.String,
}) {}

export class CreatePty extends Rpc.make('CreatePty', {
	payload: { cwd: Schema.String },
	success: Schema.String,
	error: PtyCreateError,
}) {}

export class AttachPty extends Rpc.make('AttachPty', {
	payload: { ptyId: Schema.String },
	success: PtyTransportEvent,
	error: PtyNotFoundError,
	stream: true,
}) {}

export class DetachPty extends Rpc.make('DetachPty', {
	payload: { ptyId: Schema.String },
	success: Schema.Void,
	error: PtyNotFoundError,
}) {}

export class WritePty extends Rpc.make('WritePty', {
	payload: { ptyId: Schema.String, data: Schema.Array(Schema.Number) },
	success: Schema.Void,
	error: Schema.Union([PtyNotFoundError, PtyOperationError]),
}) {}

export class ResizePty extends Rpc.make('ResizePty', {
	payload: { ptyId: Schema.String, ...PtySize.fields },
	success: Schema.Void,
	error: Schema.Union([PtyNotFoundError, PtyOperationError]),
}) {}

export class KillPty extends Rpc.make('KillPty', {
	payload: { ptyId: Schema.String },
	success: Schema.Void,
	error: Schema.Union([PtyNotFoundError, PtyOperationError]),
}) {}

export class ListPtys extends Rpc.make('ListPtys', {
	success: Schema.Array(Schema.String),
}) {}
