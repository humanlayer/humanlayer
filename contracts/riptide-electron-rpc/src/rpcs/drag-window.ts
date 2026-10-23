import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class WindowDragError extends Schema.TaggedError<WindowDragError>()('WindowDragError', {
	reason: Schema.Literals(['unavailable', 'busy', 'failed']),
	message: Schema.String,
}) {}

// The request lives for one mouse gesture. Interrupting it stops the drag.
// Window identity and coordinates are deliberately not renderer-controlled.
export class DragWindow extends Rpc.make('DragWindow', {
	success: Schema.Void,
	error: WindowDragError,
}) {}
