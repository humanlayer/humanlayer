import { Data, Effect } from 'effect'

import { LmRetryScheduleService, OnLmErrorService } from './services'

export class LanguageModelCallError extends Data.TaggedError('LanguageModelCallError')<{
	readonly cause: unknown
}> {}

export function retryEffect<T>(action: () => PromiseLike<T>) {
	return Effect.gen(function* () {
		const onLmError = yield* OnLmErrorService
		const lmRetrySchedule = yield* LmRetryScheduleService

		return yield* Effect.tryPromise({
			try: () => Promise.resolve(action()),
			catch: (cause) => new LanguageModelCallError({ cause }),
		}).pipe(
			Effect.tapError((error) => Effect.sync(() => onLmError.onError(error.cause))),
			Effect.retry(lmRetrySchedule.schedule),
		)
	})
}
