import { describe, it } from '@effect/vitest'
import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { getAutomationResultExitCode } from '@/lib/shutdown-exit-code'
import { makeAutomationLifecycleCoordinator } from '@/lifecycle/automation-lifecycle'

const defaultConfiguration = {
	shutdownOn: 'inactivity',
	inactivityMs: 120_000,
	onFailure: 'inactivity',
} as const

describe('automation lifecycle', () => {
	it.effect('resets inactivity for repeated persisted target activity without real-time waits', () =>
		Effect.gen(function* () {
			const lifecycle = yield* makeAutomationLifecycleCoordinator(defaultConfiguration)
			const resultFiber = yield* lifecycle.awaitResult.pipe(Effect.forkChild)

			yield* lifecycle.recordSessionActivity('running')
			yield* TestClock.adjust('90 seconds')
			yield* lifecycle.recordSessionActivity('running')
			yield* TestClock.adjust(119_999)
			expect(resultFiber.pollUnsafe()).toBeUndefined()

			yield* TestClock.adjust(2)
			expect(yield* Fiber.join(resultFiber)).toEqual({
				type: 'automation_complete',
				completionReason: 'inactivity',
				finalStatus: 'running',
			})
		}),
	)

	it.effect('keeps a failed target recoverable through continuation', () =>
		Effect.gen(function* () {
			const lifecycle = yield* makeAutomationLifecycleCoordinator(defaultConfiguration)
			const resultFiber = yield* lifecycle.awaitResult.pipe(Effect.forkChild)

			yield* lifecycle.recordSessionActivity('failed')
			yield* TestClock.adjust('60 seconds')
			yield* lifecycle.recordSessionActivity('resuming')
			yield* lifecycle.recordSessionActivity('running')
			yield* lifecycle.recordSessionActivity('ready_for_input')
			yield* TestClock.adjust(119_999)
			expect(resultFiber.pollUnsafe()).toBeUndefined()

			yield* TestClock.adjust(2)
			expect(yield* Fiber.join(resultFiber)).toEqual({
				type: 'automation_complete',
				completionReason: 'inactivity',
				finalStatus: 'ready_for_input',
			})
		}),
	)

	it.effect('stops when the session reaches ready_for_input', () =>
		Effect.gen(function* () {
			const lifecycle = yield* makeAutomationLifecycleCoordinator({
				...defaultConfiguration,
				shutdownOn: 'stop',
			})
			const resultFiber = yield* lifecycle.awaitResult.pipe(Effect.forkChild)

			yield* lifecycle.recordSessionActivity('ready_for_input')

			expect(yield* Fiber.join(resultFiber)).toEqual({
				type: 'automation_complete',
				completionReason: 'ready_for_input',
				finalStatus: 'ready_for_input',
			})
		}),
	)

	it.effect('stops immediately and nonzero when the configured failure policy is stop', () =>
		Effect.gen(function* () {
			const lifecycle = yield* makeAutomationLifecycleCoordinator({
				...defaultConfiguration,
				onFailure: 'stop',
			})
			const resultFiber = yield* lifecycle.awaitResult.pipe(Effect.forkChild)
			yield* lifecycle.recordSessionActivity('failed')

			const result = yield* Fiber.join(resultFiber)
			expect(result.completionReason).toBe('failed')
			expect(result.finalStatus).toBe('failed')
			expect(getAutomationResultExitCode(result)).toBe(1)
		}),
	)

	it.effect('interrupts immediately through the automation result boundary', () =>
		Effect.gen(function* () {
			const lifecycle = yield* makeAutomationLifecycleCoordinator(defaultConfiguration)
			const resultFiber = yield* lifecycle.awaitResult.pipe(Effect.forkChild)
			yield* lifecycle.recordSessionActivity('ready_for_input')
			yield* lifecycle.interrupt

			const result = yield* Fiber.join(resultFiber)
			expect(result.completionReason).toBe('interrupted')
			expect(result.finalStatus).toBe('ready_for_input')
			expect(getAutomationResultExitCode(result)).toBe(1)
		}),
	)

	it('maps every final session status to success only for ready_for_input', () => {
		const statuses: readonly SessionStatus[] = [
			'ready_for_launch',
			'waiting_for_workspace',
			'draft',
			'launching',
			'running',
			'failed',
			'ready_for_input',
			'needs_approval',
			'waiting_for_usage_limit',
			'interrupt_requested',
			'interrupted',
			'resuming',
			'lost',
		]

		for (const finalStatus of statuses) {
			expect(
				getAutomationResultExitCode({
					type: 'automation_complete',
					completionReason: 'inactivity',
					finalStatus,
				}),
			).toBe(finalStatus === 'ready_for_input' ? 0 : 1)
		}
	})
})
