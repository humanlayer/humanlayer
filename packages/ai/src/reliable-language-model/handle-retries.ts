import { Effect, Result } from 'effect'

import { retryEffect } from './retry-effect'
import { OnLmFailureService } from './services'

export function handleRetries<T>(doPrimary: () => PromiseLike<T>, doFallback: () => PromiseLike<T>) {
	return Effect.gen(function* () {
		const onLmFailure = yield* OnLmFailureService

		const primary = yield* retryEffect(doPrimary).pipe(Effect.result)
		if (Result.isSuccess(primary)) return primary.success

		const fallback = yield* retryEffect(doFallback).pipe(Effect.result)
		if (Result.isSuccess(fallback)) return fallback.success

		yield* Effect.sync(() => onLmFailure.onFailure(fallback.failure.cause))
		return yield* Effect.fail(fallback.failure)
	})
}
