import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

export type PtySignal = 'SIGTERM' | 'SIGKILL'

export class PtyAlreadyGoneError extends Data.TaggedError('PtyAlreadyGoneError')<{}> {}

export class PtySignalAttemptError extends Data.TaggedError('PtySignalAttemptError')<{
	readonly signal: PtySignal
	readonly method: 'process-group' | 'node-pty'
	readonly cause: unknown
}> {}

export class PtyTerminationError extends Data.TaggedError('PtyTerminationError')<{
	readonly ptyId: string
	readonly operation: 'kill' | 'shutdown'
	readonly signal: PtySignal
	readonly attempts: ReadonlyArray<PtySignalAttemptError>
}> {}

const isAlreadyGone = (cause: unknown): boolean => {
	if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false
	return cause.code === 'ESRCH'
}

const signalAttempt = (signal: PtySignal, method: 'process-group' | 'node-pty', call: () => void) =>
	Effect.try({
		try: () => {
			call()
			return 'sent' as const
		},
		catch: (cause) =>
			isAlreadyGone(cause) ? new PtyAlreadyGoneError() : new PtySignalAttemptError({ signal, method, cause }),
	}).pipe(Effect.catchTag('PtyAlreadyGoneError', () => Effect.succeed('gone' as const)))

export interface TerminatePtyInput {
	readonly ptyId: string
	readonly operation: 'kill' | 'shutdown'
	readonly signalProcessGroup: (signal: PtySignal) => void
	readonly signalPty: (signal: 'SIGKILL') => void
}

export const terminatePty = Effect.fn('pty.terminate')(function* (input: TerminatePtyInput) {
	const attempts: Array<PtySignalAttemptError> = []
	const tryGroupTerm = signalAttempt('SIGTERM', 'process-group', () => input.signalProcessGroup('SIGTERM')).pipe(
		Effect.tapError((error) => Effect.sync(() => attempts.push(error))),
	)
	const tryGroupKill = signalAttempt('SIGKILL', 'process-group', () => input.signalProcessGroup('SIGKILL')).pipe(
		Effect.tapError((error) => Effect.sync(() => attempts.push(error))),
	)
	const tryDirectKill = signalAttempt('SIGKILL', 'node-pty', () => input.signalPty('SIGKILL')).pipe(
		Effect.tapError((error) => Effect.sync(() => attempts.push(error))),
	)

	const termResult = yield* tryGroupTerm.pipe(
		Effect.catchTag('PtySignalAttemptError', () => Effect.succeed('failed' as const)),
	)
	if (termResult === 'gone') return

	yield* tryGroupKill.pipe(
		Effect.catchTag('PtySignalAttemptError', () => tryDirectKill),
		Effect.catchTag('PtySignalAttemptError', () =>
			Effect.fail(
				new PtyTerminationError({
					ptyId: input.ptyId,
					operation: input.operation,
					signal: 'SIGKILL',
					attempts,
				}),
			),
		),
	)
})
