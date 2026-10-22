import { DaemonLaunchResult } from '@humanlayer/schemas/effect/daemon/process-event'
import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export { DaemonLaunchResult } from '@humanlayer/schemas/effect/daemon/process-event'

export const DaemonSyncMode = Schema.Literals(['auto', 'electric', 'query'])
export type DaemonSyncMode = typeof DaemonSyncMode.Type

export const DaemonTuple = Schema.Struct({
	userId: Schema.String,
	organizationId: Schema.String,
})
export type DaemonTuple = typeof DaemonTuple.Type

export const DaemonInfo = Schema.Struct({
	userId: Schema.String,
	organizationId: Schema.String,
	hostId: Schema.String,
	pid: Schema.Number,
	syncMode: DaemonSyncMode,
})
export type DaemonInfo = typeof DaemonInfo.Type

export class DaemonUnavailableError extends Schema.TaggedError<DaemonUnavailableError>()('DaemonUnavailableError', {
	message: Schema.String,
}) {}

export class DaemonStartError extends Schema.TaggedError<DaemonStartError>()('DaemonStartError', {
	message: Schema.String,
}) {}

export class DaemonStopError extends Schema.TaggedError<DaemonStopError>()('DaemonStopError', {
	message: Schema.String,
}) {}

export const UnexpectedExit = Schema.TaggedStruct('UnexpectedExit', {
	...DaemonTuple.fields,
	exitCode: Schema.NullOr(Schema.Number),
})
export const RestartSucceeded = Schema.TaggedStruct('RestartSucceeded', {
	...DaemonTuple.fields,
	pid: Schema.Number,
})
export const RestartFailed = Schema.TaggedStruct('RestartFailed', {
	...DaemonTuple.fields,
	message: Schema.String,
})
export const AuthenticationFailed = Schema.TaggedStruct('AuthenticationFailed', {
	...DaemonTuple.fields,
	message: Schema.String,
})

export const DaemonLifecycleEvent = Schema.Union([
	UnexpectedExit,
	RestartSucceeded,
	RestartFailed,
	AuthenticationFailed,
])
export type DaemonLifecycleEvent = typeof DaemonLifecycleEvent.Type

export class StartDaemon extends Rpc.make('StartDaemon', {
	payload: {
		token: Schema.String,
		...DaemonTuple.fields,
		syncMode: DaemonSyncMode,
		// The API/sync origins the renderer is using. Forwarded to the daemon as
		// RIPTIDE_API_ORIGIN/RIPTIDE_SYNC_ORIGIN so it always talks to the same
		// backend that minted its token, regardless of what origin was baked into
		// the daemon binary at build time.
		apiOrigin: Schema.NonEmptyString,
		syncOrigin: Schema.NonEmptyString,
		// Absolute Claude executable selected by device setup, or null to let the
		// daemon discover Claude on PATH. Required so callers pass one or the other
		// explicitly; the boundary handler parses/validates a present path once.
		verifiedClaudePath: Schema.NullOr(Schema.String),
	},
	success: DaemonLaunchResult,
	error: Schema.Union([DaemonUnavailableError, DaemonStartError]),
}) {}

export class StopDaemon extends Rpc.make('StopDaemon', {
	payload: DaemonTuple.fields,
	success: Schema.Void,
	error: DaemonStopError,
}) {}

// Turning management off closes Electron's start and restart gate, cancels pending launches, and
// stops every daemon this Electron process owns. Daemons started outside Electron keep running.
export class SetDaemonManagement extends Rpc.make('SetDaemonManagement', {
	payload: { enabled: Schema.Boolean },
	success: Schema.Void,
	error: DaemonStopError,
}) {}

export class IsDaemonRunning extends Rpc.make('IsDaemonRunning', {
	payload: DaemonTuple.fields,
	success: Schema.Boolean,
}) {}

export class DaemonLifecycleEvents extends Rpc.make('DaemonLifecycleEvents', {
	success: DaemonLifecycleEvent,
	stream: true,
}) {}
