import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Queue, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import {
	SelfUpdateProcesses,
	type InstallDaemonPackageInput,
	type LaunchReplacementDaemonInput,
} from '../../src/effects/services/self-update/self-update-processes.service'
import {
	SelfUpdateInstallError,
	SelfUpdateReportError,
	SelfUpdateRestartError,
} from '../../src/effects/services/self-update/self-update.errors'
import { makeSelfUpdaterLive } from '../../src/effects/services/self-update/self-update.layer'
import {
	SelfUpdater,
	type ShutdownDaemonForRestartInput,
} from '../../src/effects/services/self-update/self-update.service'
import type { HeartbeatUpdate } from '../../src/lib/heartbeat'

const RUNNING_VERSION = '0.31.0'
const REQUESTED_VERSION = '0.32.0'

type RestartStep = 'launch' | 'shutdown' | 'exit'

interface HarnessOptions {
	readonly supervisor?: 'systemd' | 'shim' | 'none'
	readonly installDaemonPackage?: (input: InstallDaemonPackageInput) => Effect.Effect<void, SelfUpdateInstallError>
	readonly launchReplacementDaemon?: (
		input: LaunchReplacementDaemonInput,
	) => Effect.Effect<void, SelfUpdateRestartError>
	readonly reportUpdateProgress?: (update: HeartbeatUpdate) => Effect.Effect<void, SelfUpdateReportError>
}

const makeHarness = (options: HarnessOptions = {}) =>
	Effect.gen(function* () {
		const installs = yield* Ref.make<ReadonlyArray<InstallDaemonPackageInput>>([])
		const launches = yield* Ref.make<ReadonlyArray<LaunchReplacementDaemonInput>>([])
		const exitCodes = yield* Ref.make<ReadonlyArray<number>>([])
		const shutdowns = yield* Ref.make<ReadonlyArray<Pick<ShutdownDaemonForRestartInput, 'forcedExitCode'>>>([])
		const steps = yield* Ref.make<ReadonlyArray<RestartStep>>([])
		const reports = yield* Ref.make<ReadonlyArray<HeartbeatUpdate>>([])

		const processesLayer = Layer.succeed(SelfUpdateProcesses, {
			installDaemonPackage: (input) =>
				Ref.update(installs, (all) => [...all, input]).pipe(
					Effect.andThen(options.installDaemonPackage?.(input) ?? Effect.void),
				),
			launchReplacementDaemon: (input) =>
				Ref.update(launches, (all) => [...all, input]).pipe(
					Effect.andThen(options.launchReplacementDaemon?.(input) ?? Effect.void),
					Effect.andThen(Ref.update(steps, (all): ReadonlyArray<RestartStep> => [...all, 'launch'])),
				),
			exitDaemonProcess: (exitCode) =>
				Ref.update(exitCodes, (all) => [...all, exitCode]).pipe(
					Effect.andThen(Ref.update(steps, (all): ReadonlyArray<RestartStep> => [...all, 'exit'])),
				),
		})

		const layer = makeSelfUpdaterLive({
			capability: {
				packageSpecifier: '@humanlayer/cli',
				restart: { command: '/usr/bin/humanlayer', args: ['daemon', 'launch', '--beta'] },
				supervisor: options.supervisor ?? 'none',
			},
			currentVersion: RUNNING_VERSION,
			daemonToken: 'daemon-token',
			reportUpdateProgress: (update) =>
				(options.reportUpdateProgress?.(update) ?? Effect.void).pipe(
					Effect.tap(() => Ref.update(reports, (all) => [...all, update])),
				),
			shutdownDaemonForRestart: ({ forcedExitCode, beforeShutdown }) =>
				beforeShutdown.pipe(
					Effect.andThen(Ref.update(shutdowns, (all) => [...all, { forcedExitCode }])),
					Effect.andThen(Ref.update(steps, (all): ReadonlyArray<RestartStep> => [...all, 'shutdown'])),
				),
		}).pipe(Layer.provide(processesLayer))

		return { layer, installs, launches, exitCodes, shutdowns, reports, steps }
	})

const failedInstall = (stderr: string) =>
	new SelfUpdateInstallError({ message: 'npm install exited with 1', version: REQUESTED_VERSION, stderr })

describe('SelfUpdater', () => {
	it.effect('ignores a request for the running version', () =>
		Effect.gen(function* () {
			const harness = yield* makeHarness()
			yield* SelfUpdater.use((updater) => updater.requestUpdate(RUNNING_VERSION)).pipe(
				Effect.provide(harness.layer),
			)

			expect(yield* Ref.get(harness.installs)).toEqual([])
			expect(yield* Ref.get(harness.reports)).toEqual([])
			expect(yield* Ref.get(harness.exitCodes)).toEqual([])
		}),
	)

	it.effect('ignores a second request while an update is in flight', () =>
		Effect.gen(function* () {
			const installStarted = yield* Deferred.make<void>()
			const releaseInstall = yield* Deferred.make<void>()
			const harness = yield* makeHarness({
				installDaemonPackage: () =>
					Deferred.succeed(installStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseInstall))),
			})

			yield* Effect.gen(function* () {
				const updater = yield* SelfUpdater
				const first = yield* Effect.forkChild(updater.requestUpdate(REQUESTED_VERSION))
				yield* Deferred.await(installStarted)
				yield* updater.requestUpdate(REQUESTED_VERSION)
				expect(yield* Ref.get(harness.installs)).toHaveLength(1)

				yield* Deferred.succeed(releaseInstall, undefined)
				yield* Fiber.join(first)
			}).pipe(Effect.provide(harness.layer))

			expect(yield* Ref.get(harness.installs)).toHaveLength(1)
			expect(yield* Ref.get(harness.exitCodes)).toEqual([0])
		}),
	)

	it.effect('reports a failed install, keeps the daemon running, and accepts a retry', () =>
		Effect.gen(function* () {
			const installAttempts = yield* Ref.make(0)
			const harness = yield* makeHarness({
				installDaemonPackage: () =>
					Ref.updateAndGet(installAttempts, (attempts) => attempts + 1).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1 ? Effect.fail(failedInstall(`${'x'.repeat(600)}EACCES`)) : Effect.void,
						),
					),
			})

			yield* Effect.gen(function* () {
				const updater = yield* SelfUpdater
				yield* updater.requestUpdate(REQUESTED_VERSION)

				const reports = yield* Ref.get(harness.reports)
				expect(reports.map((report) => report.state)).toEqual(['installing', 'failed'])
				expect(reports[1]?.error).toHaveLength(500)
				expect(reports[1]?.error?.endsWith('EACCES')).toBe(true)
				expect(yield* Ref.get(harness.shutdowns)).toEqual([])
				expect(yield* Ref.get(harness.exitCodes)).toEqual([])

				yield* updater.requestUpdate(REQUESTED_VERSION)
			}).pipe(Effect.provide(harness.layer))

			expect(yield* Ref.get(harness.installs)).toEqual([
				{ packageSpecifier: '@humanlayer/cli', version: REQUESTED_VERSION },
				{ packageSpecifier: '@humanlayer/cli', version: REQUESTED_VERSION },
			])
			expect(yield* Ref.get(harness.exitCodes)).toEqual([0])
		}),
	)

	it.effect.each(['systemd', 'shim'] as const)(
		'exits 75 under %s after the graceful shutdown so it restarts',
		(supervisor) =>
			Effect.gen(function* () {
				const harness = yield* makeHarness({ supervisor })
				yield* SelfUpdater.use((updater) => updater.requestUpdate(REQUESTED_VERSION)).pipe(
					Effect.provide(harness.layer),
				)

				expect(yield* Ref.get(harness.shutdowns)).toEqual([{ forcedExitCode: 75 }])
				expect(yield* Ref.get(harness.launches)).toEqual([])
				expect(yield* Ref.get(harness.exitCodes)).toEqual([75])
			}),
	)

	it.effect('launches its replacement with its own token and args before shutting down when unsupervised', () =>
		Effect.gen(function* () {
			const harness = yield* makeHarness()
			yield* SelfUpdater.use((updater) => updater.requestUpdate(REQUESTED_VERSION)).pipe(
				Effect.provide(harness.layer),
			)

			expect(yield* Ref.get(harness.reports)).toEqual([{ version: REQUESTED_VERSION, state: 'installing' }])
			expect(yield* Ref.get(harness.steps)).toEqual(['launch', 'shutdown', 'exit'])
			expect(yield* Ref.get(harness.shutdowns)).toEqual([{ forcedExitCode: 0 }])
			expect(yield* Ref.get(harness.launches)).toEqual([
				{
					command: '/usr/bin/humanlayer',
					args: ['daemon', 'launch', '--beta'],
					daemonToken: 'daemon-token',
				},
			])
			expect(yield* Ref.get(harness.exitCodes)).toEqual([0])
		}),
	)

	it.effect('reports a replacement that cannot be launched and keeps the daemon running', () =>
		Effect.gen(function* () {
			const harness = yield* makeHarness({
				launchReplacementDaemon: (input) =>
					Effect.fail(
						new SelfUpdateRestartError({
							message: 'Could not start the updated daemon',
							command: input.command,
							cause: new Error('ENOENT'),
						}),
					),
			})
			yield* SelfUpdater.use((updater) => updater.requestUpdate(REQUESTED_VERSION)).pipe(
				Effect.provide(harness.layer),
			)

			expect(yield* Ref.get(harness.reports)).toEqual([
				{ version: REQUESTED_VERSION, state: 'installing' },
				{
					version: REQUESTED_VERSION,
					state: 'failed',
					error: 'Could not start the updated daemon: /usr/bin/humanlayer',
				},
			])
			expect(yield* Ref.get(harness.shutdowns)).toEqual([])
			expect(yield* Ref.get(harness.exitCodes)).toEqual([])
		}),
	)

	it.effect('retries a progress report that fails to reach the API', () =>
		Effect.gen(function* () {
			const reportAttempts = yield* Queue.unbounded<number>()
			const attempts = yield* Ref.make(0)
			const harness = yield* makeHarness({
				reportUpdateProgress: () =>
					Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
						Effect.tap((attempt) => Queue.offer(reportAttempts, attempt)),
						Effect.flatMap((attempt) =>
							attempt < 3
								? Effect.fail(new SelfUpdateReportError({ message: 'network', cause: null }))
								: Effect.void,
						),
					),
			})

			yield* Effect.gen(function* () {
				const updater = yield* SelfUpdater
				const request = yield* Effect.forkChild(updater.requestUpdate(REQUESTED_VERSION))
				expect(yield* Queue.take(reportAttempts)).toBe(1)
				yield* TestClock.adjust('2 seconds')
				expect(yield* Queue.take(reportAttempts)).toBe(2)
				yield* TestClock.adjust('2 seconds')
				expect(yield* Queue.take(reportAttempts)).toBe(3)
				yield* Fiber.join(request)
			}).pipe(Effect.provide(harness.layer))

			expect(yield* Ref.get(harness.reports)).toEqual([{ version: REQUESTED_VERSION, state: 'installing' }])
			expect(yield* Ref.get(harness.installs)).toHaveLength(1)
		}),
	)
})
