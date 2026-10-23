import { describe, it } from '@effect/vitest'
import type { Session } from '@humanlayer/db/tables/sessions'
import type { Task } from '@humanlayer/db/tables/tasks'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { Effect, Fiber, Layer, Queue, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import type { DaemonServices } from '@/agents/claudecode/types'
import { DaemonCollectionsLive } from '@/effects/services/daemon-collections/daemon-collections.layer'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { SessionRunRegistry, SessionRunRegistryLive } from '@/effects/services/session-runs/session-run-registry'
import { WorkspaceSessionLaunchActorsLive } from '@/effects/services/workspace-session-launch/workspace-session-launch-actors.layer'
import { WorkspaceSessionLaunchActors } from '@/effects/services/workspace-session-launch/workspace-session-launch-actors.service'
import { WorkspaceSessionRunnerLive } from '@/effects/services/workspace-session-launch/workspace-session-runner.layer'
import { WorkspaceSessionRunner } from '@/effects/services/workspace-session-launch/workspace-session-runner.service'
import { handleLaunchSession } from '@/handlers/sessions/on-session-launch'
import {
	makeLegacySessionLaunchExecutorLive,
	processSessionChange,
	processTaskChange,
	superviseDaemonSubscriptionConsumer,
} from '@/subscriptions'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { createTestSession } from '../helpers/session-fixtures'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'
import { createMockORPCClient } from '../mocks/orpc-client.mock'

const taskId = '00000000-0000-4000-8000-000000000123'
const workspaceId = '00000000-0000-4000-8000-000000000124'
const task: Task = {
	id: taskId,
	organization_id: '00000000-0000-4000-8000-000000000002',
	workspace_id: workspaceId,
	project_id: null,
	team_id: null,
	created_by: 'user-1',
	resource_owner_user_id: 'user-1',
	created_at: 0n,
	updated_at: 0n,
	name: 'Synced task',
	slug: null,
	default_working_directory: null,
	external_task_id: null,
	archived: false,
	is_draft: false,
	setup_status: null,
	setup_details: null,
	ticket_id: null,
	ticket_url: null,
	ticket_description: null,
	ticket_provider: null,
	github_connection_id: null,
	ticket_repository_id: null,
	ticket_repository_full_name: null,
	created_with_experiment_flags: null,
	workflow_type: 'rpi',
	worktree_timing: 'later',
	workspace_state: null,
	workspace_spec: null,
	auto_advance_questions_to_research: false,
	auto_advance_research_to_design: false,
	auto_advance_plan_to_worktree: false,
	auto_advance_worktree_to_implementation: false,
	auto_advance_implementation_to_pr: false,
	slack_notifications_muted: false,
}

const makeHarness = Effect.gen(function* () {
	const sessions = createCollection(localOnlyCollectionOptions<Session>({ getKey: (row) => row.id }))
	const tasks = createCollection(localOnlyCollectionOptions<Task>({ getKey: (row) => row.id }))
	yield* Effect.addFinalizer(() =>
		Effect.promise(async () => {
			await sessions.cleanup()
			await tasks.cleanup()
		}),
	)
	const launches = yield* Queue.unbounded<string>()
	const checks = yield* Queue.unbounded<string>()
	let authoritativeStatus: Session['status'] = 'waiting_for_workspace'
	const orpc = createMockORPCClient({
		sessions: {
			update: async (input: Parameters<DaemonServices['orpc']['sessions']['update']>[0]) => {
				if (input.status !== 'launching') throw new Error(`Unexpected update: ${input.status}`)
				authoritativeStatus = 'launching'
				Queue.offerUnsafe(launches, input.sessionId)
				// Hold the real runner at its launch write; scope interruption releases its fiber.
				return await new Promise<never>(() => {})
			},
		},
	})
	const defaults = createMockDaemonServices({ orpc })
	yield* Effect.addFinalizer(() => Effect.promise(() => defaults.daemonRuntime.dispose()))
	// Local-only collections exercise real TanStack replay/change delivery. Electric-only utils
	// are irrelevant at this seam; the production streams consume subscribeChanges/toArray.
	const collections = { ...defaults.collections, sessions, tasks } as unknown as DaemonServices['collections']
	const services = { ...defaults, collections }
	const api = makeMockDaemonApiLayer({
		getSessionWorkspaceSetup: ({ sessionId }) =>
			Queue.offer(checks, sessionId).pipe(
				Effect.map(() => ({
					workspaceId,
					sessionStatus: authoritativeStatus,
					ready: true,
					defaultWorkingDirectory: '/tmp',
					repositories: [],
				})),
			),
	})
	// Session runs are composed exactly as initializeSubscriptions composes them: one registry
	// shared by legacy and V2 paths, and the legacy executor as the only holder of DaemonServices.
	const collectionsLayer = DaemonCollectionsLive(collections)
	const sessionRuns = WorkspaceSessionRunnerLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(SessionRunRegistryLive, makeLegacySessionLaunchExecutorLive(services), collectionsLayer),
		),
	)
	const layer = Layer.mergeAll(
		sessionRuns,
		WorkspaceSessionLaunchActorsLive.pipe(Layer.provideMerge(Layer.mergeAll(ActorSystemDefault, api))),
	)
	const lifecycle = {
		reconcileSessionChanges: () => undefined,
		reconcileTaskChanges: () => undefined,
		reconcileAllTasks: () => undefined,
	}
	const consumeSessions = (count: number) =>
		Effect.gen(function* () {
			const collection = yield* DaemonCollections
			yield* collection.sessionChanges.pipe(
				Stream.take(count),
				Stream.mapEffect((change) => processSessionChange(change, services, lifecycle)),
				Stream.runDrain,
			)
		})
	const consumeTasks = Effect.gen(function* () {
		const collection = yield* DaemonCollections
		yield* collection.taskChanges.pipe(
			Stream.take(1),
			Stream.mapEffect((change) => processTaskChange(change, services, lifecycle)),
			Stream.runDrain,
		)
	})
	const session = createTestSession({ task_id: taskId, status: 'waiting_for_workspace' })
	return { sessions, tasks, services, session, launches, checks, layer, consumeSessions, consumeTasks }
})

describe('V2 recovery from synced collections', () => {
	it.effect('launches initial waiting rows and ignores duplicate session/task replay', ({ expect }) =>
		Effect.gen(function* () {
			const h = yield* makeHarness
			h.tasks.insert(task)
			h.sessions.insert(h.session)
			yield* Effect.gen(function* () {
				yield* h.consumeSessions(1)
				expect(yield* Queue.take(h.launches)).toBe(h.session.id)
				const actors = yield* WorkspaceSessionLaunchActors
				yield* actors.waitForLaunchActorExit({ sessionId: h.session.id })
				// Reacquiring the same domain streams replays the unchanged waiting row, as on
				// consumer recovery. The authoritative launch write prevents another handoff.
				yield* h.consumeSessions(1)
				yield* actors.waitForLaunchActorExit({ sessionId: h.session.id })
				yield* h.consumeTasks
				yield* actors.waitForLaunchActorExit({ sessionId: h.session.id })
				expect(yield* Queue.size(h.launches)).toBe(0)
				const registry = yield* SessionRunRegistry
				expect(yield* registry.isSessionRunInFlight({ sessionId: h.session.id })).toBe(true)
			}).pipe(Effect.provide(h.layer))
		}).pipe(Effect.scoped),
	)

	it.effect('defers a session until its task arrives, including at the runner boundaries', ({ expect }) =>
		Effect.gen(function* () {
			const h = yield* makeHarness
			h.sessions.insert(h.session)
			yield* Effect.gen(function* () {
				yield* h.consumeSessions(1)
				expect(yield* Queue.size(h.checks)).toBe(0)
				const runner = yield* WorkspaceSessionRunner
				expect(yield* runner.handOffReadySession({ sessionId: h.session.id })).toEqual({
					_tag: 'Deferred',
					reason: 'task_not_synced',
				})
				yield* Effect.promise(() => handleLaunchSession({ type: 'insert', value: h.session }, h.services))
				expect(yield* Queue.size(h.launches)).toBe(0)
				const consumer = yield* h.consumeTasks.pipe(Effect.forkChild)
				h.tasks.insert(task)
				yield* Fiber.join(consumer)
				expect(yield* Queue.take(h.launches)).toBe(h.session.id)
			}).pipe(Effect.provide(h.layer))
		}).pipe(Effect.scoped),
	)

	it.effect(
		'recovers an unchanged waiting session after consumer failure and task sync during backoff',
		({ expect }) =>
			Effect.gen(function* () {
				const h = yield* makeHarness
				h.sessions.insert(h.session)
				yield* Effect.gen(function* () {
					const disconnected = yield* Queue.unbounded<void>()
					let attempt = 0
					const consumer = yield* superviseDaemonSubscriptionConsumer(() =>
						Effect.gen(function* () {
							attempt += 1
							yield* h.consumeSessions(1)
							if (attempt === 1) {
								yield* Queue.offer(disconnected, undefined)
								return yield* Effect.fail('source failed')
							}
							return yield* Effect.never
						}),
					).pipe(Effect.forkScoped)
					yield* Queue.take(disconnected)
					expect(yield* Queue.size(h.launches)).toBe(0)
					// No task consumer is attached: recovery must use includeInitialState replay.
					h.tasks.insert(task)
					yield* TestClock.adjust('1 second')
					expect(yield* Queue.take(h.launches)).toBe(h.session.id)
					expect(attempt).toBe(2)
					yield* Fiber.interrupt(consumer)
				}).pipe(Effect.provide(h.layer))
			}).pipe(Effect.scoped),
	)
})
