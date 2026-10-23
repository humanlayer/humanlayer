import { describe, expect, it } from '@effect/vitest'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import type { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { ConfigProvider, Deferred, Duration, Effect, Fiber, Layer, Option, Queue, Ref, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { DaemonWorkspaceRepositoryApiError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'
import { WorkspaceRepositorySetupActorsLive } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.layer'
import { WorkspaceRepositorySetupActors } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-actors.service'
import { WorkspaceRepositorySetupChanges } from '@/effects/services/workspace-repository-setup/workspace-repository-setup-changes'

import { UnusedRepositoryRequirements } from '../helpers/unused-repository-requirements'
import {
	remainingWorkspaceSetupOperationStubs,
	workspaceRepositorySnapshotAt as snapshotAt,
} from '../helpers/workspace-repository-snapshot'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'
import { createMockORPCClient } from '../mocks/orpc-client.mock'

const identityOf = ({ status }: WorkspaceRepositoryActorSnapshot) => ({
	projectId: status.projectId,
	workspaceId: status.workspaceId,
	repositoryIdentity: status.repositoryIdentity,
})

const NoChanges = Layer.succeed(WorkspaceRepositorySetupChanges, { changes: Stream.never })

const advance = (
	snapshot: WorkspaceRepositoryActorSnapshot,
	status: WorkspaceRepositoryActorSnapshot['status']['status'],
) => ({
	...snapshot,
	status: {
		...snapshot.status,
		status,
		updatedAt: snapshot.status.updatedAt + 1,
		resolvedCommit:
			status === 'materializing' || status === 'done' ? (snapshot.status.resolvedCommit ?? 'a'.repeat(40)) : null,
	},
})

describe('WorkspaceRepositorySetupActors', () => {
	it.effect('rolls back interrupted admission when the work queue is full', () =>
		Effect.gen(function* () {
			const snapshot = snapshotAt('done')
			const started = yield* Deferred.make<void>()
			const release = yield* Deferred.make<void>()
			const reads = yield* Ref.make(0)
			const ApiTest = Layer.succeed(
				DaemonApi,
				makeMockDaemonApi({
					getWorkspaceRepositoryStatus: ({ workspaceId }) =>
						Effect.gen(function* () {
							yield* Ref.update(reads, (n) => n + 1)
							if (workspaceId === 'running') {
								yield* Deferred.succeed(started, undefined)
								yield* Deferred.await(release)
							}
							return snapshot
						}),
				}),
			)
			const unexpected = () => Effect.die('terminal snapshot started an actor')
			const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						ActorSystemDefault,
						ApiTest,
						NoChanges,
						UnusedRepositoryRequirements,
						ConfigProvider.layer(ConfigProvider.fromUnknown({ RIPTIDE_WORKSPACE_SETUP_CONCURRENCY: '1' })),
						Layer.succeed(WorkspaceRepositoryActorOperations, {
							...remainingWorkspaceSetupOperationStubs,
							start: unexpected,
							checkSource: unexpected,
							refreshSource: unexpected,
							resolveCommit: unexpected,
							materialize: unexpected,
						}),
					),
				),
			)
			yield* Effect.gen(function* () {
				const manager = yield* WorkspaceRepositorySetupActors
				const enqueue = (workspaceId: string) => manager.enqueue({ ...identityOf(snapshot), workspaceId })
				const running = yield* enqueue('running').pipe(Effect.forkChild)
				yield* Deferred.await(started)
				// Immediate forks run admission to its first suspension: these fill all 20 queue slots.
				const queued = yield* Effect.forEach(
					Array.from({ length: 20 }, (_, i) => `queued-${i}`),
					(id) => enqueue(id).pipe(Effect.forkChild({ startImmediately: true })),
				)
				const blocked = yield* enqueue('cancelled').pipe(Effect.forkChild({ startImmediately: true }))
				const follower = yield* enqueue('cancelled').pipe(Effect.forkChild({ startImmediately: true }))
				yield* Fiber.interrupt(blocked)
				// A caller that joined the unpublished job must also be released by rollback.
				yield* Fiber.join(follower)
				expect(yield* Ref.get(reads)).toBe(1)
				yield* Deferred.succeed(release, undefined)
				yield* Fiber.join(running)
				yield* Effect.forEach(queued, Fiber.join)
				expect(yield* Ref.get(reads)).toBe(21)
				// This must create a fresh job rather than join the cancelled producer's orphan.
				yield* enqueue('cancelled')
				expect(yield* Ref.get(reads)).toBe(22)
			}).pipe(Effect.provide(ManagerTest))
		}),
	)

	for (const code of ['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST'] as const) {
		it.effect(`retires ${code} targets and frees the only worker without a retry delay`, () =>
			Effect.gen(function* () {
				const snapshot = snapshotAt('materializing')
				const invalid = { ...identityOf(snapshot), workspaceId: 'deleted-workspace' }
				const started = yield* Queue.unbounded<void>()
				const release = Promise.withResolvers<void>()
				const calls: string[] = []
				const ApiTest = DaemonApiLive(
					createMockORPCClient({
						projectWorkspaces: {
							getRepositoryStatus: async (input: typeof invalid) => {
								calls.push(input.workspaceId)
								if (input.workspaceId === invalid.workspaceId) {
									Queue.offerUnsafe(started, undefined)
									await release.promise
									throw { code }
								}
								return { repositoryStatus: snapshot }
							},
						},
					}),
				)
				const materializations = yield* Ref.make(0)
				const unexpected = () => Effect.die('unexpected actor stage')
				const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							ActorSystemDefault,
							ApiTest,
							NoChanges,
							UnusedRepositoryRequirements,
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({ RIPTIDE_WORKSPACE_SETUP_CONCURRENCY: '1' }),
							),
							Layer.succeed(WorkspaceRepositoryActorOperations, {
								...remainingWorkspaceSetupOperationStubs,
								start: unexpected,
								checkSource: unexpected,
								refreshSource: unexpected,
								resolveCommit: unexpected,
								materialize: (current) =>
									Ref.update(materializations, (n) => n + 1).pipe(
										Effect.as(advance(current, 'done')),
									),
							}),
						),
					),
				)
				yield* Effect.gen(function* () {
					const manager = yield* WorkspaceRepositorySetupActors
					const deleted = yield* manager.enqueue(invalid).pipe(Effect.forkChild)
					yield* Queue.take(started)
					const healthy = yield* manager.enqueue(identityOf(snapshot)).pipe(Effect.forkChild)
					release.resolve()
					yield* Fiber.join(deleted)
					yield* Fiber.join(healthy)
					expect(yield* Ref.get(materializations)).toBe(1)
					yield* TestClock.adjust('5 minutes')
					expect(calls).toEqual([invalid.workspaceId, snapshot.status.workspaceId])
					// Retirement also removes the deduplication entry: a later hint can be re-evaluated.
					yield* manager.enqueue(invalid)
					expect(calls).toHaveLength(3)
				}).pipe(Effect.provide(ManagerTest))
			}),
		)
	}

	it.effect('preserves transient adapter failures for recovery', () =>
		Effect.gen(function* () {
			const cause = { code: 'SERVICE_UNAVAILABLE', message: 'temporary outage' }
			const api = yield* DaemonApi
			const failure = yield* api
				.getWorkspaceRepositoryStatus(identityOf(snapshotAt('materializing')))
				.pipe(Effect.flip)
			expect(failure).toEqual(new DaemonWorkspaceRepositoryApiError({ cause }))
		}).pipe(
			Effect.provide(
				DaemonApiLive(
					createMockORPCClient({
						projectWorkspaces: {
							getRepositoryStatus: async () => {
								throw { code: 'SERVICE_UNAVAILABLE', message: 'temporary outage' }
							},
						},
					}),
				),
			),
		),
	)

	for (const outcome of ['done', 'actor_failure', 'shutdown'] as const) {
		it.effect(`retains a single notification through read failure: ${outcome}`, () =>
			Effect.gen(function* () {
				const snapshot = snapshotAt('materializing')
				const identity = {
					projectId: snapshot.status.projectId,
					workspaceId: snapshot.status.workspaceId,
					repositoryIdentity: snapshot.status.repositoryIdentity,
				}
				const notifications = yield* Queue.unbounded<typeof identity>()
				const attempted = yield* Queue.unbounded<number>()
				const reads = yield* Ref.make(0)
				const materializations = yield* Ref.make(0)
				const latest = yield* Ref.make(snapshot)
				const failure = new DaemonWorkspaceRepositoryApiError({ cause: new Error('API unavailable') })
				const ApiTest = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						getWorkspaceRepositoryStatus: () =>
							Effect.gen(function* () {
								const attempt = yield* Ref.updateAndGet(reads, (count) => count + 1)
								yield* Queue.offer(attempted, attempt)
								if (attempt === 1) return yield* failure
								return yield* Ref.get(latest)
							}),
					}),
				)
				const unexpected = () => Effect.die('unexpected actor stage')
				const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
					...remainingWorkspaceSetupOperationStubs,
					start: unexpected,
					checkSource: unexpected,
					refreshSource: unexpected,
					resolveCommit: unexpected,
					materialize: (current) =>
						Effect.gen(function* () {
							yield* Ref.update(materializations, (count) => count + 1)
							// Even the same API error tag from an actor operation must not restart the job.
							if (outcome === 'actor_failure') return yield* failure
							const completed = advance(current, 'done')
							yield* Ref.set(latest, completed)
							return completed
						}),
				})
				const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							ActorSystemDefault,
							ApiTest,
							OperationsTest,
							UnusedRepositoryRequirements,
							Layer.succeed(WorkspaceRepositorySetupChanges, {
								changes: Stream.fromQueue(notifications),
							}),
						),
					),
				)
				yield* Effect.gen(function* () {
					const manager = yield* WorkspaceRepositorySetupActors
					yield* Queue.offer(notifications, identity)
					expect(yield* Queue.take(attempted)).toBe(1)
					if (outcome === 'shutdown') return
					// Join the retained job; this is not another Electric notification.
					const completion = yield* manager.enqueue(identity).pipe(Effect.forkChild)
					yield* TestClock.adjust('799 millis')
					expect(yield* Ref.get(reads)).toBe(1)
					expect(yield* Ref.get(materializations)).toBe(0)
					yield* TestClock.adjust('401 millis')
					expect(yield* Queue.take(attempted)).toBe(2)
					yield* Fiber.join(completion)
					yield* TestClock.adjust('5 minutes')
					expect(yield* Ref.get(reads)).toBe(2)
					expect(yield* Ref.get(materializations)).toBe(1)
					expect((yield* Ref.get(latest)).status.status).toBe(outcome === 'done' ? 'done' : 'materializing')
				}).pipe(Effect.provide(ManagerTest))
				if (outcome === 'shutdown') {
					yield* TestClock.adjust('5 minutes')
					expect(yield* Ref.get(reads)).toBe(1)
					expect(yield* Ref.get(materializations)).toBe(0)
				}
			}),
		)
	}

	for (const ordering of ['before completion', 'with completion', 'after retirement'] as const) {
		it.effect(`retains Electric retry changes ${ordering} without losing work`, () =>
			Effect.gen(function* () {
				const original = snapshotAt('materializing')
				const identity = {
					projectId: original.status.projectId,
					workspaceId: original.status.workspaceId,
					repositoryIdentity: original.status.repositoryIdentity,
				}
				const latest = yield* Ref.make(original)
				const notifications = yield* Queue.unbounded<void>()
				const admitted = yield* Queue.unbounded<void>()
				const started = yield* Queue.unbounded<number>()
				const release = yield* Queue.unbounded<void>()
				const reads = yield* Ref.make(0)
				const ChangesTest = Layer.succeed(WorkspaceRepositorySetupChanges, {
					changes: Stream.fromQueue(notifications).pipe(
						Stream.flatMap(() =>
							Stream.concat(
								Stream.make(identity),
								Stream.fromEffect(Queue.offer(admitted, undefined)).pipe(Stream.drain),
							),
						),
					),
				})
				const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
					...remainingWorkspaceSetupOperationStubs,
					start: () => Effect.die('unexpected start'),
					checkSource: () => Effect.die('unexpected checkSource'),
					refreshSource: () => Effect.die('unexpected refreshSource'),
					resolveCommit: () => Effect.die('unexpected resolveCommit'),
					materialize: (snapshot) =>
						Effect.gen(function* () {
							yield* Queue.offer(started, snapshot.status.generation)
							yield* Queue.take(release)
							return advance(snapshot, 'done')
						}),
				})
				const ApiTest = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						getWorkspaceRepositoryStatus: () =>
							Ref.update(reads, (n) => n + 1).pipe(Effect.andThen(Ref.get(latest))),
					}),
				)
				const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							ActorSystemDefault,
							OperationsTest,
							ApiTest,
							UnusedRepositoryRequirements,
							ChangesTest,
						),
					),
				)
				yield* Effect.gen(function* () {
					const manager = yield* WorkspaceRepositorySetupActors
					const first = yield* manager.enqueue(identity).pipe(Effect.forkChild)
					expect(yield* Queue.take(started)).toBe(1)
					yield* Ref.set(latest, {
						...original,
						location: { ...original.location, setupGeneration: 2 },
						status: { ...original.status, generation: 2 },
					})
					if (ordering === 'before completion') {
						// Acknowledged admission proves the live stream set dirty while the actor was blocked.
						yield* Queue.offerAll(notifications, [undefined, undefined])
						yield* Queue.take(admitted)
						yield* Queue.take(admitted)
						yield* Queue.offer(release, undefined)
					} else if (ordering === 'after retirement') {
						yield* Queue.offer(release, undefined)
						yield* Fiber.join(first)
						yield* Queue.offer(notifications, undefined)
						yield* Queue.take(admitted)
					} else {
						// Both producers start behind the same gate; no admission/retirement ordering is assumed.
						const gate = yield* Deferred.make<void>()
						const finish = yield* Deferred.await(gate).pipe(
							Effect.andThen(Queue.offer(release, undefined)),
							Effect.forkChild({ startImmediately: true }),
						)
						const notify = yield* Deferred.await(gate).pipe(
							Effect.andThen(Queue.offer(notifications, undefined)),
							Effect.forkChild({ startImmediately: true }),
						)
						yield* Deferred.succeed(gate, undefined)
						yield* Fiber.join(finish)
						yield* Fiber.join(notify)
						yield* Queue.take(admitted)
					}
					expect(yield* Queue.take(started)).toBe(2)
					const second = yield* manager.enqueue(identity).pipe(Effect.forkChild({ startImmediately: true }))
					yield* Queue.offer(release, undefined)
					yield* Fiber.join(first)
					yield* Fiber.join(second)
					expect(Option.isNone(yield* Queue.poll(started))).toBe(true)
					expect(yield* Ref.get(reads)).toBe(2)
				}).pipe(Effect.provide(ManagerTest))
			}),
		)
	}

	for (const cancelPublisher of [false, true]) {
		it.effect(
			`deduplicates concurrent admissions${cancelPublisher ? ' after published caller cancellation' : ''}`,
			() =>
				Effect.gen(function* () {
					const snapshot = snapshotAt('setup_requested')
					const started = yield* Deferred.make<void>()
					const release = yield* Deferred.make<void>()
					const reads = yield* Ref.make(0)
					const calls = yield* Ref.make(0)
					const operation =
						(status: WorkspaceRepositoryActorSnapshot['status']['status']) =>
						(current: WorkspaceRepositoryActorSnapshot) =>
							Ref.updateAndGet(calls, (count) => count + 1).pipe(Effect.as(advance(current, status)))
					const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
						...remainingWorkspaceSetupOperationStubs,
						start: (current) =>
							Deferred.succeed(started, undefined).pipe(
								Effect.andThen(Deferred.await(release)),
								Effect.andThen(operation('checking_source')(current)),
							),
						checkSource: operation('refreshing_source'),
						refreshSource: operation('resolving_commit'),
						resolveCommit: operation('materializing'),
						materialize: operation('done'),
					})
					const ApiTest = Layer.succeed(
						DaemonApi,
						makeMockDaemonApi({
							getWorkspaceRepositoryStatus: () =>
								Ref.update(reads, (n) => n + 1).pipe(Effect.as(snapshot)),
						}),
					)
					const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
						Layer.provide(
							Layer.mergeAll(
								ActorSystemDefault,
								OperationsTest,
								ApiTest,
								UnusedRepositoryRequirements,
								NoChanges,
							),
						),
					)

					yield* Effect.gen(function* () {
						const manager = yield* WorkspaceRepositorySetupActors
						const publisher = yield* manager.enqueue(identityOf(snapshot)).pipe(Effect.forkChild)
						yield* Deferred.await(started)
						// Every immediate fork reaches its completion wait before the actor can finish.
						const duplicates = yield* Effect.forEach(Array.from({ length: 32 }), () =>
							manager.enqueue(identityOf(snapshot)).pipe(Effect.forkChild({ startImmediately: true })),
						)
						if (cancelPublisher) yield* Fiber.interrupt(publisher)
						expect(yield* Ref.get(reads)).toBe(1)
						yield* Deferred.succeed(release, undefined)
						if (!cancelPublisher) yield* Fiber.join(publisher)
						yield* Effect.forEach(duplicates, Fiber.join)
						expect(yield* Ref.get(reads)).toBe(1)
					}).pipe(Effect.provide(ManagerTest))

					expect(yield* Ref.get(calls)).toBe(5)
				}),
		)
	}

	it.effect('bounds concurrency across complete actor lifecycles', () =>
		Effect.gen(function* () {
			const snapshots = [1, 2, 3, 4, 5, 6].map((index) => {
				const snapshot = snapshotAt('setup_requested')
				const workspaceId = `01990c8d-0000-7000-8000-00000000000${index}`
				return {
					...snapshot,
					workspace: { ...snapshot.workspace, id: workspaceId },
					location: { ...snapshot.location, workspaceId },
					status: { ...snapshot.status, workspaceId },
				}
			})
			const started = yield* Queue.unbounded<string>()
			const release = yield* Queue.unbounded<void>()
			const active = yield* Ref.make({ current: 0, maximum: 0 })
			const start = (snapshot: WorkspaceRepositoryActorSnapshot) =>
				Effect.gen(function* () {
					yield* Ref.update(active, ({ current, maximum }) => ({
						current: current + 1,
						maximum: Math.max(maximum, current + 1),
					}))
					yield* Queue.offer(started, snapshot.status.workspaceId)
					yield* Queue.take(release)
					return advance(snapshot, 'checking_source')
				})
			const operation =
				(status: WorkspaceRepositoryActorSnapshot['status']['status']) =>
				(snapshot: WorkspaceRepositoryActorSnapshot) =>
					Effect.succeed(advance(snapshot, status))
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start,
				checkSource: operation('refreshing_source'),
				refreshSource: operation('resolving_commit'),
				resolveCommit: operation('materializing'),
				materialize: (snapshot) =>
					Ref.update(active, (state) => ({ ...state, current: state.current - 1 })).pipe(
						Effect.as(advance(snapshot, 'done')),
					),
			})
			const ApiTest = Layer.succeed(
				DaemonApi,
				makeMockDaemonApi({
					getWorkspaceRepositoryStatus: ({ workspaceId }) => {
						const snapshot = snapshots.find((candidate) => candidate.status.workspaceId === workspaceId)
						return snapshot ? Effect.succeed(snapshot) : Effect.die(`missing test snapshot ${workspaceId}`)
					},
				}),
			)
			const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						ActorSystemDefault,
						OperationsTest,
						ApiTest,
						UnusedRepositoryRequirements,
						NoChanges,
					),
				),
			)

			yield* Effect.gen(function* () {
				const manager = yield* WorkspaceRepositorySetupActors
				const completion = yield* Effect.forkChild(
					Effect.forEach(snapshots, (current) => manager.enqueue(identityOf(current)), {
						concurrency: 'unbounded',
						discard: true,
					}),
				)
				yield* Effect.forEach([1, 2, 3, 4, 5], () => Queue.take(started), { discard: true })
				expect(Option.isNone(yield* Queue.poll(started))).toBe(true)
				yield* Queue.offerAll(release, [undefined, undefined, undefined, undefined, undefined, undefined])
				yield* Fiber.join(completion)
			}).pipe(Effect.provide(ManagerTest))

			expect(yield* Ref.get(active)).toEqual({ current: 0, maximum: 5 })
		}),
	)

	it.effect('reloads queued repository status before starting filesystem work', () =>
		Effect.gen(function* () {
			const blocking = snapshotAt('setup_requested')
			const stale = snapshotAt('setup_requested')
			const queuedWorkspaceId = '01990c8d-0000-7000-8000-000000000099'
			const staleQueued = {
				...stale,
				workspace: { ...stale.workspace, id: queuedWorkspaceId },
				location: { ...stale.location, workspaceId: queuedWorkspaceId, filePath: '/stale/path' },
				status: { ...stale.status, workspaceId: queuedWorkspaceId },
			}
			const currentQueued = {
				...staleQueued,
				location: { ...staleQueued.location, filePath: '/current/path', setupGeneration: 2 },
				status: {
					...staleQueued.status,
					status: 'materializing' as const,
					generation: 2,
					resolvedCommit: 'a'.repeat(40),
					updatedAt: staleQueued.status.updatedAt + 1,
				},
			}
			const latest = yield* Ref.make<WorkspaceRepositoryActorSnapshot>(staleQueued)
			const blockingStarted = yield* Queue.unbounded<void>()
			const releaseBlocking = yield* Queue.unbounded<void>()
			const materialized = yield* Queue.unbounded<WorkspaceRepositoryActorSnapshot>()
			const operation =
				(status: WorkspaceRepositoryActorSnapshot['status']['status']) =>
				(snapshot: WorkspaceRepositoryActorSnapshot) =>
					Effect.succeed(advance(snapshot, status))
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start: (snapshot) =>
					Queue.offer(blockingStarted, undefined).pipe(
						Effect.andThen(Queue.take(releaseBlocking)),
						Effect.as(advance(snapshot, 'checking_source')),
					),
				checkSource: operation('refreshing_source'),
				refreshSource: operation('resolving_commit'),
				resolveCommit: operation('materializing'),
				materialize: (snapshot) =>
					snapshot.status.workspaceId === queuedWorkspaceId
						? Queue.offer(materialized, snapshot).pipe(Effect.as(advance(snapshot, 'done')))
						: Effect.succeed(advance(snapshot, 'done')),
			})
			const ApiTest = Layer.succeed(
				DaemonApi,
				makeMockDaemonApi({
					getWorkspaceRepositoryStatus: ({ workspaceId }) =>
						workspaceId === queuedWorkspaceId ? Ref.get(latest) : Effect.succeed(blocking),
				}),
			)
			const ConfigTest = ConfigProvider.layer(
				ConfigProvider.fromUnknown({ RIPTIDE_WORKSPACE_SETUP_CONCURRENCY: '1' }),
			)
			const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						ActorSystemDefault,
						OperationsTest,
						ApiTest,
						UnusedRepositoryRequirements,
						ConfigTest,
						NoChanges,
					),
				),
			)

			yield* Effect.gen(function* () {
				const manager = yield* WorkspaceRepositorySetupActors
				const completion = yield* Effect.forkChild(
					Effect.forEach([blocking, staleQueued], (current) => manager.enqueue(identityOf(current)), {
						concurrency: 'unbounded',
						discard: true,
					}),
				)
				yield* Queue.take(blockingStarted)
				yield* Ref.set(latest, currentQueued)
				yield* Queue.offer(releaseBlocking, undefined)
				yield* Fiber.join(completion)
			}).pipe(Effect.provide(ManagerTest))

			const observed = yield* Queue.take(materialized)
			expect(observed.location.filePath).toBe('/current/path')
			expect(observed.location.setupGeneration).toBe(2)
			expect(observed.status.status).toBe('materializing')
			expect(observed.status.generation).toBe(2)
		}),
	)

	it.effect('drops queued repository statuses that are no longer actionable', () =>
		Effect.gen(function* () {
			const base = snapshotAt('setup_requested')
			const statuses = [
				{ ...base, workspace: { ...base.workspace, archived: true } },
				{
					...base,
					status: {
						...base.status,
						workspaceId: `${base.status.workspaceId.slice(0, -1)}1`,
						status: 'done' as const,
					},
				},
				{
					...base,
					status: {
						...base.status,
						workspaceId: `${base.status.workspaceId.slice(0, -1)}2`,
						error: { stage: 'checking_source' as const, message: 'parked' },
					},
				},
				{
					...base,
					status: { ...base.status, workspaceId: `${base.status.workspaceId.slice(0, -1)}3` },
					location: { ...base.location, setupGeneration: 2 },
				},
			].map((snapshot, index) => {
				const workspaceId = `01990c8d-0000-7000-8000-00000000001${index}`
				return {
					...snapshot,
					workspace: { ...snapshot.workspace, id: workspaceId },
					location: { ...snapshot.location, workspaceId },
					status: { ...snapshot.status, workspaceId },
				}
			})
			const gets = yield* Ref.make(0)
			const unexpected = () => Effect.die('terminal repository status started an actor operation')
			const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
				...remainingWorkspaceSetupOperationStubs,
				start: unexpected,
				checkSource: unexpected,
				refreshSource: unexpected,
				resolveCommit: unexpected,
				materialize: unexpected,
			})
			const ApiTest = Layer.succeed(
				DaemonApi,
				makeMockDaemonApi({
					getWorkspaceRepositoryStatus: ({ workspaceId }) => {
						const status = statuses.find((candidate) => candidate.status.workspaceId === workspaceId)
						return Ref.update(gets, (count) => count + 1).pipe(
							Effect.andThen(
								status ? Effect.succeed(status) : Effect.die(`missing test status ${workspaceId}`),
							),
						)
					},
				}),
			)
			const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
				Layer.provide(
					Layer.mergeAll(
						ActorSystemDefault,
						OperationsTest,
						ApiTest,
						UnusedRepositoryRequirements,
						NoChanges,
					),
				),
			)

			yield* Effect.gen(function* () {
				const manager = yield* WorkspaceRepositorySetupActors
				yield* Effect.forEach(statuses, (current) => manager.enqueue(identityOf(current)), {
					concurrency: 'unbounded',
					discard: true,
				})
			}).pipe(Effect.provide(ManagerTest))

			expect(yield* Ref.get(gets)).toBe(statuses.length)
		}),
	)

	for (const initialState of [true, false]) {
		it.effect(`Electric ${initialState ? 'initial state' : 'later changes'} discovers work without polling`, () =>
			Effect.gen(function* () {
				const snapshot = snapshotAt('setup_requested')
				const subscribed = yield* Queue.unbounded<void>()
				const started = yield* Queue.unbounded<void>()
				const changes = yield* Queue.unbounded<WorkspaceRepositoryActorSnapshot>()
				const reads = yield* Ref.make(0)
				if (initialState) yield* Queue.offer(changes, snapshot)
				const ChangesTest = Layer.succeed(WorkspaceRepositorySetupChanges, {
					changes: Stream.fromQueue(changes).pipe(
						Stream.onStart(Queue.offer(subscribed, undefined)),
						Stream.map(({ status }) => ({
							projectId: status.projectId,
							workspaceId: status.workspaceId,
							repositoryIdentity: status.repositoryIdentity,
						})),
					),
				})
				const operation =
					(status: WorkspaceRepositoryActorSnapshot['status']['status']) =>
					(current: WorkspaceRepositoryActorSnapshot) =>
						Effect.succeed(advance(current, status))
				const OperationsTest = Layer.succeed(WorkspaceRepositoryActorOperations, {
					...remainingWorkspaceSetupOperationStubs,
					start: (current) =>
						Queue.offer(started, undefined).pipe(Effect.as(advance(current, 'checking_source'))),
					checkSource: operation('refreshing_source'),
					refreshSource: operation('resolving_commit'),
					resolveCommit: operation('materializing'),
					materialize: operation('done'),
				})
				const ApiTest = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						getWorkspaceRepositoryStatus: () =>
							Ref.update(reads, (count) => count + 1).pipe(Effect.as(snapshot)),
					}),
				)
				const ManagerTest = WorkspaceRepositorySetupActorsLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							ActorSystemDefault,
							OperationsTest,
							ApiTest,
							UnusedRepositoryRequirements,
							ChangesTest,
						),
					),
				)
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* Layer.build(ManagerTest)
						yield* Queue.take(subscribed)
						if (!initialState) yield* Queue.offer(changes, snapshot)
						yield* Queue.take(started)
						yield* TestClock.adjust(Duration.seconds(90))
						expect(yield* Ref.get(reads)).toBe(1)
					}),
				)
			}),
		)
	}
})
