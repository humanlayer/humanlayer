import * as Sentry from '@sentry/bun'
import { Effect, Fiber, Layer, Schedule, Semaphore } from 'effect'

import type { HeartbeatUpdate } from '@/lib/heartbeat'

import { SelfUpdateProcesses } from './self-update-processes.service'
import type { SelfUpdateInstallError, SelfUpdateRestartError } from './self-update.errors'
import { SelfUpdater, type SelfUpdaterConfig } from './self-update.service'

const MAX_REPORTED_ERROR_LENGTH = 500
const REPORT_PROGRESS_RETRY_SCHEDULE = Schedule.spaced('2 seconds')
const REPORT_PROGRESS_RETRIES = 3

/** Nonzero, because systemd's `Restart=on-failure` ignores a clean exit. */
const SUPERVISOR_RESTART_EXIT_CODE = 75
const REPLACEMENT_LAUNCHED_EXIT_CODE = 0

const captureSelfUpdateError = (error: SelfUpdateInstallError | SelfUpdateRestartError, errorType: string) =>
	Effect.sync(() => Sentry.captureException(error, { tags: { error_type: errorType } }))

export const makeSelfUpdaterLive = (config: SelfUpdaterConfig) =>
	Layer.effect(
		SelfUpdater,
		Effect.gen(function* () {
			const processes = yield* SelfUpdateProcesses
			const updateInFlight = yield* Semaphore.make(1)
			const { capability } = config

			const reportUpdateProgress = (update: HeartbeatUpdate) =>
				config.reportUpdateProgress(update).pipe(
					Effect.retry({ times: REPORT_PROGRESS_RETRIES, schedule: REPORT_PROGRESS_RETRY_SCHEDULE }),
					Effect.tapError(Effect.logError),
					Effect.tapError((error) =>
						Effect.sync(() =>
							Sentry.captureException(error, { tags: { error_type: 'daemon_self_update_report' } }),
						),
					),
					Effect.catchTag('SelfUpdateReportError', () => Effect.void),
					Effect.withSpan('self_update.report_progress', {
						attributes: { version: update.version, state: update.state },
					}),
				)

			const reportInstallFailure = (error: SelfUpdateInstallError) =>
				reportUpdateProgress({
					version: error.version,
					state: 'failed',
					error: error.stderr.slice(-MAX_REPORTED_ERROR_LENGTH),
				})

			const reportRestartFailure = (version: string, error: SelfUpdateRestartError) =>
				reportUpdateProgress({ version, state: 'failed', error: `${error.message}: ${error.command}` })

			// The replacement waits for the instance lock, so launching it first survives a forced exit.
			const launchReplacementDaemon = processes
				.launchReplacementDaemon({
					command: capability.restart.command,
					args: capability.restart.args,
					daemonToken: config.daemonToken,
				})
				.pipe(
					Effect.tapError(Effect.logError),
					Effect.tapError((error) => captureSelfUpdateError(error, 'daemon_self_update_restart')),
				)

			const restartIntoInstalledVersion = Effect.fn('self_update.restart_into_installed_version')(
				function* (version: string) {
					yield* Effect.logInfo('Daemon update installed, restarting').pipe(
						Effect.annotateLogs({ version, supervisor: capability.supervisor }),
					)
					if (capability.supervisor !== 'none') {
						yield* config.shutdownDaemonForRestart({
							forcedExitCode: SUPERVISOR_RESTART_EXIT_CODE,
							beforeShutdown: Effect.void,
						})
						return yield* processes.exitDaemonProcess(SUPERVISOR_RESTART_EXIT_CODE)
					}
					yield* config.shutdownDaemonForRestart({
						forcedExitCode: REPLACEMENT_LAUNCHED_EXIT_CODE,
						beforeShutdown: launchReplacementDaemon,
					})
					yield* processes.exitDaemonProcess(REPLACEMENT_LAUNCHED_EXIT_CODE)
				},
				(effect, version) =>
					Effect.catchTag(effect, 'SelfUpdateRestartError', (error) => reportRestartFailure(version, error)),
				Effect.catchTag('DaemonAlreadyShuttingDown', (error) =>
					Effect.logInfo('Skipping daemon restart after update').pipe(
						Effect.annotateLogs({ reason: error.message }),
					),
				),
			)

			const installAndRestart = Effect.fn('self_update.install_and_restart')(function* (version: string) {
				yield* reportUpdateProgress({ version, state: 'installing' })
				yield* Effect.logInfo('Installing daemon update').pipe(Effect.annotateLogs({ version }))
				yield* processes.installDaemonPackage({ packageSpecifier: capability.packageSpecifier, version }).pipe(
					Effect.tapError(Effect.logError),
					Effect.tapError((error) => captureSelfUpdateError(error, 'daemon_self_update')),
					Effect.andThen(
						// The restart runs the daemon shutdown, which interrupts this request's fiber; detached, it outlives that.
						restartIntoInstalledVersion(version).pipe(Effect.forkDetach, Effect.flatMap(Fiber.join)),
					),
					Effect.catchTag('SelfUpdateInstallError', reportInstallFailure),
				)
			})

			const requestUpdate = (version: string) => {
				if (version === config.currentVersion) return Effect.void
				return updateInFlight.withPermitsIfAvailable(1)(installAndRestart(version)).pipe(Effect.asVoid)
			}

			return { requestUpdate }
		}),
	)
