import { Duration, Effect, Predicate, Schedule } from 'effect'

import type { WorkosError } from './services/workos/workos.errors'

// `retryable` is derived from the underlying SQLSTATE/connection code when the error is
// built — see `isTransientDbCause` / `AccessRequestDbError.fromCause` in access-request-errors.ts
// for the definition of a transient DB error in our context.
function isTransientDbError(error: { _tag: string; retryable?: boolean }): boolean {
	return error.retryable === true && Predicate.isTagged(error, 'AccessRequestDbError')
}

function isTransientWorkosError(error: WorkosError): boolean {
	return Predicate.isTagged(error, 'WorkosRateLimitError') || Predicate.isTagged(error, 'WorkosNetworkError')
}

const exponentialBackoff = (baseMs: number, maxRetries: number) =>
	Schedule.exponential(Duration.millis(baseMs)).pipe(Schedule.jittered, Schedule.upTo({ times: maxRetries }))

export const retryDbTransient = <A, E extends { _tag: string }, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.retry(effect, { schedule: exponentialBackoff(50, 3), while: isTransientDbError })

export const retryWorkosTransient = <A, E extends WorkosError, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.retry(effect, { schedule: exponentialBackoff(250, 3), while: isTransientWorkosError })
