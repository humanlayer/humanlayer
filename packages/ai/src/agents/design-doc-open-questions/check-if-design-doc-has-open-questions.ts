import * as Sentry from '@sentry/core'
import { Context, Data, Effect, Layer, Schedule } from 'effect'

import { type DesignDocQuestionCounts, inferDesignDocQuestionCounts } from './design-doc-open-questions'

export class DesignQuestionInferenceError extends Data.TaggedError('DesignQuestionInferenceError')<{
	message: string
	cause?: unknown
}> {}

export class DesignDocQuestionCounter extends Context.Service<
	DesignDocQuestionCounter,
	{
		readonly count: (docContent: string) => Promise<DesignDocQuestionCounts>
	}
>()('DesignDocQuestionCounter') {}

export const DesignDocQuestionCounterLive = Layer.succeed(DesignDocQuestionCounter, {
	count: inferDesignDocQuestionCounts,
})

const retrySchedule = Schedule.exponential('500 millis').pipe(Schedule.upTo({ times: 2 }))

export const checkIfDesignDocHasOpenQuestionsWithService = (docContent: string) =>
	Effect.gen(function* () {
		const counter = yield* DesignDocQuestionCounter
		return yield* Effect.tryPromise({
			try: () => counter.count(docContent),
			catch: (cause) =>
				new DesignQuestionInferenceError({
					message: 'Failed to count design questions',
					cause,
				}),
		})
	}).pipe(
		Effect.retry(retrySchedule),
		Effect.tapError((error) =>
			Effect.logError('[checkIfDesignDocHasOpenQuestions] Failed after retries', error).pipe(
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureException(error, { tags: { error_type: 'design_question_inference' } }),
					),
				),
			),
		),
	)

export const checkIfDesignDocHasOpenQuestions = (docContent: string) =>
	checkIfDesignDocHasOpenQuestionsWithService(docContent).pipe(Effect.provide(DesignDocQuestionCounterLive))
