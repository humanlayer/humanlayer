import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'

import type { SelfUpdateInstallError, SelfUpdateRestartError } from './self-update.errors'

export interface InstallDaemonPackageInput {
	readonly packageSpecifier: string
	readonly version: string
}

export interface LaunchReplacementDaemonInput {
	readonly command: string
	readonly args: ReadonlyArray<string>
	readonly daemonToken: string
}

export interface SelfUpdateProcessesShape {
	readonly installDaemonPackage: (input: InstallDaemonPackageInput) => Effect.Effect<void, SelfUpdateInstallError>
	/** Starts the replacement daemon detached from this process; succeeds once the OS has spawned it. */
	readonly launchReplacementDaemon: (
		input: LaunchReplacementDaemonInput,
	) => Effect.Effect<void, SelfUpdateRestartError>
	readonly exitDaemonProcess: (exitCode: number) => Effect.Effect<void>
}

export class SelfUpdateProcesses extends Context.Service<SelfUpdateProcesses, SelfUpdateProcessesShape>()(
	'SelfUpdateProcesses',
) {}
