import { spawn } from 'node:child_process'

import { Duration, Effect, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import {
	SelfUpdateProcesses,
	type InstallDaemonPackageInput,
	type LaunchReplacementDaemonInput,
} from './self-update-processes.service'
import { SelfUpdateInstallError, SelfUpdateRestartError } from './self-update.errors'

const INSTALL_TIMEOUT = Duration.minutes(5)

const launchReplacementDaemonDetached = (input: LaunchReplacementDaemonInput) =>
	Effect.callback<void, SelfUpdateRestartError>((resume) => {
		const replacement = spawn(input.command, [...input.args], {
			detached: true,
			env: { ...process.env, RIPTIDE_DAEMON_TOKEN: input.daemonToken },
			stdio: 'inherit',
		})
		replacement.once('spawn', () => {
			replacement.unref()
			resume(Effect.void)
		})
		replacement.once('error', (cause) =>
			resume(
				Effect.fail(
					new SelfUpdateRestartError({
						message: 'Could not start the updated daemon',
						command: input.command,
						cause,
					}),
				),
			),
		)
	}).pipe(Effect.withSpan('self_update.launch_replacement_daemon'))

export const SelfUpdateProcessesLive = Layer.effect(
	SelfUpdateProcesses,
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

		const installDaemonPackage = Effect.fn('self_update.install_daemon_package')(function* (
			input: InstallDaemonPackageInput,
		) {
			const packageAtVersion = `${input.packageSpecifier}@${input.version}`
			const installFailure = (message: string, stderr: string, cause?: unknown) =>
				new SelfUpdateInstallError({ message, version: input.version, stderr: stderr.trim(), cause })

			const handle = yield* spawner
				.spawn(
					ChildProcess.make('npm', ['install', '-g', packageAtVersion], {
						extendEnv: true,
						killSignal: 'SIGTERM',
						forceKillAfter: '2 seconds',
					}),
				)
				.pipe(Effect.mapError((cause) => installFailure('Could not start npm', cause.message, cause)))

			const [stderr, exitCode] = yield* Effect.all(
				[
					Stream.decodeText(handle.stderr).pipe(Stream.mkString),
					handle.exitCode,
					Stream.runDrain(handle.stdout),
				],
				{ concurrency: 'unbounded' },
			).pipe(
				Effect.mapError((cause) => installFailure('npm install failed', cause.message, cause)),
				Effect.timeoutOrElse({
					duration: INSTALL_TIMEOUT,
					orElse: () =>
						Effect.fail(installFailure('npm install timed out', 'npm install timed out after 5 minutes')),
				}),
			)
			if (Number(exitCode) !== 0) return yield* installFailure(`npm install exited with ${exitCode}`, stderr)
		}, Effect.scoped)

		return {
			installDaemonPackage,
			launchReplacementDaemon: launchReplacementDaemonDetached,
			exitDaemonProcess: (exitCode) => Effect.sync(() => process.exit(exitCode)),
		}
	}),
)
