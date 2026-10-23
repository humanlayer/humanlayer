import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it } from '@effect/vitest'
import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'
import { Deferred, Effect, Fiber, Layer, Queue, Ref, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import {
	DaemonCollections,
	type DaemonCollectionsService,
	type TaskChangeMessage,
	type WorkspaceSetupTask,
} from '@/effects/services/daemon-collections/daemon-collections.service'
import { WorkspacePathResolver } from '@/effects/services/workspace-path-resolver/workspace-path-resolver.service'
import {
	WorkspaceSetupExecutor,
	type WorkspaceSetupExecutorService,
} from '@/effects/services/workspace-setup-executor/workspace-setup-executor.service'
import { WorkspaceSetupLive } from '@/effects/services/workspace-setup/workspace-setup.layer'
import { WorkspaceSetup } from '@/effects/services/workspace-setup/workspace-setup.service'

import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

const spec = {
	specVersion: 1,
	directory: '/repo',
	workspaceBaseDirectory: '/workspaces/task-1',
	setupBlocksFirstSession: false,
	repos: [
		{ localPath: '.', targetPath: '/workspaces/task-1/repo', branch: 'task-1', sourceRef: 'HEAD', primary: true },
	],
} as const

type TaskOverrides = Omit<Partial<Task>, 'workspace_spec'> & { readonly workspace_spec?: unknown }

const makeRow = (
	overrides: Partial<TaskWorkspaceSetupForHost> = {},
	taskOverrides: TaskOverrides = {},
): WorkspaceSetupTask => ({
	task: { id: 'task-1', updated_at: 1n, workspace_spec: spec, ...taskOverrides } as Task,
	workspaceSetup: {
		id: 'setup-1',
		task_id: 'task-1',
		organization_id: 'org-1',
		host_id: 'host-1',
		status: 'setup_requested',
		resolved_workspace_spec: null,
		workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'setup_requested' }] },
		error: null,
		created_at: 1n,
		updated_at: 1n,
		...overrides,
	},
})

const makeCollections = (
	workspaceSetups: Stream.Stream<WorkspaceSetupTask>,
	currentRow: WorkspaceSetupTask = makeRow(),
	awaitTxId: (transactionId: number) => Promise<void> = async () => {},
	taskChanges: Stream.Stream<TaskChangeMessage> = Stream.never,
): DaemonCollectionsService => {
	const tasks = [currentRow.task]
	const setupRows = [currentRow.workspaceSetup]
	const updateCurrentRow = (row: WorkspaceSetupTask) => {
		const taskIndex = tasks.findIndex((task) => task.id === row.task.id)
		const currentTask = tasks[taskIndex]
		if (taskIndex === -1) tasks.push(row.task)
		else if (currentTask !== undefined && row.task.updated_at >= currentTask.updated_at) tasks[taskIndex] = row.task
		const setupIndex = setupRows.findIndex((setup) => setup.id === row.workspaceSetup.id)
		const currentSetup = setupRows[setupIndex]
		if (setupIndex === -1) setupRows.push(row.workspaceSetup)
		else if (currentSetup !== undefined && row.workspaceSetup.updated_at >= currentSetup.updated_at)
			setupRows[setupIndex] = row.workspaceSetup
	}
	return {
		current: Effect.succeed({
			tasks: { toArray: tasks },
			workspaceSetup: {
				toArray: setupRows,
				utils: { awaitTxId },
			},
		} as never),
		sessionChanges: Stream.never,
		taskChanges,
		approvalChanges: Stream.never,
		workspaceSetupChanges: Stream.never,
		providerLoginChanges: Stream.never,
		workspaceSetups: workspaceSetups.pipe(Stream.tap((row) => Effect.sync(() => updateCurrentRow(row)))),
		workspaceSetupSessions: Stream.never,
		streamSessionChanges: () => Stream.never,
		streamApprovalChanges: () => Stream.never,
	}
}

const makeApi = (
	updates: Array<{ repo?: { status: string } }>,
	updateWorkspaceSetup: (update: {
		repo?: { status: string }
	}) => Effect.Effect<{ transactionId: string }, DaemonTaskCapabilityError> = (update) => {
		updates.push(update)
		return Effect.succeed({ transactionId: `${updates.length}` })
	},
) => makeMockDaemonApi({ updateWorkspaceSetup })

const executor: WorkspaceSetupExecutorService = {
	preflightRepo: () => Effect.succeed({ resolvedSourceCommit: 'abc123' }),
	createOrAdoptWorktree: () => Effect.succeed({ targetPath: '/workspaces/task-1/repo', adopted: false }),
	copyConfiguredFiles: () => Effect.succeed({ filesCopied: [] }),
	runSetupCommand: () => Effect.succeed({ command: '', exitCode: 0 }),
}

const workspacePathResolverLayer = Layer.succeed(
	WorkspacePathResolver,
	WorkspacePathResolver.of({
		resolveSourceDirectory: (input) => Effect.succeed(input.directory),
		resolveTargetDirectory: (input) => Effect.succeed(input.targetPath),
	}),
)
const workspaceSetupOperationalLayer = Layer.mergeAll(NodeServices.layer, workspacePathResolverLayer)

const makeActorRuntimeLayer = (
	collections: DaemonCollectionsService,
	api: ReturnType<typeof makeApi>,
	setupExecutor: WorkspaceSetupExecutorService,
) => {
	const actorDependencies = Layer.mergeAll(
		Layer.succeed(DaemonCollections, collections),
		Layer.succeed(DaemonApi, api),
		Layer.succeed(WorkspaceSetupExecutor, setupExecutor),
		workspaceSetupOperationalLayer,
	)
	return WorkspaceSetupLive.pipe(Layer.provideMerge(actorDependencies))
}

const runActor = (
	workspaceSetups: Stream.Stream<WorkspaceSetupTask>,
	updates: Array<{ repo?: { status: string } }>,
	setupExecutor: WorkspaceSetupExecutorService = executor,
	awaitTxId: (transactionId: number) => Promise<void> = async () => {},
	currentRow: WorkspaceSetupTask = makeRow(),
	taskChanges: Stream.Stream<TaskChangeMessage> = Stream.never,
) =>
	Effect.gen(function* () {
		const actor = yield* WorkspaceSetup
		yield* actor.run
	}).pipe(
		Effect.provide(
			makeActorRuntimeLayer(
				makeCollections(workspaceSetups, currentRow, awaitTxId, taskChanges),
				makeApi(updates),
				setupExecutor,
			),
		),
	)

describe('standalone workspace setup actor', () => {
	it.effect('converges an initial setup row without session context', ({ expect }) => {
		const updates: Array<{ repo?: { status: string } }> = []
		return runActor(Stream.succeed(makeRow()), updates).pipe(
			Effect.andThen(Effect.sync(() => expect(updates.at(-1)?.repo?.status).toBe('done'))),
		)
	})

	it.effect('confirms every successful progress transaction before returning', ({ expect }) =>
		Effect.gen(function* () {
			const updates: Array<{ repo?: { status: string } }> = []
			const confirmedTransactionIds: number[] = []

			yield* runActor(Stream.succeed(makeRow()), updates, executor, async (transactionId) => {
				confirmedTransactionIds.push(transactionId)
			})

			expect(confirmedTransactionIds).toEqual(updates.map((_, index) => index + 1))
			expect(confirmedTransactionIds.length).toBeGreaterThan(0)
		}),
	)

	it.effect('waits for transaction confirmation before continuing setup', ({ expect }) =>
		Effect.gen(function* () {
			const updates: Array<{ repo?: { status: string } }> = []
			let releaseFirstConfirmation: (() => void) | undefined
			const firstConfirmation = new Promise<void>((resolve) => {
				releaseFirstConfirmation = resolve
			})
			let signalConfirmationStarted: (() => void) | undefined
			const confirmationStarted = new Promise<void>((resolve) => {
				signalConfirmationStarted = resolve
			})
			let confirmations = 0

			const fiber = yield* runActor(Stream.succeed(makeRow()), updates, executor, () => {
				confirmations += 1
				signalConfirmationStarted?.()
				return confirmations === 1 ? firstConfirmation : Promise.resolve()
			}).pipe(Effect.forkChild)
			yield* Effect.promise(() => confirmationStarted)

			expect(updates).toHaveLength(1)
			expect(updates[0]?.repo?.status).toBe('preflight')
			releaseFirstConfirmation?.()
			yield* Fiber.join(fiber)
			expect(updates.at(-1)?.repo?.status).toBe('done')
		}),
	)

	it.effect('rereads self-echoed progress instead of reverting done work to preflight', ({ expect }) =>
		Effect.gen(function* () {
			const queue = yield* Queue.unbounded<WorkspaceSetupTask>()
			const current = makeRow()
			const tasks = [current.task]
			const setupRows = [current.workspaceSetup]
			let preflightCalls = 0
			let transactionId = 0
			const updates: Array<{ repo?: { status: string } }> = []
			const echoingApi = makeApi(updates, (update) =>
				Effect.gen(function* () {
					updates.push(update)
					transactionId += 1
					const repoStatus = update.repo?.status
					if (repoStatus !== undefined) {
						const previous = setupRows[0]
						if (previous === undefined) return yield* Effect.die('missing setup row')
						const workspaceSetup = {
							...previous,
							status: repoStatus === 'done' ? ('done' as const) : previous.status,
							updated_at: previous.updated_at + 1n,
							workspace_setup_state: {
								specVersion: 1 as const,
								repos: [{ localPath: '.', status: repoStatus }],
							},
						}
						setupRows[0] = workspaceSetup as TaskWorkspaceSetupForHost
						yield* Queue.offer(queue, { task: tasks[0] as Task, workspaceSetup: setupRows[0] })
					}
					return { transactionId: `${transactionId}` }
				}),
			)
			const echoedRowsThroughDone = Stream.fromQueue(queue).pipe(
				Stream.takeUntil((row) => row.workspaceSetup.status === 'done'),
			)
			const localCollections = makeCollections(echoedRowsThroughDone)
			const collections = {
				...localCollections,
				current: Effect.succeed({
					tasks: { toArray: tasks },
					workspaceSetup: { toArray: setupRows, utils: { awaitTxId: async () => {} } },
				} as never),
			}
			const countingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) => {
					preflightCalls += 1
					return executor.preflightRepo(input)
				},
			}
			const actorRuntimeLayer = makeActorRuntimeLayer(collections, echoingApi, countingExecutor)
			const program = Effect.gen(function* () {
				const actor = yield* WorkspaceSetup
				const fiber = yield* actor.run.pipe(Effect.forkChild)
				yield* Queue.offer(queue, current)
				yield* Fiber.join(fiber)
			}).pipe(Effect.provide(actorRuntimeLayer))

			yield* program
			expect(preflightCalls).toBe(1)
			expect(updates.at(-1)?.repo?.status).toBe('done')
		}),
	)

	it.effect('prefers a host-resolved spec and otherwise uses the shared task spec', ({ expect }) =>
		Effect.gen(function* () {
			const preflightDirectories: string[] = []
			const recordingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) => {
					preflightDirectories.push(input.directory)
					return executor.preflightRepo(input)
				},
			}
			const resolvedSpec: WorkspaceSpec = {
				...spec,
				directory: '/collaborator/repo',
				repos: spec.repos.map((repo) => ({ ...repo, copyGlobs: [] })),
			}

			yield* runActor(
				Stream.fromIterable([
					makeRow({ resolved_workspace_spec: resolvedSpec }),
					makeRow({ id: 'setup-2', resolved_workspace_spec: null }, { id: 'task-2' }),
				]),
				[],
				recordingExecutor,
			)

			expect(preflightDirectories).toEqual(['/collaborator/repo', '/repo'])
		}),
	)

	it.effect('applies a task source commit to a host spec created before the commit was pinned', ({ expect }) =>
		Effect.gen(function* () {
			const sourceCommits: Array<string | undefined> = []
			const recordingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) => {
					sourceCommits.push(input.repo.sourceCommit)
					return executor.preflightRepo(input)
				},
			}
			const hostSpec: WorkspaceSpec = {
				...spec,
				repos: [{ ...spec.repos[0], copyGlobs: [] }],
			}
			const taskSpecWithSourceCommit: WorkspaceSpec = {
				...hostSpec,
				repos: [{ ...hostSpec.repos[0]!, sourceCommit: 'a'.repeat(40) }],
			}

			yield* runActor(
				Stream.succeed(
					makeRow({ resolved_workspace_spec: hostSpec }, { workspace_spec: taskSpecWithSourceCommit }),
				),
				[],
				recordingExecutor,
			)

			expect(sourceCommits).toEqual(['a'.repeat(40)])
		}),
	)

	it.effect('uses a valid host spec when the legacy task spec is malformed', ({ expect }) =>
		Effect.gen(function* () {
			const sourceCommits: Array<string | undefined> = []
			const updates: Array<{ repo?: { status: string } }> = []
			const recordingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) => {
					sourceCommits.push(input.repo.sourceCommit)
					return executor.preflightRepo(input)
				},
			}
			const hostSpec: WorkspaceSpec = {
				...spec,
				repos: [{ ...spec.repos[0], copyGlobs: [] }],
			}

			yield* runActor(
				Stream.succeed(makeRow({ resolved_workspace_spec: hostSpec }, { workspace_spec: {} })),
				updates,
				recordingExecutor,
			)

			expect(sourceCommits).toEqual([undefined])
			expect(updates.at(-1)?.repo?.status).toBe('done')
		}),
	)

	it.effect('parks errored, done, and missing-spec rows', ({ expect }) => {
		const updates: Array<{ repo?: { status: string } }> = []
		const rows = [
			makeRow({ error: { localPath: '.', stage: 'preflight', message: 'failed' } }),
			makeRow({
				status: 'done',
				workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
			}),
			makeRow({}, { workspace_spec: null }),
			makeRow({}, { archived: true }),
		]
		return runActor(Stream.fromIterable(rows), updates).pipe(
			Effect.andThen(Effect.sync(() => expect(updates).toEqual([]))),
		)
	})

	it.effect('cancels every in-flight repo setup when the task is archived', ({ expect }) =>
		Effect.gen(function* () {
			const setupQueue = yield* Queue.unbounded<WorkspaceSetupTask>()
			const taskQueue = yield* Queue.unbounded<TaskChangeMessage>()
			const started = yield* Queue.unbounded<string>()
			const interrupted = yield* Queue.unbounded<string>()
			const twoRepoSpec: WorkspaceSpec = {
				...spec,
				repos: [
					{ ...spec.repos[0], copyGlobs: [] },
					{
						...spec.repos[0],
						localPath: 'secondary',
						targetPath: '/workspaces/task-1/secondary',
						primary: false,
						copyGlobs: [],
					},
				],
			}
			const row = makeRow(
				{
					workspace_setup_state: {
						specVersion: 1,
						repos: [
							{ localPath: '.', status: 'setup_requested' },
							{ localPath: 'secondary', status: 'setup_requested' },
						],
					},
				},
				{ workspace_spec: twoRepoSpec, archived: false },
			)
			const blockingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) =>
					Queue.offer(started, input.repo.localPath).pipe(
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Queue.offer(interrupted, input.repo.localPath)),
					),
			}
			const fiber = yield* runActor(
				Stream.fromQueue(setupQueue),
				[],
				blockingExecutor,
				async () => {},
				row,
				Stream.fromQueue(taskQueue),
			).pipe(Effect.forkChild)

			yield* Queue.offer(setupQueue, row)
			const startedRepos = [yield* Queue.take(started), yield* Queue.take(started)]
			expect(new Set(startedRepos)).toEqual(new Set(['.', 'secondary']))

			const archivedTask = { ...row.task, archived: true, updated_at: 2n } as Task
			yield* Queue.offer(taskQueue, {
				type: 'update',
				value: archivedTask,
				previousValue: row.task,
			} as unknown as TaskChangeMessage)
			const interruptedRepos = [yield* Queue.take(interrupted), yield* Queue.take(interrupted)]
			expect(new Set(interruptedRepos)).toEqual(new Set(['.', 'secondary']))

			yield* Fiber.interrupt(fiber)
		}),
	)

	it.effect('does not run concurrent convergence for rapid updates', ({ expect }) =>
		Effect.gen(function* () {
			let active = 0
			let maxActive = 0
			let preflightCalls = 0
			const preflightStarted = yield* Deferred.make<void>()
			const completedRowObserved = yield* Deferred.make<void>()
			const releasePreflight = yield* Deferred.make<void>()
			const blockingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: () =>
					Effect.gen(function* () {
						yield* Effect.sync(() => {
							preflightCalls += 1
							active += 1
							maxActive = Math.max(maxActive, active)
						})
						yield* Deferred.succeed(preflightStarted, undefined)
						yield* Deferred.await(releasePreflight)
						active -= 1
						return { resolvedSourceCommit: 'abc123' }
					}),
			}
			const row = makeRow()
			const completed = makeRow({
				status: 'done',
				updated_at: 2n,
				workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
			})
			const rows = Stream.fromIterable([row, row, completed]).pipe(
				Stream.tap((currentRow) =>
					currentRow.workspaceSetup.status === 'done'
						? Deferred.succeed(completedRowObserved, undefined)
						: Effect.void,
				),
			)
			const fiber = yield* runActor(rows, [], blockingExecutor).pipe(Effect.forkChild)
			yield* Deferred.await(preflightStarted)
			yield* Deferred.await(completedRowObserved)
			yield* Deferred.succeed(releasePreflight, undefined)
			yield* Fiber.join(fiber)
			expect(maxActive).toBe(1)
			expect(preflightCalls).toBe(1)
		}),
	)

	it.effect('runs at most three workspace rows concurrently', ({ expect }) =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>()
			const started = yield* Queue.unbounded<string>()
			const active = yield* Ref.make(0)
			const maxActive = yield* Ref.make(0)
			const executorWithBlockingPreflight: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) =>
					Effect.gen(function* () {
						const currentActive = yield* Ref.updateAndGet(active, (count) => count + 1)
						yield* Ref.update(maxActive, (currentMax) => Math.max(currentMax, currentActive))
						yield* Queue.offer(started, input.taskId)
						yield* Deferred.await(release)
						yield* Ref.update(active, (count) => count - 1)
						return { resolvedSourceCommit: 'abc123' }
					}),
			}
			const rows = Array.from({ length: 4 }, (_, index) => {
				const id = index + 1
				return makeRow(
					{ id: `setup-${id}`, task_id: `task-${id}` },
					{
						id: `task-${id}`,
						workspace_spec: {
							...spec,
							directory: `/repo-${id}`,
							workspaceBaseDirectory: `/workspaces/task-${id}`,
							repos: [
								{
									...spec.repos[0],
									targetPath: `/workspaces/task-${id}/repo`,
									branch: `task-${id}`,
									copyGlobs: [],
								},
							],
						},
					},
				)
			})

			const fiber = yield* runActor(Stream.fromIterable(rows), [], executorWithBlockingPreflight).pipe(
				Effect.forkChild,
			)
			yield* Queue.take(started)
			yield* Queue.take(started)
			yield* Queue.take(started)
			expect(yield* Ref.get(active)).toBe(3)

			yield* Deferred.succeed(release, undefined)
			yield* Fiber.join(fiber)
			expect(yield* Ref.get(maxActive)).toBe(3)
		}),
	)

	it.effect('handles progress update failure gracefully without crashing the consumer', ({ expect }) =>
		Effect.gen(function* () {
			const updates: Array<{ repo?: { status: string } }> = []
			const attemptFailed = yield* Deferred.make<void>()
			let attempts = 0
			const api = makeApi(updates, () => {
				attempts += 1
				return Deferred.succeed(attemptFailed, undefined).pipe(
					Effect.andThen(Effect.fail(new DaemonTaskCapabilityError({ cause: 'offline' }))),
				)
			})
			const actorRuntimeLayer = makeActorRuntimeLayer(makeCollections(Stream.succeed(makeRow())), api, executor)
			const program = Effect.gen(function* () {
				const actor = yield* WorkspaceSetup
				const fiber = yield* actor.run.pipe(Effect.forkChild)
				yield* Deferred.await(attemptFailed)
				yield* Fiber.join(fiber)
				expect(attempts).toBe(1)
			}).pipe(Effect.provide(actorRuntimeLayer))

			yield* program
		}),
	)

	it.effect('serializes a replay received while the row is active', ({ expect }) => {
		let preflightCalls = 0
		const countingExecutor: WorkspaceSetupExecutorService = {
			...executor,
			preflightRepo: (input) => {
				preflightCalls += 1
				return executor.preflightRepo(input)
			},
		}
		const row = makeRow()
		return runActor(Stream.fromIterable([row, { ...row }]), [], countingExecutor).pipe(
			Effect.andThen(Effect.sync(() => expect(preflightCalls).toBe(2))),
		)
	})

	it.effect('rereads the newest local snapshot when stale events arrive later', ({ expect }) =>
		Effect.gen(function* () {
			let preflightCalls = 0
			const countingExecutor: WorkspaceSetupExecutorService = {
				...executor,
				preflightRepo: (input) => {
					preflightCalls += 1
					return executor.preflightRepo(input)
				},
			}
			const initial = makeRow({ updated_at: 1n })
			const completed = makeRow({
				status: 'done',
				updated_at: 3n,
				workspace_setup_state: { specVersion: 1, repos: [{ localPath: '.', status: 'done' }] },
			})
			const stale = makeRow({ updated_at: 2n })

			yield* runActor(
				Stream.fromIterable([initial, completed, stale]),
				[],
				countingExecutor,
				async () => {},
				completed,
			)
			expect(preflightCalls).toBe(0)
		}),
	)
})
