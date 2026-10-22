import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export const DaemonReady = Schema.Struct({
	type: Schema.tag('daemon_ready'),
})
export type DaemonReady = typeof DaemonReady.Type

export const DaemonAlreadyRunning = Schema.Struct({
	type: Schema.tag('daemon_already_running'),
	message: Schema.String,
})
export type DaemonAlreadyRunning = typeof DaemonAlreadyRunning.Type

export const DaemonAuthenticationFailed = Schema.Struct({
	type: Schema.tag('auth_failure'),
	message: Schema.String,
})
export type DaemonAuthenticationFailed = typeof DaemonAuthenticationFailed.Type

export const DaemonLaunchResult = Schema.Union([DaemonReady, DaemonAlreadyRunning]).pipe(Schema.toTaggedUnion('type'))
export type DaemonLaunchResult = typeof DaemonLaunchResult.Type

export const DaemonProcessEvent = Schema.Union([DaemonReady, DaemonAlreadyRunning, DaemonAuthenticationFailed]).pipe(
	Schema.toTaggedUnion('type'),
)
export type DaemonProcessEvent = typeof DaemonProcessEvent.Type

export class DaemonProcessEventDecodeError extends Data.TaggedError('DaemonProcessEventDecodeError')<{
	readonly cause: unknown
}> {}

export const encodeDaemonProcessEvent = (event: DaemonProcessEvent): string =>
	JSON.stringify(Schema.encodeSync(DaemonProcessEvent)(event))

export const decodeDaemonProcessEventLine = Effect.fn('daemon_process_event.decode_line')(function* (input: {
	readonly line: string
}) {
	const encoded = yield* Effect.try({
		try: () => JSON.parse(input.line),
		catch: (cause) => new DaemonProcessEventDecodeError({ cause }),
	})
	return yield* Schema.decodeUnknownEffect(DaemonProcessEvent)(encoded).pipe(
		Effect.mapError((cause) => new DaemonProcessEventDecodeError({ cause })),
	)
})
