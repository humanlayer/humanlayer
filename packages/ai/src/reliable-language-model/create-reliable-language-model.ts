import type { LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { Cause, Effect, Exit, Layer, Result, type Schedule } from 'effect'

import { handleRetries } from './handle-retries'
import type { LanguageModelCallError } from './retry-effect'
import { defaultLmRetrySchedule, LmRetryScheduleService, OnLmErrorService, OnLmFailureService } from './services'

export interface CreateReliableLanguageModelConfig {
	readonly primary: LanguageModelV3
	readonly secondary: LanguageModelV3
	readonly retrySchedule?: Schedule.Schedule<unknown, unknown>
	readonly onAnyError?: (error: unknown) => void
	readonly onFailure?: (error: unknown) => void
}

function runReliableEffect<T>(effect: Effect.Effect<T, LanguageModelCallError, never>): Promise<T> {
	return Effect.runPromiseExit(effect).then((exit) => {
		if (Exit.isSuccess(exit)) return exit.value
		const failure = Cause.findFail(exit.cause)
		if (Result.isSuccess(failure)) throw failure.success.error.cause
		throw Cause.squash(exit.cause)
	})
}

export function createReliableLanguageModel(config: CreateReliableLanguageModelConfig): LanguageModelV3 {
	const configLayer = Layer.mergeAll(
		Layer.succeed(LmRetryScheduleService, { schedule: config.retrySchedule ?? defaultLmRetrySchedule }),
		Layer.succeed(OnLmErrorService, { onError: config.onAnyError ?? (() => {}) }),
		Layer.succeed(OnLmFailureService, { onFailure: config.onFailure ?? (() => {}) }),
	)

	const middleware: LanguageModelV3Middleware = {
		specificationVersion: 'v3',
		wrapGenerate: (options) =>
			runReliableEffect(
				handleRetries(
					() => options.doGenerate(),
					() => config.secondary.doGenerate(options.params),
				).pipe(Effect.provide(configLayer)),
			),
		wrapStream: (options) =>
			runReliableEffect(
				handleRetries(
					() => options.doStream(),
					() => config.secondary.doStream(options.params),
				).pipe(Effect.provide(configLayer)),
			),
	}

	return wrapLanguageModel({
		model: config.primary,
		middleware,
	})
}
