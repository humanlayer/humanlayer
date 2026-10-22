import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { HeartbeatUpdate } from '@/lib/heartbeat'
import type { DaemonSelfUpdateCapability } from '@/managed-daemon-start'

import type { DaemonAlreadyShuttingDown, SelfUpdateReportError, SelfUpdateRestartError } from './self-update.errors'

export interface ShutdownDaemonForRestartInput {
	/** Exit code the shutdown deadline uses if it has to force the process down before the updater can exit. */
	readonly forcedExitCode: number
	readonly beforeShutdown: Effect.Effect<void, SelfUpdateRestartError>
}

export interface SelfUpdaterConfig {
	readonly capability: DaemonSelfUpdateCapability
	readonly currentVersion: string | null
	readonly daemonToken: string
	readonly reportUpdateProgress: (update: HeartbeatUpdate) => Effect.Effect<void, SelfUpdateReportError>
	/** Runs the daemon's graceful shutdown without exiting the process. */
	readonly shutdownDaemonForRestart: (
		input: ShutdownDaemonForRestartInput,
	) => Effect.Effect<void, DaemonAlreadyShuttingDown | SelfUpdateRestartError>
}

export interface SelfUpdaterShape {
	/**
	 * Installs `version` and restarts the daemon on it. Ignored when the daemon already runs `version` or another
	 * update is in flight. A failed install is reported and leaves the daemon running, so a later request retries.
	 */
	readonly requestUpdate: (version: string) => Effect.Effect<void>
}

export class SelfUpdater extends Context.Service<SelfUpdater, SelfUpdaterShape>()('SelfUpdater') {}
