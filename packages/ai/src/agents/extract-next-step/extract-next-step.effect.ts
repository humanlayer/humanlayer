import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import * as Sentry from '@sentry/core'
import { Context, Effect, Layer, Schedule } from 'effect'

import { NextStepExtractionError } from './errors'
import { extractNextStep } from './extract-next-step'

export class NextStepExtractor extends Context.Service<
	NextStepExtractor,
	{
		readonly extract: (messageContent: string) => Promise<NextStepSuggestion>
	}
>()('NextStepExtractor') {}

export const NextStepExtractorLive = Layer.succeed(NextStepExtractor, {
	extract: extractNextStep,
})

const retrySchedule = Schedule.exponential('500 millis').pipe(Schedule.upTo({ times: 2 }))

export const extractNextStepEffectWithService = (messageContent: string) =>
	Effect.gen(function* () {
		const extractor = yield* NextStepExtractor
		const result = yield* Effect.tryPromise({
			try: () => extractor.extract(messageContent),
			catch: (cause) =>
				new NextStepExtractionError({
					message: 'Failed to extract next step',
					cause,
				}),
		})

		if (result.extractionError) {
			return yield* Effect.fail(
				new NextStepExtractionError({
					message: result.extractionError,
					cause: result.extractionError,
				}),
			)
		}

		return result
	}).pipe(
		Effect.retry(retrySchedule),
		Effect.tapError((error) =>
			Effect.logError('[extractNextStepEffect] Failed after retries', error).pipe(
				Effect.andThen(
					Effect.sync(() => Sentry.captureException(error, { tags: { error_type: 'next_step_extraction' } })),
				),
			),
		),
	)

export const extractNextStepEffect = (messageContent: string) =>
	extractNextStepEffectWithService(messageContent).pipe(Effect.provide(NextStepExtractorLive))

export { NextStepExtractionError }
