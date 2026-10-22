import { describe, it } from '@effect/vitest'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { Task } from '@humanlayer/db/tables/tasks'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { Deferred, Effect, Layer, Queue } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import { DaemonCollectionsLive } from '@/effects/services/daemon-collections/daemon-collections.layer'
import { SessionLaunchExecutor } from '@/effects/services/session-runs/session-launch-executor.service'
import { SessionRunRegistry, SessionRunRegistryLive } from '@/effects/services/session-runs/session-run-registry'
import { WorkspaceSessionRunnerLive } from '@/effects/services/workspace-session-launch/workspace-session-runner.layer'
import { WorkspaceSessionRunner } from '@/effects/services/workspace-session-launch/workspace-session-runner.service'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { createTestSession } from '../helpers/session-fixtures'

const taskId = '00000000-0000-4000-8000-000000000223'
const task = { id: taskId, workspace_id: '00000000-0000-4000-8000-000000000224' } as Task

/**
 * Real registry and real collections; the executor is a recording fake whose run never ends on
 * its own, so the test controls exactly when a run finishes or is interrupted.
 */
const makeHarness = Effect.gen(function* () {
	const sessions = createCollection(localOnlyCollectionOptions<Session>({ getKey: (row) => row.id }))
	const tasks = createCollection(localOnlyCollectionOptions<Task>({ getKey: (row) => row.id }))
	yield* Effect.addFinalizer(() =>
		Effect.promise(async () => {
			await sessions.cleanup()
			await tasks.cleanup()
		}),
	)
	const defaults = createMockDaemonServices()
	yield* Effect.addFinalizer(() => Effect.promise(() => defaults.daemonRuntime.dispose()))
	const collections = { ...defaults.collections, sessions, tasks } as unknown as DaemonServices['collections']

	const started = yield* Queue.unbounded<string>()
	const interrupted = yield* Queue.unbounded<string>()
	const finishRun = yield* Deferred.make<void>()
	const ExecutorFake = Layer.succeed(SessionLaunchExecutor, {
		executeSessionLaunch: ({ session }) =>
			Queue.offer(started, session.id).pipe(
				Effect.andThen(Deferred.await(finishRun)),
				Effect.onInterrupt(() => Queue.offer(interrupted, session.id)),
			),
	})
	const dependencies = Layer.mergeAll(SessionRunRegistryLive, ExecutorFake, DaemonCollectionsLive(collections))
	const runner = WorkspaceSessionRunnerLive
	const session = createTestSession({ task_id: taskId, status: 'waiting_for_workspace' })
	return { sessions, tasks, session, started, interrupted, finishRun, dependencies, runner }
})

describe('WorkspaceSessionRunnerLive', () => {
	it.effect('defers until rows sync, hands off exactly once, and skips while the run is in flight', ({ expect }) =>
		Effect.gen(function* () {
			const h = yield* makeHarness
			yield* Effect.gen(function* () {
				const runner = yield* WorkspaceSessionRunner
				const registry = yield* SessionRunRegistry
				const handOff = runner.handOffReadySession({ sessionId: h.session.id })
				const inFlight = registry.isSessionRunInFlight({ sessionId: h.session.id })

				expect(yield* handOff).toEqual({ _tag: 'Deferred', reason: 'session_not_synced' })
				h.sessions.insert(h.session)
				expect(yield* handOff).toEqual({ _tag: 'Deferred', reason: 'task_not_synced' })
				h.tasks.insert(task)

				expect(yield* handOff).toEqual({ _tag: 'HandedOff' })
				expect(yield* Queue.take(h.started)).toBe(h.session.id)
				expect(yield* inFlight).toBe(true)
				// A second handoff for the same session never starts a second run.
				expect(yield* handOff).toEqual({ _tag: 'Skipped', reason: 'session_run_in_flight' })
				expect(yield* Queue.size(h.started)).toBe(0)

				h.sessions.update(h.session.id, (row) => {
					row.status = 'running'
				})
				expect(yield* handOff).toEqual({ _tag: 'Skipped', reason: 'local_status_running' })
			}).pipe(Effect.provide(h.runner), Effect.provide(h.dependencies))
		}).pipe(Effect.scoped),
	)

	it.effect('interrupts handed-off runs and releases the registry when the runner layer shuts down', ({ expect }) =>
		Effect.gen(function* () {
			const h = yield* makeHarness
			h.tasks.insert(task)
			h.sessions.insert(h.session)
			// The registry outlives the runner layer, as it does in the daemon, so its view of the
			// session after shutdown is observable.
			yield* Effect.gen(function* () {
				const registry = yield* SessionRunRegistry
				yield* Effect.gen(function* () {
					const runner = yield* WorkspaceSessionRunner
					expect(yield* runner.handOffReadySession({ sessionId: h.session.id })).toEqual({
						_tag: 'HandedOff',
					})
					expect(yield* Queue.take(h.started)).toBe(h.session.id)
					expect(yield* registry.isSessionRunInFlight({ sessionId: h.session.id })).toBe(true)
				}).pipe(Effect.provide(h.runner))
				// Leaving the provided block closed the runner layer's scope.
				expect(yield* Queue.take(h.interrupted)).toBe(h.session.id)
				expect(yield* registry.isSessionRunInFlight({ sessionId: h.session.id })).toBe(false)
			}).pipe(Effect.provide(h.dependencies))
		}).pipe(Effect.scoped),
	)
})
