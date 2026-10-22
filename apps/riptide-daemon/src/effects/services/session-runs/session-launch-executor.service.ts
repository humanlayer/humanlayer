import { Context, type Effect } from 'effect'

import type { SessionChangeMessage } from '@/collections/types'

export interface ExecuteSessionLaunchInput {
	readonly session: SessionChangeMessage['value']
}

export interface SessionLaunchExecutorService {
	/**
	 * Run the coding agent for a launch-ready session until it ends, reporting any failure to the
	 * API as the session's failed status. Never fails; interruption ends the run silently.
	 */
	readonly executeSessionLaunch: (input: ExecuteSessionLaunchInput) => Effect.Effect<void>
}

/**
 * The one operation the session runner needs from the legacy launch path. Its live adapter wraps
 * the promise-based launcher and is composed where that launcher's dependencies exist.
 */
export class SessionLaunchExecutor extends Context.Service<SessionLaunchExecutor, SessionLaunchExecutorService>()(
	'SessionLaunchExecutor',
) {}
