import { Effect, Layer, Scope } from 'effect'

import { parseSessionLaunchCandidate } from '@/collections/parse-session-launch-candidate'
import { shouldLaunchSession } from '@/handlers/sessions/on-session-launch'

import { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import { SessionLaunchExecutor } from '../session-runs/session-launch-executor.service'
import { SessionRunRegistry } from '../session-runs/session-run-registry'
import { WorkspaceSessionLaunchHandoff, WorkspaceSessionRunner } from './workspace-session-runner.service'

/**
 * Live `WorkspaceSessionRunner`. The launch actor has already confirmed authoritative readiness;
 * this checks that the synced session and task rows are present and the session is still
 * launchable, then starts the run through the registry shared with legacy launches. One call is
 * one handoff. Runs are forked into this layer's scope, so they live as long as the program that
 * provides the layer, not as long as the actor that asked for them.
 */
export const WorkspaceSessionRunnerLive = Layer.effect(
	WorkspaceSessionRunner,
	Effect.gen(function* () {
		const collections = yield* DaemonCollections
		const registry = yield* SessionRunRegistry
		const executor = yield* SessionLaunchExecutor
		const runnerScope = yield* Effect.scope

		const handOffReadySession = Effect.fn('workspace_session_runner.hand_off_ready_session')(function* (input: {
			readonly sessionId: string
		}) {
			const current = yield* collections.current
			const rawSession = current.sessions.toArray.find((candidate) => candidate.id === input.sessionId)
			if (rawSession === undefined) {
				return WorkspaceSessionLaunchHandoff.Deferred({ reason: 'session_not_synced' })
			}
			const session = parseSessionLaunchCandidate(rawSession)
			if (session === undefined) {
				yield* Effect.logWarning('Skipped malformed V2 session launch candidate').pipe(
					Effect.annotateLogs({ session_id: input.sessionId }),
				)
				return WorkspaceSessionLaunchHandoff.Skipped({ reason: 'malformed_session_row' })
			}
			if (session.task_id !== null && !current.tasks.toArray.some((task) => task.id === session.task_id)) {
				return WorkspaceSessionLaunchHandoff.Deferred({ reason: 'task_not_synced' })
			}
			if (!shouldLaunchSession({ type: 'update', value: session })) {
				return WorkspaceSessionLaunchHandoff.Skipped({ reason: `local_status_${session.status}` })
			}
			const forked = yield* registry
				.forkExclusiveSessionRun({
					sessionId: session.id,
					run: executor.executeSessionLaunch({ session }),
				})
				.pipe(Effect.provideService(Scope.Scope, runnerScope))
			return forked
				? WorkspaceSessionLaunchHandoff.HandedOff()
				: WorkspaceSessionLaunchHandoff.Skipped({ reason: 'session_run_in_flight' })
		})

		return WorkspaceSessionRunner.of({ handOffReadySession })
	}),
)
