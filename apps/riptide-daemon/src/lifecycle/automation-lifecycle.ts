import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { Clock, Effect, Queue, Ref } from 'effect'

import type { AutomationDaemonLifecycle } from '@/managed-daemon-start'

export type AutomationCompletionReason = 'ready_for_input' | 'inactivity' | 'failed' | 'interrupted'

export interface AutomationDaemonResult {
	readonly type: 'automation_complete'
	readonly completionReason: AutomationCompletionReason
	readonly finalStatus: SessionStatus | null
}

type AutomationLifecycleSignal = { readonly type: 'activity' } | { readonly type: 'interrupt' }

interface AutomationLifecycleState {
	readonly finalStatus: SessionStatus | null
	readonly lastActivityAt: number
}

export interface AutomationLifecycleCoordinator {
	readonly awaitResult: Effect.Effect<AutomationDaemonResult>
	readonly recordSessionActivity: (status: SessionStatus) => Effect.Effect<void>
	readonly interrupt: Effect.Effect<void>
}

const failureStatuses = new Set<SessionStatus>(['failed', 'interrupted', 'lost'])

const resultFromState = (
	state: AutomationLifecycleState,
	completionReason: AutomationCompletionReason,
): AutomationDaemonResult => ({
	type: 'automation_complete',
	completionReason,
	finalStatus: state.finalStatus,
})

const immediateResult = (
	configuration: AutomationDaemonLifecycle,
	state: AutomationLifecycleState,
): AutomationDaemonResult | null => {
	if (state.finalStatus !== null && failureStatuses.has(state.finalStatus) && configuration.onFailure === 'stop') {
		return resultFromState(state, 'failed')
	}
	if (state.finalStatus === 'ready_for_input' && configuration.shutdownOn === 'stop') {
		return resultFromState(state, 'ready_for_input')
	}
	return null
}

export const makeAutomationLifecycleCoordinator = Effect.fn('automation_lifecycle.make')(function* (
	configuration: AutomationDaemonLifecycle,
) {
	const signals = yield* Queue.unbounded<AutomationLifecycleSignal>()
	const createdAt = yield* Clock.currentTimeMillis
	const state = yield* Ref.make<AutomationLifecycleState>({
		finalStatus: null,
		lastActivityAt: createdAt,
	})

	const awaitResultFromCurrentState = (): Effect.Effect<AutomationDaemonResult> =>
		Effect.gen(function* () {
			const currentState = yield* Ref.get(state)
			const result = immediateResult(configuration, currentState)
			if (result !== null) return result

			const now = yield* Clock.currentTimeMillis
			const remainingInactivityMs = configuration.inactivityMs - (now - currentState.lastActivityAt)
			if (remainingInactivityMs <= 0) {
				return resultFromState(currentState, 'inactivity')
			}

			const signal = yield* Effect.raceFirst(
				Queue.take(signals),
				Effect.sleep(remainingInactivityMs).pipe(Effect.as({ type: 'deadline' as const })),
			)
			if (signal.type === 'interrupt') return resultFromState(yield* Ref.get(state), 'interrupted')
			return yield* Effect.suspend(awaitResultFromCurrentState)
		})

	return {
		awaitResult: awaitResultFromCurrentState(),
		recordSessionActivity: (status) =>
			Clock.currentTimeMillis.pipe(
				Effect.flatMap((occurredAt) =>
					Ref.update(state, () => ({ finalStatus: status, lastActivityAt: occurredAt })),
				),
				Effect.andThen(Queue.offer(signals, { type: 'activity' })),
				Effect.asVoid,
			),
		interrupt: Queue.offer(signals, { type: 'interrupt' }).pipe(Effect.asVoid),
	} satisfies AutomationLifecycleCoordinator
})
