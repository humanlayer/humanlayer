import { AWAIT_TX_TIMEOUT } from '@humanlayer/sync'
import { Cause, Deferred, Effect, Layer, Stream } from 'effect'

import { DaemonTaskCapabilityError } from '@/effects/services/daemon-api/daemon-api.errors'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import {
	DaemonCollections,
	type WorkspaceSetupTask,
} from '@/effects/services/daemon-collections/daemon-collections.service'
import {
	parseWorkspaceSetupError,
	parseWorkspaceSetupState,
	parseWorkspaceSpecForSetup,
} from '@/effects/workspace-setup/parse-workspace-setup'
import { Sentry } from '@/instrument'
import { convergeWorkspace } from '@/lib/workspace/converge'
import {
	summarizeWorkspaceSetupProgressForDisplay,
	workspaceSetupForTaskOnHostHasCompleted,
} from '@/lib/workspace/ledger'

import {
	WorkspaceSetup,
	type WorkspaceSetupRunError,
	type WorkspaceSetupRunRequirements,
} from './workspace-setup.service'

const INITIAL_RESTART_DELAY_MS = 1_000
const MAX_RESTART_DELAY_MS = 30_000

const restartDelay = (attempt: number): number =>
	Math.min(INITIAL_RESTART_DELAY_MS * 2 ** attempt, MAX_RESTART_DELAY_MS)

export const processWorkspaceSetupRow = (row: WorkspaceSetupTask) =>
	Effect.gen(function* () {
		const setup = row.workspaceSetup
		if (row.task.archived) {
			yield* Effect.logDebug('Workspace setup join is not actionable').pipe(
				Effect.annotateLogs({
					task_id: row.task.id,
					decision_reason: 'task_archived',
				}),
			)
			return
		}
		if (row.task.workspace_spec === null) {
			yield* Effect.logDebug('Workspace setup join is not actionable').pipe(
				Effect.annotateLogs({
					task_id: row.task.id,
					decision_reason: 'workspace_spec_missing',
				}),
			)
			return
		}
		const context = { taskId: setup.task_id, hostId: setup.host_id, rowId: setup.id }
		const spec = yield* parseWorkspaceSpecForSetup(
			{
				resolvedWorkspaceSpec: setup.resolved_workspace_spec,
				taskWorkspaceSpec: row.task.workspace_spec,
			},
			context,
		)
		const state = yield* parseWorkspaceSetupState(setup.workspace_setup_state, context)
		const attributes = {
			task_id: setup.task_id,
			host_id: setup.host_id,
			setup_row_id: setup.id,
			setup_status: setup.status,
		}
		if (setup.error !== null) {
			yield* parseWorkspaceSetupError(setup.error, context)
			yield* Effect.logInfo('Workspace setup row is parked on an error').pipe(
				Effect.annotateLogs({ ...attributes, decision_reason: 'setup_row_parked_on_error' }),
			)
			return
		}
		if (workspaceSetupForTaskOnHostHasCompleted(state)) return
		yield* convergeWorkspace({
			spec,
			setupRowId: setup.id,
			setupState: state,
			taskId: setup.task_id,
			hostId: setup.host_id,
		})
		yield* Effect.logDebug('Workspace setup row converged').pipe(
			Effect.annotateLogs({ ...attributes, progress: summarizeWorkspaceSetupProgressForDisplay(state) }),
		)
	}).pipe(
		Effect.withSpan('workspace_setup.process_row', {
			attributes: { task_id: row.task.id, setup_row_id: row.workspaceSetup.id },
		}),
	)

export const WorkspaceSetupLive = Layer.effect(
	WorkspaceSetup,
	Effect.gen(function* () {
		const collections = yield* DaemonCollections
		const api = yield* DaemonApi

		const run = Effect.gen(function* () {
			const localCollections = yield* collections.current
			const confirmingApi = DaemonApi.of({
				...api,
				updateWorkspaceSetup: (input) =>
					api.updateWorkspaceSetup(input).pipe(
						Effect.tap((result) =>
							Effect.tryPromise({
								try: () =>
									localCollections.workspaceSetup.utils.awaitTxId(
										Number(result.transactionId),
										AWAIT_TX_TIMEOUT,
									),
								catch: (cause) => new DaemonTaskCapabilityError({ cause }),
							}),
						),
					),
			})
			const active = new Map<
				string,
				{
					eventCount: number
					taskId: string
					cancel: Deferred.Deferred<void>
					cancelled: boolean
				}
			>()
			const lastProcessed = new Map<string, bigint>()
			const lastProcessedTask = new Map<string, bigint>()
			let processedSinceRestart = false
			const cancelTaskSetups = (taskId: string) =>
				Effect.gen(function* () {
					let cancelledCount = 0
					for (const state of active.values()) {
						if (state.taskId !== taskId || state.cancelled) continue
						state.cancelled = true
						if (yield* Deferred.succeed(state.cancel, undefined)) cancelledCount += 1
					}
					if (cancelledCount > 0) {
						yield* Effect.logInfo('Cancelled workspace setup for archived task').pipe(
							Effect.annotateLogs({ task_id: taskId, cancelled_setup_count: cancelledCount }),
						)
					}
				})
			yield* collections.taskChanges.pipe(
				Stream.filter((change) => change.value.archived),
				Stream.runForEach((change) => cancelTaskSetups(change.value.id)),
				Effect.forkScoped,
			)

			const process = (row: WorkspaceSetupTask) =>
				processWorkspaceSetupRow(row).pipe(
					Effect.provideService(DaemonApi, confirmingApi),
					Effect.tapDefect((cause) =>
						Effect.logError('Workspace setup row failed').pipe(
							Effect.annotateLogs({
								setup_row_id: row.workspaceSetup.id,
								task_id: row.task.id,
								cause,
							}),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(cause, {
										tags: { error_type: 'workspace_setup_row_failed' },
										extra: { setupRowId: row.workspaceSetup.id, taskId: row.task.id },
									}),
								),
							),
						),
					),
					Effect.catchTags({
						DaemonTaskCapabilityError: (error) =>
							Effect.logWarning('Workspace setup API call rejected; will retry on next sync event').pipe(
								Effect.annotateLogs({
									setup_row_id: row.workspaceSetup.id,
									task_id: row.task.id,
									cause: error.cause,
								}),
							),
						InvalidWorkspaceSetupErrorError: () => Effect.void,
						InvalidWorkspaceSetupStateError: () => Effect.void,
						InvalidWorkspaceSpecError: () => Effect.void,
					}),
				)
			const consume = (
				row: WorkspaceSetupTask,
			): Effect.Effect<void, WorkspaceSetupRunError, WorkspaceSetupRunRequirements> => {
				processedSinceRestart = true
				const key = row.workspaceSetup.id
				const existing = active.get(key)
				if (existing !== undefined) {
					if (row.task.archived) return cancelTaskSetups(row.task.id)
					if (existing.cancelled) {
						active.delete(key)
						return consume(row)
					}
					existing.eventCount += 1
					return Effect.void
				}
				if (
					row.workspaceSetup.updated_at <= (lastProcessed.get(key) ?? -1n) &&
					row.task.updated_at <= (lastProcessedTask.get(key) ?? -1n)
				)
					return Effect.void

				return Deferred.make<void>().pipe(
					Effect.flatMap((cancel) => {
						const state = { eventCount: 1, taskId: row.task.id, cancel, cancelled: false }
						active.set(key, state)
						const rereadCurrentJoin = (): WorkspaceSetupTask | undefined => {
							const workspaceSetup = localCollections.workspaceSetup.toArray.find(
								(setup) => setup.id === key,
							)
							if (workspaceSetup === undefined) return undefined
							const task = localCollections.tasks.toArray.find(
								(candidate) => candidate.id === workspaceSetup.task_id,
							)
							if (task === undefined) return undefined
							return { task, workspaceSetup } as WorkspaceSetupTask
						}
						const drain = (): Effect.Effect<void, WorkspaceSetupRunError, WorkspaceSetupRunRequirements> =>
							Effect.suspend(() => {
								if (state.cancelled) return Effect.void
								const passEventCount = state.eventCount
								const current = rereadCurrentJoin()
								const processCurrent =
									current === undefined
										? Effect.void
										: process(current).pipe(
												Effect.raceFirst(Deferred.await(cancel)),
												Effect.tap(() =>
													Effect.sync(() => {
														lastProcessed.set(key, current.workspaceSetup.updated_at)
														lastProcessedTask.set(key, current.task.updated_at)
													}),
												),
											)
								return processCurrent.pipe(
									Effect.andThen(
										Effect.suspend(() =>
											Effect.sync(() => {
												if (state.cancelled) return false
												if (state.eventCount !== passEventCount) return true
												active.delete(key)
												return false
											}).pipe(Effect.flatMap((again) => (again ? drain() : Effect.void))),
										),
									),
								)
							})
						return drain().pipe(
							Effect.ensuring(
								Effect.sync(() => {
									if (active.get(key) === state) active.delete(key)
								}),
							),
						)
					}),
				)
			}

			const runOnce = collections.workspaceSetups.pipe(
				Stream.mapEffect(consume, { concurrency: 3 }),
				Stream.runDrain,
				Effect.withSpan('workspace_setup.run_once'),
			)
			const runSupervised = (attempt: number): Effect.Effect<void, never, WorkspaceSetupRunRequirements> =>
				Effect.sync(() => {
					processedSinceRestart = false
				}).pipe(
					Effect.andThen(runOnce),
					Effect.catchCause((cause) => {
						if (Cause.hasInterrupts(cause)) return Effect.interrupt
						const delayMs = restartDelay(processedSinceRestart ? 0 : attempt)
						const nextAttempt = processedSinceRestart ? 0 : attempt + 1
						return Effect.logError('Workspace setup consumer stopped; restarting').pipe(
							Effect.annotateLogs({ attempt: attempt + 1, restart_delay_ms: delayMs, cause }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(cause, {
										tags: { error_type: 'workspace_setup_consumer_stopped' },
										extra: { attempt: attempt + 1, restartDelayMs: delayMs },
									}),
								),
							),
							Effect.andThen(Effect.sleep(delayMs)),
							Effect.andThen(Effect.suspend(() => runSupervised(nextAttempt))),
						)
					}),
				)

			yield* runSupervised(0)
		}).pipe(Effect.scoped, Effect.withSpan('workspace_setup.run'))

		return { run }
	}),
)
