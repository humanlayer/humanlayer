import { Context, Data, type Effect } from 'effect'

export interface WorkspaceSessionRunnerInput {
	readonly sessionId: string
}

/**
 * Result of handing a session to the runner. `HandedOff` is the single runner start for that
 * session. `Deferred` means the runner could not yet see the session or its task (the synced row
 * lags the authoritative API) and the caller may try again later. `Skipped` means the local row
 * says the session is no longer launchable, so no handoff will ever follow.
 */
export type WorkspaceSessionLaunchHandoff = Data.TaggedEnum<{
	HandedOff: {}
	Deferred: { readonly reason: string }
	Skipped: { readonly reason: string }
}>
export const WorkspaceSessionLaunchHandoff = Data.taggedEnum<WorkspaceSessionLaunchHandoff>()

export interface WorkspaceSessionRunnerService {
	/**
	 * Start the coding-agent run for a session whose workspace is ready, at most once per session
	 * per daemon. Never fails: every outcome is a `WorkspaceSessionLaunchHandoff` the caller acts on.
	 */
	readonly handOffReadySession: (input: WorkspaceSessionRunnerInput) => Effect.Effect<WorkspaceSessionLaunchHandoff>
}

/**
 * The runner that turns a launch-ready session into a running coding-agent process. The live
 * implementation wraps the legacy promise-based runner, which needs `DaemonServices`; those exist
 * only after the daemon runtime is built, so the subscription program provides this layer at the
 * scope that owns both the services and the lifetime of the forked runs.
 */
export class WorkspaceSessionRunner extends Context.Service<WorkspaceSessionRunner, WorkspaceSessionRunnerService>()(
	'WorkspaceSessionRunner',
) {}
