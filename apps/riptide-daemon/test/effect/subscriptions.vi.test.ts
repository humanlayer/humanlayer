import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Queue, type Scope, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import type { DaemonServices } from '@/agents/claudecode/types'
import type { DaemonRuntime } from '@/effects/runtime'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { SessionRunRegistry } from '@/effects/services/session-runs/session-run-registry'
import type { TaskDiffCollectionLifecycle } from '@/effects/services/task-diff/task-diff-collection-lifecycle'
import {
	processSessionChange,
	processWorkspaceSessionChange,
	superviseDaemonSubscriptionConsumer,
} from '@/subscriptions'

import { createMockDaemonServices } from '../helpers/create-mock-daemon-services'
import { makeSessionChange } from '../helpers/session-fixtures'
import { UnusedWorkspaceSessionLaunchActorsLive } from '../helpers/unused-workspace-session-launch-actors'

/** None of these tests routes a V2 session, so the launch-actor dependency is satisfied by a dying stub. */
const scopedWithoutV2Routing = <A, E, R>(effect: Effect.Effect<A, E, R | Scope.Scope>) =>
	Effect.scoped(effect).pipe(Effect.provide(UnusedWorkspaceSessionLaunchActorsLive))

describe('daemon subscriptions', () => {
	it.effect('stops live Claude sessions when their rows are archived or deleted', ({ expect }) =>
		scopedWithoutV2Routing(
			Effect.gen(function* () {
				const stoppedSessionIds = yield* Queue.unbounded<string>()
				const daemonRuntime = ManagedRuntime.make(
					Layer.succeed(ClaudeSessions, {
						executeClaudeSession: () => Effect.die('Unexpected Claude session execution'),
						deliverFollowUpMessage: () => Effect.die('Unexpected Claude follow-up delivery'),
						stopClaudeSession: ({ sessionId }) =>
							Queue.offer(stoppedSessionIds, sessionId).pipe(Effect.as('stopped' as const)),
						shutdownActiveClaudeSessions: Effect.void,
						activeSessionIds: Effect.succeed([]),
					}),
				)
				yield* Effect.addFinalizer(() => Effect.promise(() => daemonRuntime.dispose()))
				const services = createMockDaemonServices({
					daemonRuntime: daemonRuntime as unknown as DaemonRuntime,
				})
				const lifecycle: TaskDiffCollectionLifecycle = {
					reconcileSessionChanges: () => undefined,
					reconcileTaskChanges: () => undefined,
					reconcileAllTasks: () => undefined,
				}

				yield* processSessionChange(
					makeSessionChange({
						type: 'update',
						value: {
							id: 'archived-session',
							status: 'ready_for_input',
							archived: true,
							coding_agent: 'claude',
						},
					}),
					services,
					lifecycle,
				)
				yield* processSessionChange(
					makeSessionChange({
						type: 'delete',
						value: {
							id: 'deleted-session',
							status: 'ready_for_input',
							archived: false,
							coding_agent: 'claude',
						},
					}),
					services,
					lifecycle,
				)

				expect(yield* Queue.take(stoppedSessionIds)).toBe('archived-session')
				expect(yield* Queue.take(stoppedSessionIds)).toBe('deleted-session')
				expect(yield* Queue.size(stoppedSessionIds)).toBe(0)

				for (const codingAgent of ['fold', 'codelayer', 'opencode'] as const) {
					yield* processSessionChange(
						makeSessionChange({
							type: 'update',
							value: {
								id: `archived-${codingAgent}`,
								status: 'ready_for_input',
								archived: true,
								coding_agent: codingAgent,
							},
						}),
						services,
						lifecycle,
					)
				}
				expect(yield* Queue.size(stoppedSessionIds)).toBe(0)
			}),
		),
	)

	it.effect('does not block session changes on archived Claude cleanup', ({ expect }) =>
		scopedWithoutV2Routing(
			Effect.gen(function* () {
				const cleanupRelease = yield* Deferred.make<void>()
				const cleanupStarted = yield* Queue.unbounded<void>()
				const processed = yield* Queue.unbounded<string>()
				const daemonRuntime = ManagedRuntime.make(
					Layer.succeed(ClaudeSessions, {
						executeClaudeSession: () => Effect.die('Unexpected Claude session execution'),
						deliverFollowUpMessage: () => Effect.die('Unexpected Claude follow-up delivery'),
						stopClaudeSession: () =>
							Queue.offer(cleanupStarted, undefined).pipe(
								Effect.andThen(Deferred.await(cleanupRelease)),
								Effect.as('stopped' as const),
							),
						shutdownActiveClaudeSessions: Effect.void,
						activeSessionIds: Effect.succeed([]),
					}),
				)
				yield* Effect.addFinalizer(() =>
					Deferred.succeed(cleanupRelease, undefined).pipe(
						Effect.andThen(Effect.promise(() => daemonRuntime.dispose())),
					),
				)
				const services = createMockDaemonServices({
					daemonRuntime: daemonRuntime as unknown as DaemonRuntime,
				})
				const lifecycle: TaskDiffCollectionLifecycle = {
					reconcileSessionChanges: (changes) => {
						Queue.offerUnsafe(
							processed,
							(changes[0]?.value as { id?: string } | undefined)?.id ?? 'missing',
						)
					},
					reconcileTaskChanges: () => undefined,
					reconcileAllTasks: () => undefined,
				}
				const changes = [
					makeSessionChange({
						type: 'update',
						value: {
							id: 'archived-claude',
							status: 'ready_for_input',
							archived: true,
							coding_agent: 'claude',
						},
					}),
					makeSessionChange({ type: 'update', value: { id: 'next-session', status: 'failed' } }),
				]

				yield* Stream.fromIterable(changes).pipe(
					Stream.mapEffect((change) => processSessionChange(change, services, lifecycle)),
					Stream.runDrain,
				)

				expect(yield* Queue.take(processed)).toBe('archived-claude')
				expect(yield* Queue.take(processed)).toBe('next-session')
				yield* Queue.take(cleanupStarted)
				expect(yield* Deferred.isDone(cleanupRelease)).toBe(false)
			}),
		),
	)

	it.effect('delivers a continuation while the same session workspace launch remains in flight', ({ expect }) =>
		scopedWithoutV2Routing(
			Effect.gen(function* () {
				const launchRelease = yield* Deferred.make<void>()
				const launchStarted = yield* Queue.unbounded<void>()
				const followUps = yield* Queue.unbounded<{ sessionId: string; prompt: string }>()
				const taskId = '019f8ce8-7dfa-7a30-a834-bf62bbeb7196'
				const sessionId = '019f8ce8-7dfa-7a30-a834-bf6189842cee'
				const daemonRuntime = ManagedRuntime.make(
					Layer.succeed(ClaudeSessions, {
						executeClaudeSession: () => Effect.die('Unexpected Claude session execution'),
						deliverFollowUpMessage: (input) =>
							Queue.offer(followUps, input).pipe(Effect.as('accepted' as const)),
						stopClaudeSession: () => Effect.succeed('not-active' as const),
						shutdownActiveClaudeSessions: Effect.void,
						activeSessionIds: Effect.succeed([]),
					}),
				)
				yield* Effect.addFinalizer(() =>
					Deferred.succeed(launchRelease, undefined).pipe(
						Effect.andThen(Effect.promise(() => daemonRuntime.dispose())),
					),
				)
				const launch = makeSessionChange({
					type: 'update',
					value: {
						id: sessionId,
						task_id: taskId,
						organization_id: '019f8ce8-7dfa-7a30-a834-bf602201078f',
						created_by: '019f8ce8-7dfa-7a30-a834-bf6022010790',
						resource_owner_user_id: '019f8ce8-7dfa-7a30-a834-bf6022010790',
						host_id: '019f8ce8-7dfa-7a30-a834-bf6022010791',
						status: 'ready_for_launch',
						coding_agent: 'claude',
						coding_agent_session_id: 'claude-session-1',
						resolved_model: 'test-model',
					},
				}).value
				const services = createMockDaemonServices({
					daemonRuntime: daemonRuntime as unknown as DaemonRuntime,
					collections: {
						tasks: {
							toArray: [
								{
									id: taskId,
									workspace_spec: {
										specVersion: 1,
										directory: '/tmp/task-1',
										workspaceBaseDirectory: '/tmp',
										setupBlocksFirstSession: false,
										repos: [
											{
												localPath: '.',
												targetPath: '/tmp/task-1',
												branch: 'task-1',
												sourceRef: 'HEAD',
												primary: true,
											},
										],
									},
								},
							],
						} as unknown as DaemonServices['collections']['tasks'],
					} as DaemonServices['collections'],
					orpc: {
						sessions: {
							update: async ({ status }: Parameters<DaemonServices['orpc']['sessions']['update']>[0]) => {
								if (status !== 'launching') return
								Queue.offerUnsafe(launchStarted, undefined)
								await daemonRuntime.runPromise(Deferred.await(launchRelease))
							},
						},
					} as unknown as DaemonServices['orpc'],
				})
				const lifecycle: TaskDiffCollectionLifecycle = {
					reconcileSessionChanges: () => undefined,
					reconcileTaskChanges: () => undefined,
					reconcileAllTasks: () => undefined,
				}
				const registry = yield* SessionRunRegistry
				const sessionRunInFlight = registry.isSessionRunInFlight({ sessionId })

				yield* processWorkspaceSessionChange(
					{
						session: launch,
						workspaceSetup: {
							id: 'setup-1',
							workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
						},
					} as unknown as Parameters<typeof processWorkspaceSessionChange>[0],
					services,
				)
				yield* Queue.take(launchStarted)
				expect(yield* sessionRunInFlight).toBe(true)

				yield* processSessionChange(
					makeSessionChange({
						type: 'update',
						value: {
							id: sessionId,
							task_id: taskId,
							status: 'resuming',
							coding_agent: 'claude',
							coding_agent_session_id: 'claude-session-1',
							prompt: 'continue this session',
						},
						previousValue: { id: sessionId, status: 'ready_for_input' },
					}),
					services,
					lifecycle,
				)

				expect(yield* Queue.take(followUps)).toEqual({ sessionId, prompt: 'continue this session' })
				expect(yield* Queue.size(followUps)).toBe(0)
				expect(yield* sessionRunInFlight).toBe(true)
				yield* Deferred.succeed(launchRelease, undefined)
			}),
		),
	)

	it.effect('keeps processing session changes after one change defects', ({ expect }) =>
		scopedWithoutV2Routing(
			Effect.gen(function* () {
				const processed = yield* Queue.unbounded<string>()
				let calls = 0
				const lifecycle: TaskDiffCollectionLifecycle = {
					reconcileSessionChanges: (changes) => {
						calls += 1
						if (calls === 1) throw new Error('malformed session change')
						Queue.offerUnsafe(processed, changes[0]?.value.task_id ?? 'missing')
					},
					reconcileTaskChanges: () => undefined,
					reconcileAllTasks: () => undefined,
				}
				const services = createMockDaemonServices()
				const changes = [
					makeSessionChange({ type: 'update', value: { id: 'bad', status: 'failed', task_id: 'bad-task' } }),
					makeSessionChange({
						type: 'update',
						value: { id: 'good', status: 'failed', task_id: 'good-task' },
					}),
				]

				yield* Stream.fromIterable(changes).pipe(
					Stream.mapEffect((change) => processSessionChange(change, services, lifecycle)),
					Stream.runDrain,
				)

				expect(yield* Queue.take(processed)).toBe('good-task')
			}),
		),
	)

	it.effect('resubscribes after a source failure and backoff', ({ expect }) =>
		scopedWithoutV2Routing(
			Effect.gen(function* () {
				const attempts = yield* Queue.unbounded<number>()
				let attempt = 0
				const consumer = superviseDaemonSubscriptionConsumer(() =>
					Effect.gen(function* () {
						attempt += 1
						yield* Queue.offer(attempts, attempt)
						if (attempt === 1) return yield* Effect.fail('source failed')
						return yield* Effect.never
					}),
				)
				const fiber = yield* consumer.pipe(Effect.forkScoped)

				expect(yield* Queue.take(attempts)).toBe(1)
				yield* TestClock.adjust('1 second')
				expect(yield* Queue.take(attempts)).toBe(2)
				yield* Fiber.interrupt(fiber)
			}),
		),
	)
})
