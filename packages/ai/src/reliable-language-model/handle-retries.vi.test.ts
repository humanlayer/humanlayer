import { describe, effect, expect, vi } from '@effect/vitest'
import { Effect, Exit, Layer, Schedule } from 'effect'

import { handleRetries } from './handle-retries'
import { LmRetryScheduleService, OnLmErrorService, OnLmFailureService } from './services'

type Outcome<T> = { readonly fail: unknown } | { readonly succeed: T }

function makeAction<T>(outcomes: ReadonlyArray<Outcome<T>>) {
	let attempt = 0
	return vi.fn(() => {
		const outcome = outcomes[attempt++]
		if (!outcome) return Promise.reject(new Error('unexpected extra attempt'))
		if ('fail' in outcome) return Promise.reject(outcome.fail)
		return Promise.resolve(outcome.succeed)
	})
}

function makeTestLayer({
	schedule = Schedule.recurs(0),
	onAnyError = vi.fn(),
	onFailure = vi.fn(),
}: {
	readonly schedule?: Schedule.Schedule<unknown, unknown>
	readonly onAnyError?: (error: unknown) => void
	readonly onFailure?: (error: unknown) => void
} = {}) {
	return Layer.mergeAll(
		Layer.succeed(LmRetryScheduleService, { schedule }),
		Layer.succeed(OnLmErrorService, { onError: onAnyError }),
		Layer.succeed(OnLmFailureService, { onFailure }),
	)
}

describe('handleRetries', () => {
	effect('returns primary result without calling fallback', () =>
		Effect.gen(function* () {
			const onFailure = vi.fn()
			const primary = makeAction([{ succeed: 'primary' }])
			const fallback = makeAction([{ succeed: 'fallback' }])

			const result = yield* handleRetries(primary, fallback).pipe(Effect.provide(makeTestLayer({ onFailure })))

			expect(result).toBe('primary')
			expect(primary).toHaveBeenCalledTimes(1)
			expect(fallback).not.toHaveBeenCalled()
			expect(onFailure).not.toHaveBeenCalled()
		}),
	)

	effect('retries primary before trying fallback', () =>
		Effect.gen(function* () {
			const onFailure = vi.fn()
			const primary = makeAction([{ fail: new Error('primary first') }, { succeed: 'primary retry' }])
			const fallback = makeAction([{ succeed: 'fallback' }])

			const result = yield* handleRetries(primary, fallback).pipe(
				Effect.provide(makeTestLayer({ schedule: Schedule.recurs(1), onFailure })),
			)

			expect(result).toBe('primary retry')
			expect(primary).toHaveBeenCalledTimes(2)
			expect(fallback).not.toHaveBeenCalled()
			expect(onFailure).not.toHaveBeenCalled()
		}),
	)

	effect('uses fallback after primary exhausts', () =>
		Effect.gen(function* () {
			const onFailure = vi.fn()
			const primary = makeAction<string>([{ fail: new Error('primary') }])
			const fallback = makeAction([{ succeed: 'fallback' }])

			const result = yield* handleRetries(primary, fallback).pipe(Effect.provide(makeTestLayer({ onFailure })))

			expect(result).toBe('fallback')
			expect(primary).toHaveBeenCalledTimes(1)
			expect(fallback).toHaveBeenCalledTimes(1)
			expect(onFailure).not.toHaveBeenCalled()
		}),
	)

	effect('calls onFailure once with the final fallback error when both paths exhaust', () =>
		Effect.gen(function* () {
			const primaryError = new Error('primary')
			const fallbackError = new Error('fallback')
			const onAnyError = vi.fn()
			const onFailure = vi.fn()
			const primary = makeAction<string>([{ fail: primaryError }])
			const fallback = makeAction<string>([{ fail: fallbackError }])

			const exit = yield* handleRetries(primary, fallback).pipe(
				Effect.provide(makeTestLayer({ onAnyError, onFailure })),
				Effect.exit,
			)

			expect(Exit.isFailure(exit)).toBe(true)
			expect(onAnyError).toHaveBeenCalledTimes(2)
			expect(onAnyError).toHaveBeenNthCalledWith(1, primaryError)
			expect(onAnyError).toHaveBeenNthCalledWith(2, fallbackError)
			expect(onFailure).toHaveBeenCalledTimes(1)
			expect(onFailure).toHaveBeenCalledWith(fallbackError)
		}),
	)
})
