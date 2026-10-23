import type { DaemonLifecycleEvent, DaemonSyncMode } from '@humanlayer/riptide-electron-rpc'
import type { DaemonLaunchResult } from '@humanlayer/schemas/effect/daemon/process-event'
import * as Context from 'effect/Context'
import type * as Crypto from 'effect/Crypto'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type { ChildProcessSpawner } from 'effect/process'
import type * as Redacted from 'effect/Redacted'
import type * as Stream from 'effect/Stream'

import type { ElectronPlatform } from '../platform/electron-platform.service'
import type { InheritedEnvironment } from '../platform/inherited-environment'
import type { DaemonStartError, DaemonStopError, DaemonUnavailableError } from './daemon.errors'

export interface StartDaemonInput {
	readonly token: Redacted.Redacted<string>
	readonly userId: string
	readonly organizationId: string
	readonly syncMode: DaemonSyncMode
	/** API origin the renderer uses; forwarded to the daemon as RIPTIDE_API_ORIGIN. */
	readonly apiOrigin: string
	/** Sync origin the renderer uses; forwarded to the daemon as RIPTIDE_SYNC_ORIGIN. */
	readonly syncOrigin: string
	/**
	 * Absolute Claude executable selected by device setup, already parsed at the
	 * RPC boundary, or null to let the daemon discover Claude on PATH.
	 */
	readonly verifiedClaudePath: string | null
}

export interface DaemonTupleInput {
	readonly userId: string
	readonly organizationId: string
}

export interface DaemonSupervisorShape {
	readonly start: (
		input: StartDaemonInput,
	) => Effect.Effect<
		DaemonLaunchResult,
		DaemonStartError | DaemonUnavailableError,
		| FileSystem.FileSystem
		| Path.Path
		| ElectronPlatform
		| Crypto.Crypto
		| ChildProcessSpawner.ChildProcessSpawner
		| InheritedEnvironment
	>
	readonly stop: (input: DaemonTupleInput) => Effect.Effect<void, DaemonStopError>
	readonly isRunning: (input: DaemonTupleInput) => Effect.Effect<boolean>
	/**
	 * Opens or closes the gate for starts and automatic restarts. Closing it cancels pending launches
	 * and stops every daemon this supervisor owns; it fails if any of them may still be running.
	 */
	readonly setManagementEnabled: (enabled: boolean) => Effect.Effect<void, DaemonStopError>
	readonly lifecycleEvents: Stream.Stream<DaemonLifecycleEvent>
}

export class DaemonSupervisor extends Context.Service<DaemonSupervisor, DaemonSupervisorShape>()('DaemonSupervisor') {}
