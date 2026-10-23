import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const SetZoomPayload = Schema.Struct({
	zoomFactor: Schema.Number.check(Schema.isBetween({ minimum: 0.2, maximum: 10 })),
})
export type SetZoomPayload = typeof SetZoomPayload.Type

export class WindowZoomSetError extends Schema.TaggedError<WindowZoomSetError>()('WindowZoomSetError', {
	message: Schema.String,
}) {}

export class SetZoom extends Rpc.make('SetZoom', {
	payload: SetZoomPayload,
	success: Schema.Void,
	error: WindowZoomSetError,
}) {}
