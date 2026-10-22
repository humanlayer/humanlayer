import { Event, Machine, State } from '@humanlayer/effect-machine'
import { isSessionStatusAwaitingLaunch, SessionStatus } from '@humanlayer/schemas/effect/session/session-status'
import { Cause, Duration, Effect, Predicate } from 'effect'
import * as Schema from 'effect/Schema'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { WorkspaceSessionLaunchHandoff, WorkspaceSessionRunner } from './workspace-session-runner.service'

export const WorkspaceSessionLaunchIdentity = Schema.Struct({
	sessionId: Schema.String,
	workspaceId: Schema.String,
})
export type WorkspaceSessionLaunchIdentity = typeof WorkspaceSessionLaunchIdentity.Type

/**
 * One deterministic actor per V2 session. It reloads authoritative readiness on every hint or
 * recheck, marks the session waiting at most once, and hands the session to the runner exactly
 * once. Every final state means this actor will never hand off again; a later hint or the
 * synced session/task event spawns a fresh actor if the session still waits.
 */
export const WorkspaceSessionLaunchState = State({
	Checking: {
		identity: WorkspaceSessionLaunchIdentity,
		attempt: Schema.Number,
		markedWaiting: Schema.Boolean,
	},
	Waiting: {
		identity: WorkspaceSessionLaunchIdentity,
		attempt: Schema.Number,
		markedWaiting: Schema.Boolean,
		reason: Schema.String,
	},
	Launching: { identity: WorkspaceSessionLaunchIdentity, markedWaiting: Schema.Boolean },
	Launched: { identity: WorkspaceSessionLaunchIdentity },
	NotLaunchable: { identity: WorkspaceSessionLaunchIdentity, reason: Schema.String },
	Failed: { identity: WorkspaceSessionLaunchIdentity, message: Schema.String },
})
export type WorkspaceSessionLaunchState = typeof WorkspaceSessionLaunchState.Type

export const WorkspaceSessionLaunchEvent = Event({
	ReadinessObserved: {
		ready: Schema.Boolean,
		sessionStatus: SessionStatus,
		markedWaiting: Schema.Boolean,
	},
	ReadinessCheckFailed: { message: Schema.String },
	SessionGone: {},
	Wake: {},
	HandedOff: {},
	HandoffDeferred: { reason: Schema.String },
	HandoffSkipped: { reason: Schema.String },
	HandoffFailed: { message: Schema.String },
})
export type WorkspaceSessionLaunchEvent = typeof WorkspaceSessionLaunchEvent.Type

export interface WorkspaceSessionLaunchSchedule {
	/** Delay between authoritative rechecks while the workspace is not ready. */
	readonly recheckInterval: Duration.Duration
	/** Upper bound for the exponential delay after consecutive readiness-check failures. */
	readonly failureRecheckCeiling: Duration.Duration
}

export const workspaceSessionRecheckDelay = (
	schedule: WorkspaceSessionLaunchSchedule,
	attempt: number,
): Duration.Duration =>
	attempt <= 0
		? schedule.recheckInterval
		: Duration.min(Duration.times(schedule.recheckInterval, 2 ** attempt), schedule.failureRecheckCeiling)

const describeCause = (cause: Cause.Cause<unknown>) => Cause.pretty(cause)

const describeUnknown = (value: unknown) =>
	Predicate.isError(value) ? value.message : Predicate.isString(value) ? value : String(value)

const checkReadiness = (state: {
	readonly identity: WorkspaceSessionLaunchIdentity
	readonly markedWaiting: boolean
}) =>
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const setup = yield* api.getSessionWorkspaceSetup({
			sessionId: state.identity.sessionId,
			workspaceId: state.identity.workspaceId,
		})
		const shouldMarkWaiting =
			!setup.ready &&
			!state.markedWaiting &&
			// Legacy parity: only a freshly created session is moved to waiting; later statuses
			// already tell the user what is happening.
			setup.sessionStatus === 'ready_for_launch'
		if (!shouldMarkWaiting) {
			return WorkspaceSessionLaunchEvent.ReadinessObserved({
				ready: setup.ready,
				sessionStatus: setup.sessionStatus,
				markedWaiting: state.markedWaiting,
			})
		}
		yield* Effect.logInfo('V2 session waiting for workspace readiness').pipe(
			Effect.annotateLogs({
				session_id: state.identity.sessionId,
				workspace_id: state.identity.workspaceId,
			}),
		)
		const markedWaiting = yield* api
			.updateSession({ sessionId: state.identity.sessionId, status: 'waiting_for_workspace' })
			.pipe(
				Effect.as(true),
				Effect.catchTag('DaemonSessionUpdateError', (error) =>
					Effect.logError('Failed to mark session waiting for workspace').pipe(
						Effect.annotateLogs({ session_id: state.identity.sessionId, cause: error.cause }),
						Effect.as(false),
					),
				),
			)
		return WorkspaceSessionLaunchEvent.ReadinessObserved({
			ready: false,
			sessionStatus: setup.sessionStatus,
			markedWaiting,
		})
	}).pipe(
		Effect.catchTag('DaemonWorkspaceSessionSetupNotFound', () =>
			Effect.logInfo('V2 session is no longer served for this daemon; stopping launch actor').pipe(
				Effect.annotateLogs({
					session_id: state.identity.sessionId,
					workspace_id: state.identity.workspaceId,
				}),
				Effect.as(WorkspaceSessionLaunchEvent.SessionGone),
			),
		),
		Effect.catchTag('DaemonWorkspaceSessionSetupError', (error) =>
			Effect.succeed(WorkspaceSessionLaunchEvent.ReadinessCheckFailed({ message: describeUnknown(error.cause) })),
		),
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.interrupt
				: Effect.logError('V2 session readiness check defected').pipe(
						Effect.annotateLogs({ session_id: state.identity.sessionId, cause }),
						Effect.as(WorkspaceSessionLaunchEvent.ReadinessCheckFailed({ message: describeCause(cause) })),
					),
		),
		Effect.withSpan('workspace_session_launch.check_readiness', {
			attributes: {
				session_id: state.identity.sessionId,
				workspace_id: state.identity.workspaceId,
			},
		}),
	)

const handOffSession = (state: { readonly identity: WorkspaceSessionLaunchIdentity }) =>
	Effect.gen(function* () {
		const runner = yield* WorkspaceSessionRunner
		const handoff = yield* runner.handOffReadySession({ sessionId: state.identity.sessionId })
		return WorkspaceSessionLaunchHandoff.$match(handoff, {
			HandedOff: () => WorkspaceSessionLaunchEvent.HandedOff,
			Deferred: ({ reason }) => WorkspaceSessionLaunchEvent.HandoffDeferred({ reason }),
			Skipped: ({ reason }) => WorkspaceSessionLaunchEvent.HandoffSkipped({ reason }),
		})
	}).pipe(
		Effect.catchCause((cause) =>
			Cause.hasInterruptsOnly(cause)
				? Effect.interrupt
				: Effect.logError('V2 session launch dispatch defected').pipe(
						Effect.annotateLogs({ session_id: state.identity.sessionId, cause }),
						Effect.as(WorkspaceSessionLaunchEvent.HandoffFailed({ message: describeCause(cause) })),
					),
		),
		Effect.withSpan('workspace_session_launch.hand_off_session', {
			attributes: {
				session_id: state.identity.sessionId,
				workspace_id: state.identity.workspaceId,
			},
		}),
	)

export const makeWorkspaceSessionLaunchMachine = (input: {
	readonly identity: WorkspaceSessionLaunchIdentity
	readonly schedule: WorkspaceSessionLaunchSchedule
}) =>
	Machine.make({
		state: WorkspaceSessionLaunchState,
		event: WorkspaceSessionLaunchEvent,
		initial: WorkspaceSessionLaunchState.Checking({ identity: input.identity, attempt: 0, markedWaiting: false }),
	})
		.task(WorkspaceSessionLaunchState.Checking, ({ state }) => checkReadiness(state), {
			name: 'check_readiness',
			onSuccess: (event) => event,
		})
		.on(WorkspaceSessionLaunchState.Checking, WorkspaceSessionLaunchEvent.ReadinessObserved, ({ state, event }) => {
			if (!isSessionStatusAwaitingLaunch(event.sessionStatus)) {
				return WorkspaceSessionLaunchState.NotLaunchable({
					identity: state.identity,
					reason: `session status is ${event.sessionStatus}`,
				})
			}
			if (event.ready) {
				return WorkspaceSessionLaunchState.Launching({
					identity: state.identity,
					markedWaiting: event.markedWaiting,
				})
			}
			return WorkspaceSessionLaunchState.Waiting({
				identity: state.identity,
				attempt: 0,
				markedWaiting: event.markedWaiting,
				reason: 'workspace_not_ready',
			})
		})
		.on(
			WorkspaceSessionLaunchState.Checking,
			WorkspaceSessionLaunchEvent.ReadinessCheckFailed,
			({ state, event }) =>
				WorkspaceSessionLaunchState.Waiting({
					identity: state.identity,
					attempt: state.attempt + 1,
					markedWaiting: state.markedWaiting,
					reason: event.message,
				}),
		)
		.on(WorkspaceSessionLaunchState.Checking, WorkspaceSessionLaunchEvent.SessionGone, ({ state }) =>
			WorkspaceSessionLaunchState.NotLaunchable({ identity: state.identity, reason: 'session_not_found' }),
		)
		// A check is already in flight; its answer is at least as fresh as the hint.
		.on(WorkspaceSessionLaunchState.Checking, WorkspaceSessionLaunchEvent.Wake, ({ state }) => state)
		.timeout(WorkspaceSessionLaunchState.Waiting, {
			duration: (state) => workspaceSessionRecheckDelay(input.schedule, state.attempt),
			event: WorkspaceSessionLaunchEvent.Wake,
		})
		.on(WorkspaceSessionLaunchState.Waiting, WorkspaceSessionLaunchEvent.Wake, ({ state }) =>
			WorkspaceSessionLaunchState.Checking({
				identity: state.identity,
				attempt: state.attempt,
				markedWaiting: state.markedWaiting,
			}),
		)
		.task(WorkspaceSessionLaunchState.Launching, ({ state }) => handOffSession(state), {
			name: 'hand_off_session',
			onSuccess: (event) => event,
		})
		.on(WorkspaceSessionLaunchState.Launching, WorkspaceSessionLaunchEvent.HandedOff, ({ state }) =>
			WorkspaceSessionLaunchState.Launched({ identity: state.identity }),
		)
		.on(WorkspaceSessionLaunchState.Launching, WorkspaceSessionLaunchEvent.HandoffDeferred, ({ state, event }) =>
			WorkspaceSessionLaunchState.Waiting({
				identity: state.identity,
				attempt: 0,
				markedWaiting: state.markedWaiting,
				reason: event.reason,
			}),
		)
		.on(WorkspaceSessionLaunchState.Launching, WorkspaceSessionLaunchEvent.HandoffSkipped, ({ state, event }) =>
			WorkspaceSessionLaunchState.NotLaunchable({ identity: state.identity, reason: event.reason }),
		)
		.on(WorkspaceSessionLaunchState.Launching, WorkspaceSessionLaunchEvent.HandoffFailed, ({ state, event }) =>
			WorkspaceSessionLaunchState.Failed({ identity: state.identity, message: event.message }),
		)
		// The handoff is already running; a hint must never cause a second one.
		.on(WorkspaceSessionLaunchState.Launching, WorkspaceSessionLaunchEvent.Wake, ({ state }) => state)
		.final(WorkspaceSessionLaunchState.Launched)
		.final(WorkspaceSessionLaunchState.NotLaunchable)
		.final(WorkspaceSessionLaunchState.Failed)
