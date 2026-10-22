import { type ActorExit, type ActorRef, ActorSystemService } from '@humanlayer/effect-machine'
import * as Sentry from '@sentry/node'
import { Cause, Config, Deferred, Duration, Effect, Layer, Match, Semaphore } from 'effect'

import {
	WorkspaceSessionLaunchActors,
	type WorkspaceSessionLaunchIdentity,
	type WorkspaceSessionLaunchStateTag,
} from './workspace-session-launch-actors.service'
import {
	makeWorkspaceSessionLaunchMachine,
	type WorkspaceSessionLaunchEvent,
	WorkspaceSessionLaunchEvent as LaunchEvent,
	type WorkspaceSessionLaunchSchedule,
	type WorkspaceSessionLaunchState,
} from './workspace-session-launch.machine'

interface RegisteredLaunchActor {
	readonly workspaceId: string
	readonly actor: ActorRef<WorkspaceSessionLaunchState, WorkspaceSessionLaunchEvent>
	readonly exited: Deferred.Deferred<void>
}

const launchActorId = (sessionId: string) => `workspace-session-launch:${sessionId}`

const captureLaunchActorFailure = (message: string, attributes: Record<string, unknown>, error: unknown) =>
	Effect.logError(message, error).pipe(
		Effect.annotateLogs(attributes),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { error_type: 'workspace_session_launch_actor' },
					extra: attributes,
				}),
			),
		),
	)

const reportLaunchActorExit = (
	identity: WorkspaceSessionLaunchIdentity,
	exit: ActorExit<WorkspaceSessionLaunchState>,
) => {
	const attributes = { session_id: identity.sessionId, workspace_id: identity.workspaceId }
	return Match.value(exit).pipe(
		Match.tag('Defect', ({ cause }) =>
			captureLaunchActorFailure('V2 session launch actor defected', attributes, Cause.squash(cause)),
		),
		Match.tag('Final', ({ state }) =>
			Match.value(state).pipe(
				Match.tag('Failed', (failed) =>
					captureLaunchActorFailure(
						'V2 session launch actor failed to hand off the session',
						attributes,
						new Error(failed.message),
					),
				),
				Match.orElse((finished) =>
					Effect.logInfo('V2 session launch actor finished').pipe(
						Effect.annotateLogs({ ...attributes, outcome: finished._tag }),
					),
				),
			),
		),
		Match.tag('Stopped', () =>
			Effect.logDebug('V2 session launch actor stopped').pipe(Effect.annotateLogs(attributes)),
		),
		Match.exhaustive,
	)
}

/** One deterministic launch actor per session discovered by the synced session/task lifecycle. */
export const WorkspaceSessionLaunchActorsLive = Layer.effect(
	WorkspaceSessionLaunchActors,
	Effect.gen(function* () {
		const registryLock = yield* Semaphore.make(1)
		const system = yield* ActorSystemService
		const layerScope = yield* Effect.scope
		const schedule: WorkspaceSessionLaunchSchedule = {
			recheckInterval: yield* Config.Duration('RIPTIDE_WORKSPACE_LAUNCH_RECHECK_INTERVAL').pipe(
				Config.withDefault(Duration.seconds(2)),
			),
			failureRecheckCeiling: yield* Config.Duration('RIPTIDE_WORKSPACE_LAUNCH_FAILURE_RECHECK_CEILING').pipe(
				Config.withDefault(Duration.seconds(30)),
			),
		}
		const registered = new Map<string, RegisteredLaunchActor>()

		const deregister = (identity: WorkspaceSessionLaunchIdentity, entry: RegisteredLaunchActor) =>
			Effect.gen(function* () {
				// A final actor stays registered in the system until stopped; deregister it so a later
				// hint for the same session can start a fresh actor.
				yield* system.stop(launchActorId(identity.sessionId))
				if (registered.get(identity.sessionId) === entry) registered.delete(identity.sessionId)
				yield* Deferred.succeed(entry.exited, undefined)
			})

		const observeExit = (identity: WorkspaceSessionLaunchIdentity, entry: RegisteredLaunchActor) =>
			entry.actor.awaitExit.pipe(
				Effect.flatMap((exit) => reportLaunchActorExit(identity, exit)),
				Effect.ensuring(deregister(identity, entry)),
			)

		const spawnLaunchActor = (identity: WorkspaceSessionLaunchIdentity) =>
			Effect.gen(function* () {
				const exited = yield* Deferred.make<void>()
				const actor = yield* system.spawn(
					launchActorId(identity.sessionId),
					makeWorkspaceSessionLaunchMachine({ identity, schedule }),
				)
				const entry: RegisteredLaunchActor = { workspaceId: identity.workspaceId, actor, exited }
				registered.set(identity.sessionId, entry)
				yield* observeExit(identity, entry).pipe(Effect.forkIn(layerScope))
			})

		const ensureLaunchActor = (identity: WorkspaceSessionLaunchIdentity) =>
			Effect.gen(function* () {
				const existing = registered.get(identity.sessionId)
				if (existing === undefined) return yield* spawnLaunchActor(identity)
				if (existing.workspaceId !== identity.workspaceId) {
					yield* Effect.logWarning(
						'V2 session launch hint named a different workspace; keeping the actor',
					).pipe(Effect.annotateLogs({ actor_workspace_id: existing.workspaceId }))
				}
				yield* existing.actor.send(LaunchEvent.Wake)
			}).pipe(
				Effect.catchTag('DuplicateActorError', () =>
					Effect.logWarning('V2 session launch actor already exists in the actor system'),
				),
				Effect.annotateLogs({ session_id: identity.sessionId, workspace_id: identity.workspaceId }),
				registryLock.withPermits(1),
				Effect.withSpan('workspace_session_launch_actors.ensure_launch_actor', {
					attributes: { session_id: identity.sessionId, workspace_id: identity.workspaceId },
				}),
			)

		const waitForLaunchActorExit = Effect.fn('workspace_session_launch_actors.wait_for_launch_actor_exit')(
			function* (input: { readonly sessionId: string }) {
				const existing = registered.get(input.sessionId)
				if (existing !== undefined) yield* Deferred.await(existing.exited)
			},
		)

		const waitForLaunchActorState = Effect.fn('workspace_session_launch_actors.wait_for_launch_actor_state')(
			function* (input: { readonly sessionId: string; readonly state: WorkspaceSessionLaunchStateTag }) {
				const existing = registered.get(input.sessionId)
				if (existing !== undefined) yield* existing.actor.waitFor({ _tag: input.state })
			},
		)

		return WorkspaceSessionLaunchActors.of({
			ensureLaunchActor,
			waitForLaunchActorExit,
			waitForLaunchActorState,
		})
	}),
)
