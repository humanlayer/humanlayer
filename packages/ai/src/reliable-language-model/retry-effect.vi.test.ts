import { describe, effect, expect, vi } from '@effect/vitest'
import { Duration, Effect, Exit, Fiber, Layer, Schedule } from 'effect'
import { TestClock } from 'effect/testing'

import { retryEffect } from './retry-effect'
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

describe('retryEffect', () => {
	effect('succeeds on the first attempt without calling onAnyError', () =>
		Effect.gen(function* () {
			const onAnyError = vi.fn()
			const action = makeAction([{ succeed: 'ok' }])

			const result = yield* retryEffect(action).pipe(Effect.provide(makeTestLayer({ onAnyError })))

			expect(result).toBe('ok')
			expect(action).toHaveBeenCalledTimes(1)
			expect(onAnyError).not.toHaveBeenCalled()
		}),
	)

	effect('calls onAnyError for failed attempts before a later success', () =>
		Effect.gen(function* () {
			const first = new Error('first')
			const second = new Error('second')
			const onAnyError = vi.fn()
			const action = makeAction([{ fail: first }, { fail: second }, { succeed: 'ok' }])

			const result = yield* retryEffect(action).pipe(
				Effect.provide(makeTestLayer({ schedule: Schedule.recurs(2), onAnyError })),
			)

			expect(result).toBe('ok')
			expect(action).toHaveBeenCalledTimes(3)
			expect(onAnyError).toHaveBeenCalledTimes(2)
			expect(onAnyError).toHaveBeenNthCalledWith(1, first)
			expect(onAnyError).toHaveBeenNthCalledWith(2, second)
		}),
	)

	effect('fails with the final error when the schedule is exhausted', () =>
		Effect.gen(function* () {
			const first = new Error('first')
			const final = new Error('final')
			const onAnyError = vi.fn()
			const action = makeAction<string>([{ fail: first }, { fail: final }])

			const exit = yield* retryEffect(action).pipe(
				Effect.provide(makeTestLayer({ schedule: Schedule.recurs(1), onAnyError })),
				Effect.exit,
			)

			expect(Exit.isFailure(exit)).toBe(true)
			expect(action).toHaveBeenCalledTimes(2)
			expect(onAnyError).toHaveBeenCalledTimes(2)
			expect(onAnyError).toHaveBeenNthCalledWith(1, first)
			expect(onAnyError).toHaveBeenNthCalledWith(2, final)
		}),
	)

	effect('uses the test clock for delayed schedules', () =>
		Effect.gen(function* () {
			const onAnyError = vi.fn()
			const action = makeAction([{ fail: new Error('first') }, { fail: new Error('second') }, { succeed: 'ok' }])
			const schedule = Schedule.exponential(Duration.millis(250)).pipe(Schedule.upTo({ times: 2 }))

			const fiber = yield* retryEffect(action).pipe(
				Effect.provide(makeTestLayer({ schedule, onAnyError })),
				Effect.forkChild,
			)

			yield* TestClock.adjust(Duration.millis(0))
			expect(action).toHaveBeenCalledTimes(1)
			yield* TestClock.adjust(Duration.millis(250))
			expect(action).toHaveBeenCalledTimes(2)
			yield* TestClock.adjust(Duration.millis(500))

			const result = yield* Fiber.join(fiber)
			expect(result).toBe('ok')
			expect(action).toHaveBeenCalledTimes(3)
			expect(onAnyError).toHaveBeenCalledTimes(2)
		}),
	)
})
