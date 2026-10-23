import { Cause, Duration, Effect, Fiber, Layer, Ref, Stream } from 'effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { DaemonServices } from '@/agents/claudecode/types'
import { parseSessionLaunchCandidate } from '@/collections/parse-session-launch-candidate'
import type { SessionChangeMessage } from '@/collections/types'
import {
	DaemonCollections,
	type TaskChangeMessage,
	type WorkspaceSetupSession,
	type WorkspaceSetupTask,
} from '@/effects/services/daemon-collections/daemon-collections.service'
import { SessionLaunchExecutor } from '@/effects/services/session-runs/session-launch-executor.service'
import { SessionRunRegistry } from '@/effects/services/session-runs/session-run-registry'
import {
	makeTaskDiffCollectionLifecycle,
	type TaskDiffCollectionLifecycle,
} from '@/effects/services/task-diff/task-diff-collection-lifecycle'
import { WorkspaceSessionLaunchActors } from '@/effects/services/workspace-session-launch/workspace-session-launch-actors.service'
import { WorkspaceSessionRunnerLive } from '@/effects/services/workspace-session-launch/workspace-session-runner.layer'
import { warnIfEffectExceeds } from '@/effects/warn-if-effect-exceeds'
import { parseWorkspaceSetupState, parseWorkspaceSpec } from '@/effects/workspace-setup/parse-workspace-setup'
import { handleArchivedSessionChange } from '@/handlers/sessions/on-session-archive'
import { handleContinueSession, shouldContinueSession } from '@/handlers/sessions/on-session-continue'
import { handleLaunchSession, shouldLaunchSession } from '@/handlers/sessions/on-session-launch'
import { Sentry } from '@/instrument'
import { describeUnknownError } from '@/lib/safe-error-display'
import { normalizePath } from '@/lib/utils'
import { workspaceSetupStateAllowsSessionLaunch } from '@/lib/workspace/ledger'
import logger from '@/logger'

type CollectionRow<Name extends keyof DaemonServices['collections']> =
	DaemonServices['collections'][Name]['toArray'][number]

type WorkspaceLaunchRow = {
	readonly session: SessionChangeMessage['value']
	readonly task: CollectionRow<'tasks'> | WorkspaceSetupTask['task']
	readonly workspaceSetup: CollectionRow<'workspaceSetup'> | NonNullable<WorkspaceSetupSession['workspaceSetup']>
}

const sessionChangeSlowThreshold = Duration.seconds(5)

function extractCauseFailure<E>(cause: Cause.Cause<E>): unknown {
	const failure = cause.reasons.find(Cause.isFailReason)
	if (failure !== undefined) return failure.error
	const defect = cause.reasons.find(Cause.isDieReason)
	return defect?.defect ?? cause
}

/** Contain a run's failure: log, report, and mark the session failed. Interruption is silent. */
const reportSessionRunFailure =
	(services: DaemonServices, sessionId: string) =>
	<E>(run: Effect.Effect<void, E>): Effect.Effect<void> =>
		run.pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterrupts(cause)
					? Effect.void
					: Effect.promise(() => handleSessionFailure(services, sessionId, extractCauseFailure(cause))),
			),
		)

/** Fork a legacy session run into the ambient scope unless the session already has one in flight. */
export const forkSessionRun = <E>(services: DaemonServices, sessionId: string, run: Effect.Effect<void, E>) =>
	Effect.gen(function* () {
		const registry = yield* SessionRunRegistry
		yield* registry.forkExclusiveSessionRun({
			sessionId,
			run: run.pipe(reportSessionRunFailure(services, sessionId)),
		})
	})

const forkSessionContinuation = <E>(services: DaemonServices, sessionId: string, run: Effect.Effect<void, E>) =>
	run.pipe(reportSessionRunFailure(services, sessionId), Effect.forkScoped, Effect.asVoid)

const CauseCarrier = Schema.Struct({ cause: Schema.Unknown })

function extractErrorMessage(error: unknown): string {
	const cause = Option.getOrUndefined(Schema.decodeUnknownOption(CauseCarrier)(error))?.cause
	if (Cause.isCause(cause)) {
		const failure = cause.reasons.find(Cause.isFailReason)?.error
		if (failure !== undefined) return describeUnknownError(failure)
	}
	return describeUnknownError(error)
}

const handleSessionFailure = async (services: DaemonServices, sessionId: string, error: unknown) => {
	logger.error({ err: error, sessionId }, 'Unhandled session subscription error')
	Sentry.captureException(error, {
		tags: { error_type: 'session_subscription_unhandled', session_id: sessionId },
	})
	try {
		await services.orpc.sessions.update({
			sessionId,
			status: 'failed',
			errorMessage: extractErrorMessage(error),
		})
	} catch (updateError) {
		logger.error({ err: updateError, sessionId }, 'Failed to mark session failed')
	}
}

export const launchWorkspaceSession = (row: WorkspaceLaunchRow, services: DaemonServices) =>
	Effect.gen(function* () {
		const { session, task, workspaceSetup } = row
		if (
			!shouldLaunchSession({ type: 'update', value: session }) ||
			task.workspace_spec == null ||
			workspaceSetup.workspace_setup_state === undefined
		)
			return
		const context = { taskId: task.id, hostId: session.host_id, rowId: workspaceSetup.id }
		const workspaceSpec = yield* parseWorkspaceSpec(task.workspace_spec, context)
		const workspaceSetupState = yield* parseWorkspaceSetupState(workspaceSetup.workspace_setup_state, context)
		if (!workspaceSetupStateAllowsSessionLaunch(workspaceSetupState, workspaceSpec)) {
			if (session.status === 'ready_for_launch') {
				yield* Effect.promise(() =>
					services.orpc.sessions.update({ sessionId: session.id, status: 'waiting_for_workspace' }),
				)
			}
			return
		}
		yield* Effect.promise(() =>
			handleLaunchSession({ type: 'update', value: session }, services, { workspaceSpec, workspaceSetupState }),
		)
	})

const observeDaemonChangeFailure = (
	message: string,
	attributes: Record<string, string | number | null | undefined>,
	cause: Cause.Cause<unknown>,
) =>
	Effect.logError(message).pipe(
		Effect.annotateLogs({ ...attributes, cause }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(cause, {
					tags: { operation: 'daemon_subscriptions.process_change' },
					extra: attributes,
				}),
			),
		),
	)

const isolateDaemonChange = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	message: string,
	attributes: Record<string, string | number | null | undefined>,
) =>
	effect.pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterrupts(cause)
				? Effect.interrupt
				: observeDaemonChangeFailure(message, attributes, cause).pipe(Effect.asVoid),
		),
	)

export const processSessionChange = (
	change: SessionChangeMessage,
	services: DaemonServices,
	lifecycle: TaskDiffCollectionLifecycle,
) => {
	const session = change.value
	const attributes = {
		session_id: session.id,
		task_id: session.task_id,
		change_type: change.type,
		coding_agent: session.coding_agent,
		session_status: session.status,
	}
	return Effect.gen(function* () {
		if (services.automationTargetSessionId !== undefined && session.id !== services.automationTargetSessionId)
			return
		if (services.automationLifecycle !== undefined) {
			yield* services.automationLifecycle.recordSessionActivity(session.status)
		}
		lifecycle.reconcileSessionChanges([change])
		if (change.type === 'delete' || session.archived) {
			handleArchivedSessionChange(change, services)
			return
		}
		const taskId = session.task_id
		const workingDirectory = session.working_directory
		if (taskId !== null && workingDirectory !== null && session.status === 'running')
			yield* Effect.promise(() => services.syncService.ensureTaskSync(taskId, normalizePath(workingDirectory)))

		if (shouldLaunchSession(change) && taskId !== null) {
			const task = services.collections.tasks.toArray.find((item) => item.id === taskId)
			if (task === undefined) return
			if (task.is_draft) return
			if (task.workspace_id != null) {
				// V2: the synced row is only a hint. The launch actor reloads authoritative readiness.
				const launchActors = yield* WorkspaceSessionLaunchActors
				yield* launchActors.ensureLaunchActor({ sessionId: session.id, workspaceId: task.workspace_id })
				return
			}
			if (task.workspace_spec != null) return
		}
		if (shouldLaunchSession(change))
			yield* forkSessionRun(
				services,
				session.id,
				Effect.promise(() => handleLaunchSession(change, services)),
			)
		else if (shouldContinueSession(change))
			yield* forkSessionContinuation(
				services,
				session.id,
				Effect.promise(() => handleContinueSession(change, services)),
			)
	}).pipe(
		(effect) =>
			warnIfEffectExceeds(effect, {
				attributes,
				logMessage: 'Session change processing exceeded head-of-line blocking threshold',
				sentryMessage: 'Daemon session change processing is blocked',
				sentryOperation: 'daemon_subscriptions.head_of_line_blocking',
				threshold: sessionChangeSlowThreshold,
			}),
		(effect) => isolateDaemonChange(effect, 'Session change processing failed', attributes),
		Effect.withSpan('daemon_subscriptions.process_session_change', { attributes }),
	)
}

export const processTaskChange = (
	change: TaskChangeMessage,
	services: DaemonServices,
	lifecycle: TaskDiffCollectionLifecycle,
) => {
	const task = change.value
	const attributes = { task_id: task.id }
	return Effect.gen(function* () {
		lifecycle.reconcileTaskChanges([change])
		if (change.type === 'delete') return
		const candidates = services.collections.sessions.toArray.filter(
			(session) =>
				session.task_id === task.id &&
				(services.automationTargetSessionId === undefined ||
					session.id === services.automationTargetSessionId) &&
				shouldLaunchSession({ type: 'update', value: session }),
		)
		for (const rawCandidate of candidates) {
			const session = parseSessionLaunchCandidate(rawCandidate)
			if (session === undefined) {
				yield* Effect.logWarning('Skipped malformed session launch candidate').pipe(
					Effect.annotateLogs({ task_id: task.id, session_id: rawCandidate.id }),
				)
				continue
			}
			if ('workspace_id' in task && task.workspace_id != null) {
				const launchActors = yield* WorkspaceSessionLaunchActors
				yield* launchActors.ensureLaunchActor({ sessionId: session.id, workspaceId: String(task.workspace_id) })
				continue
			}
			if (!('workspace_spec' in task) || task.workspace_spec == null) {
				yield* forkSessionRun(
					services,
					session.id,
					Effect.promise(() => handleLaunchSession({ type: 'update', value: session }, services)),
				)
				continue
			}
			const workspaceSetup = services.collections.workspaceSetup.toArray.find(
				(row) => row.task_id === task.id && row.host_id === session.host_id,
			)
			if (workspaceSetup === undefined) continue
			yield* forkSessionRun(
				services,
				session.id,
				launchWorkspaceSession({ session, task, workspaceSetup }, services),
			)
		}
	}).pipe(
		(effect) => isolateDaemonChange(effect, 'Task change processing failed', attributes),
		Effect.withSpan('daemon_subscriptions.process_task_change', { attributes }),
	)
}

export const processWorkspaceSessionChange = (row: WorkspaceSetupSession, services: DaemonServices) => {
	const attributes = {
		setup_row_id: row.workspaceSetup?.id,
		session_id: row.session.id,
		task_id: row.session.task_id,
	}
	return Effect.gen(function* () {
		if (services.automationTargetSessionId !== undefined && row.session.id !== services.automationTargetSessionId)
			return
		if (row.workspaceSetup == null || row.workspaceSetup.id == null || row.session.task_id === null) return
		const session = parseSessionLaunchCandidate(row.session)
		if (session === undefined) {
			yield* Effect.logWarning('Skipped malformed workspace session launch candidate').pipe(
				Effect.annotateLogs(attributes),
			)
			return
		}
		const task = services.collections.tasks.toArray.find((task) => task.id === session.task_id)
		if (task === undefined) return
		yield* forkSessionRun(
			services,
			session.id,
			launchWorkspaceSession({ session, task, workspaceSetup: row.workspaceSetup }, services),
		)
	}).pipe(
		(effect) => isolateDaemonChange(effect, 'Workspace-gated session launch failed', attributes),
		Effect.withSpan('daemon_subscriptions.process_workspace_session_change', { attributes }),
	)
}

/**
 * The legacy launch path as an Effect service. This is the only place the promise-based runner
 * meets the daemon's Effect services, so `DaemonServices` never travels further than this layer.
 */
export const makeLegacySessionLaunchExecutorLive = (services: DaemonServices) =>
	Layer.succeed(
		SessionLaunchExecutor,
		SessionLaunchExecutor.of({
			executeSessionLaunch: ({ session }) =>
				Effect.promise(() => handleLaunchSession({ type: 'update', value: session }, services)).pipe(
					reportSessionRunFailure(services, session.id),
					Effect.withSpan('session_launch_executor.execute_session_launch', {
						attributes: { session_id: session.id },
					}),
				),
		}),
	)

const subscriptionRestartDelay = (attempt: number): number => Math.min(1_000 * 2 ** attempt, 30_000)

export const superviseDaemonSubscriptionConsumer = <E, R>(
	runOnce: (markHealthy: Effect.Effect<void>) => Effect.Effect<void, E, R>,
) =>
	Effect.gen(function* () {
		const restartAttempt = yield* Ref.make(0)
		const run = (): Effect.Effect<void, never, R> =>
			runOnce(Ref.set(restartAttempt, 0)).pipe(
				Effect.catchCause((cause) => {
					if (Cause.hasInterrupts(cause)) return Effect.interrupt
					return Effect.gen(function* () {
						const attempt = yield* Ref.getAndUpdate(restartAttempt, (current) => current + 1)
						const delay = subscriptionRestartDelay(attempt)
						yield* Effect.logError('Daemon domain stream consumer stopped; restarting').pipe(
							Effect.annotateLogs({ cause, restart_delay_ms: delay }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(cause, {
										tags: { operation: 'daemon_subscriptions.consumer_stopped' },
										extra: { restartDelayMs: delay },
									}),
								),
							),
						)
						yield* Effect.sleep(delay)
						return yield* run()
					})
				}),
			)
		return yield* run()
	}).pipe(Effect.withSpan('daemon_subscriptions.supervise_consumer'))

/** Consume DaemonCollections domain streams. Collection ownership stays in the scoped service. */
export function initializeSubscriptions(services: DaemonServices) {
	const lifecycle = makeTaskDiffCollectionLifecycle({
		collections: services.collections,
		runtime: services.daemonRuntime,
	})
	const program = superviseDaemonSubscriptionConsumer((markHealthy) =>
		Effect.gen(function* () {
			const collections = yield* DaemonCollections
			const sessions = collections.sessionChanges.pipe(
				Stream.mapEffect((change) => processSessionChange(change, services, lifecycle)),
				Stream.tap(() => markHealthy),
				Stream.runDrain,
			)
			const tasks = collections.taskChanges.pipe(
				Stream.mapEffect((change) => processTaskChange(change, services, lifecycle)),
				Stream.tap(() => markHealthy),
				Stream.runDrain,
			)
			const workspaceLaunches = collections.workspaceSetupSessions.pipe(
				Stream.mapEffect((row) => processWorkspaceSessionChange(row, services)),
				Stream.tap(() => markHealthy),
				Stream.runDrain,
			)
			// Both generations recover through initial-state replay and subsequent synced changes.
			// Task changes revisit waiting sessions when the task arrives after the session.
			yield* Effect.all([sessions, tasks, workspaceLaunches], {
				concurrency: 'unbounded',
				discard: true,
			})
		}).pipe(Effect.withSpan('daemon_subscriptions.run_once')),
	)
	// Session runs are composed here because the legacy launcher needs DaemonServices, which exist
	// only after the daemon runtime is built. The runtime owns the one session-run registry that
	// legacy launches, the V2 runner and host machine stats share; everything else comes from it too.
	const SessionRunsLive = WorkspaceSessionRunnerLive.pipe(
		Layer.provideMerge(makeLegacySessionLaunchExecutorLive(services)),
	)
	const fiber = services.daemonRuntime.runFork(program.pipe(Effect.provide(SessionRunsLive), Effect.scoped))
	lifecycle.reconcileAllTasks()
	return () => services.daemonRuntime.runPromise(Fiber.interrupt(fiber))
}
