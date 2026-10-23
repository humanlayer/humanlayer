import { describe, it } from '@effect/vitest'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import type { SessionWorkspaceSetupSchema } from '@humanlayer/riptide-api-contract/daemon/project-workspaces/get-session-workspace-setup'
import type { SessionStatus } from '@humanlayer/schemas/effect/session/session-status'
import { Duration, Effect, Layer, Queue, Ref } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { TestClock } from 'effect/testing'
import type z from 'zod/v4'

import {
	DaemonWorkspaceSessionSetupError,
	DaemonWorkspaceSessionSetupNotFound,
} from '@/effects/services/daemon-api/daemon-api.errors'
import { WorkspaceSessionLaunchActorsLive } from '@/effects/services/workspace-session-launch/workspace-session-launch-actors.layer'
import { WorkspaceSessionLaunchActors } from '@/effects/services/workspace-session-launch/workspace-session-launch-actors.service'
import {
	WorkspaceSessionLaunchHandoff,
	WorkspaceSessionRunner,
} from '@/effects/services/workspace-session-launch/workspace-session-runner.service'

import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'

type SessionSetup = z.infer<typeof SessionWorkspaceSetupSchema>
type AuthoritativeSession = SessionSetup | 'not_found' | 'api_failure'
const recheckInterval = Duration.seconds(2)
const workspaceId = '01990c8d-0000-7000-8000-00000000aaaa'
const identity = (sessionId: string) => ({ sessionId, workspaceId })
const setup = (input: { ready: boolean; sessionStatus: SessionStatus }): SessionSetup => ({
	workspaceId,
	sessionStatus: input.sessionStatus,
	defaultWorkingDirectory: '/tmp/workspace',
	ready: input.ready,
	repositories: [],
})

const ScheduleConfigLive = Layer.succeed(
	ConfigProvider.ConfigProvider,
	ConfigProvider.fromUnknown({
		RIPTIDE_WORKSPACE_LAUNCH_RECHECK_INTERVAL: '2 seconds',
		RIPTIDE_WORKSPACE_LAUNCH_FAILURE_RECHECK_CEILING: '30 seconds',
	}),
)

/**
 * Authoritative-world double: the API answers from `authoritative` and records waiting marks, and
 * a runner handoff moves the session to `launching` the way the real runner does, so a later
 * authoritative recheck sees it.
 */
const makeHarness = Effect.gen(function* () {
	const authoritative = yield* Ref.make(new Map<string, AuthoritativeSession>())
	const readinessChecks = yield* Queue.unbounded<string>()
	const waitingMarks = yield* Queue.unbounded<string>()
	const handoffAttempts = yield* Queue.unbounded<{
		sessionId: string
		outcome: WorkspaceSessionLaunchHandoff['_tag']
	}>()
	const nextHandoff = yield* Ref.make<WorkspaceSessionLaunchHandoff>(WorkspaceSessionLaunchHandoff.HandedOff())

	const setAuthoritative = (sessionId: string, value: AuthoritativeSession) =>
		Ref.update(authoritative, (current) => new Map(current).set(sessionId, value))

	const ApiLive = makeMockDaemonApiLayer({
		getSessionWorkspaceSetup: (input) =>
			Effect.gen(function* () {
				yield* Queue.offer(readinessChecks, input.sessionId)
				const entry = (yield* Ref.get(authoritative)).get(input.sessionId)
				if (entry === undefined || entry === 'not_found') {
					return yield* new DaemonWorkspaceSessionSetupNotFound({
						sessionId: input.sessionId,
						workspaceId: input.workspaceId,
					})
				}
				if (entry === 'api_failure') {
					return yield* new DaemonWorkspaceSessionSetupError({ cause: new Error('api unavailable') })
				}
				return entry
			}),
		updateSession: (input) =>
			Effect.gen(function* () {
				if (input.status !== 'waiting_for_workspace') {
					return yield* Effect.die(`unexpected session update: ${String(input.status)}`)
				}
				yield* Queue.offer(waitingMarks, input.sessionId)
				return { success: true, transactionId: 'tx' }
			}),
	})
	const RunnerLive = Layer.succeed(WorkspaceSessionRunner, {
		handOffReadySession: ({ sessionId }) =>
			Effect.gen(function* () {
				const outcome = yield* Ref.get(nextHandoff)
				yield* Queue.offer(handoffAttempts, { sessionId, outcome: outcome._tag })
				if (outcome._tag === 'HandedOff') {
					yield* Ref.update(authoritative, (current) => {
						const entry = current.get(sessionId)
						if (entry === undefined || entry === 'not_found' || entry === 'api_failure') return current
						return new Map(current).set(sessionId, { ...entry, sessionStatus: 'launching' })
					})
				}
				return outcome
			}),
	})
	const layer = WorkspaceSessionLaunchActorsLive.pipe(
		Layer.provideMerge(Layer.mergeAll(ApiLive, RunnerLive, ActorSystemDefault, ScheduleConfigLive)),
	)

	return {
		layer,
		readinessChecks,
		waitingMarks,
		handoffAttempts,
		nextHandoff,
		setAuthoritative,
	}
})

describe('WorkspaceSessionLaunchActors', () => {
	it.effect('marks a session waiting once and hands it off exactly once across duplicate hints', ({ expect }) =>
		Effect.gen(function* () {
			const harness = yield* makeHarness
			const sessionId = 'session-duplicate-hints'
			yield* harness.setAuthoritative(sessionId, setup({ ready: false, sessionStatus: 'ready_for_launch' }))

			yield* Effect.gen(function* () {
				const actors = yield* WorkspaceSessionLaunchActors
				yield* Effect.forEach(
					[identity(sessionId), identity(sessionId), identity(sessionId)],
					actors.ensureLaunchActor,
					{ concurrency: 'unbounded', discard: true },
				)
				expect(yield* Queue.take(harness.readinessChecks)).toBe(sessionId)
				expect(yield* Queue.take(harness.waitingMarks)).toBe(sessionId)
				yield* actors.waitForLaunchActorState({ sessionId, state: 'Waiting' })

				// Readiness flips; the timed authoritative recheck sees it and hands off once.
				yield* harness.setAuthoritative(
					sessionId,
					setup({ ready: true, sessionStatus: 'waiting_for_workspace' }),
				)
				yield* TestClock.adjust(recheckInterval)
				expect(yield* Queue.take(harness.handoffAttempts)).toEqual({ sessionId, outcome: 'HandedOff' })
				yield* actors.waitForLaunchActorExit({ sessionId })

				// A late hint spawns a fresh actor that stops on the authoritative `launching` status.
				yield* actors.ensureLaunchActor(identity(sessionId))
				yield* actors.waitForLaunchActorExit({ sessionId })
				expect(yield* Queue.size(harness.handoffAttempts)).toBe(0)
				expect(yield* Queue.size(harness.waitingMarks)).toBe(0)
			}).pipe(Effect.provide(harness.layer))
		}),
	)

	it.effect(
		'backs off after readiness-check failures and stops without a handoff once the session is gone',
		({ expect }) =>
			Effect.gen(function* () {
				const harness = yield* makeHarness
				const sessionId = 'session-flaky-api'
				yield* harness.setAuthoritative(sessionId, 'api_failure')

				yield* Effect.gen(function* () {
					const actors = yield* WorkspaceSessionLaunchActors
					yield* actors.ensureLaunchActor(identity(sessionId))
					expect(yield* Queue.take(harness.readinessChecks)).toBe(sessionId)
					yield* actors.waitForLaunchActorState({ sessionId, state: 'Waiting' })

					// First failure doubles the recheck delay: nothing at 2s, a recheck by 4s.
					yield* TestClock.adjust(recheckInterval)
					expect(yield* Queue.size(harness.readinessChecks)).toBe(0)
					yield* TestClock.adjust(recheckInterval)
					expect(yield* Queue.take(harness.readinessChecks)).toBe(sessionId)
					yield* actors.waitForLaunchActorState({ sessionId, state: 'Waiting' })

					yield* harness.setAuthoritative(sessionId, 'not_found')
					yield* TestClock.adjust(Duration.times(recheckInterval, 4))
					expect(yield* Queue.take(harness.readinessChecks)).toBe(sessionId)
					yield* actors.waitForLaunchActorExit({ sessionId })
					expect(yield* Queue.size(harness.handoffAttempts)).toBe(0)
					expect(yield* Queue.size(harness.waitingMarks)).toBe(0)

					// The finished actor was deregistered, so a fresh hint launches once readiness exists.
					yield* harness.setAuthoritative(
						sessionId,
						setup({ ready: true, sessionStatus: 'ready_for_launch' }),
					)
					yield* actors.ensureLaunchActor(identity(sessionId))
					expect(yield* Queue.take(harness.handoffAttempts)).toEqual({ sessionId, outcome: 'HandedOff' })
					yield* actors.waitForLaunchActorExit({ sessionId })
				}).pipe(Effect.provide(harness.layer))
			}),
	)

	it.effect('retries a deferred handoff later and treats a skipped handoff as final', ({ expect }) =>
		Effect.gen(function* () {
			const harness = yield* makeHarness
			const deferred = 'session-not-synced-yet'
			const skipped = 'session-taken-elsewhere'
			yield* harness.setAuthoritative(deferred, setup({ ready: true, sessionStatus: 'waiting_for_workspace' }))
			yield* harness.setAuthoritative(skipped, setup({ ready: true, sessionStatus: 'waiting_for_workspace' }))

			yield* Effect.gen(function* () {
				const actors = yield* WorkspaceSessionLaunchActors
				yield* Ref.set(
					harness.nextHandoff,
					WorkspaceSessionLaunchHandoff.Deferred({ reason: 'session_not_synced' }),
				)
				yield* actors.ensureLaunchActor(identity(deferred))
				expect(yield* Queue.take(harness.handoffAttempts)).toEqual({ sessionId: deferred, outcome: 'Deferred' })
				yield* actors.waitForLaunchActorState({ sessionId: deferred, state: 'Waiting' })

				yield* Ref.set(harness.nextHandoff, WorkspaceSessionLaunchHandoff.HandedOff())
				yield* TestClock.adjust(recheckInterval)
				expect(yield* Queue.take(harness.handoffAttempts)).toEqual({
					sessionId: deferred,
					outcome: 'HandedOff',
				})
				yield* actors.waitForLaunchActorExit({ sessionId: deferred })

				yield* Ref.set(
					harness.nextHandoff,
					WorkspaceSessionLaunchHandoff.Skipped({ reason: 'local_status_running' }),
				)
				yield* actors.ensureLaunchActor(identity(skipped))
				expect(yield* Queue.take(harness.handoffAttempts)).toEqual({ sessionId: skipped, outcome: 'Skipped' })
				yield* actors.waitForLaunchActorExit({ sessionId: skipped })
				yield* TestClock.adjust(Duration.times(recheckInterval, 4))
				expect(yield* Queue.size(harness.handoffAttempts)).toBe(0)
				expect(yield* Queue.size(harness.waitingMarks)).toBe(0)
			}).pipe(Effect.provide(harness.layer))
		}),
	)
})
