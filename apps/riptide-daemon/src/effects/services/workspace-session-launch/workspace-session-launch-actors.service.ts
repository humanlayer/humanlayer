import { Context, type Effect } from 'effect'

import type { DaemonApi } from '../daemon-api/daemon-api.service'
import type { WorkspaceSessionLaunchIdentity, WorkspaceSessionLaunchState } from './workspace-session-launch.machine'
import type { WorkspaceSessionRunner } from './workspace-session-runner.service'

export type { WorkspaceSessionLaunchIdentity } from './workspace-session-launch.machine'

export type WorkspaceSessionLaunchStateTag = WorkspaceSessionLaunchState['_tag']

export interface WorkspaceSessionLaunchActorsService {
	/**
	 * Make sure exactly one launch actor exists for the session. A new actor reloads authoritative
	 * readiness immediately; an existing one is woken to recheck. Returns once the hint is
	 * accepted, not when the session launches. The actor keeps the caller's `DaemonApi` and
	 * `WorkspaceSessionRunner` for its whole life, so both are requirements here.
	 */
	readonly ensureLaunchActor: (
		identity: WorkspaceSessionLaunchIdentity,
	) => Effect.Effect<void, never, DaemonApi | WorkspaceSessionRunner>
	/** Resolves once no launch actor is registered for the session; immediately when none is. */
	readonly waitForLaunchActorExit: (input: { readonly sessionId: string }) => Effect.Effect<void>
	/**
	 * Resolves once the session's launch actor is in the named state, including when it already
	 * is. Resolves immediately when no actor is registered, so callers must pair it with a hint.
	 */
	readonly waitForLaunchActorState: (input: {
		readonly sessionId: string
		readonly state: WorkspaceSessionLaunchStateTag
	}) => Effect.Effect<void>
}

export class WorkspaceSessionLaunchActors extends Context.Service<
	WorkspaceSessionLaunchActors,
	WorkspaceSessionLaunchActorsService
>()('WorkspaceSessionLaunchActors') {}
