import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { DaemonLockOwner } from '@humanlayer/schemas/effect/daemon/identity'
import { decodeDaemonProcessEventLine } from '@humanlayer/schemas/effect/daemon/process-event'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Redacted from 'effect/Redacted'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import type { ElectronConfig } from '../src/config/electron-config'
import { makeDaemonSupervisorLive } from '../src/daemon/daemon-supervisor.layer'
import { DaemonSupervisor } from '../src/daemon/daemon-supervisor.service'
import { HostIdService } from '../src/host/host-id-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'

const integrationDaemonIdentity = {
	userId: 'integration-user',
	organizationId: 'integration-org',
	hostId: 'integration-host',
} as const

const bytesToHexadecimalString = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const makeElectronConfigurationForDaemonLockingIntegration = (
	homeDirectory: string,
	executable: string,
): ElectronConfig => ({
	channel: 'local',
	isPackaged: false,
	userDataPath: `${homeDirectory}/profile`,
	homeDirectory,
	devstackId: undefined,
	rendererUrl: new URL('http://localhost:3000'),
	applicationIconPath: undefined,
	remoteDebuggingPort: 9222,
	cdpEnabled: false,
	openDevTools: false,
	logPath: `${homeDirectory}/electron.log`,
	daemonMode: 'staged',
	stagedDaemonPath: executable,
	protocolSchemes: ['humanlayer-electron-local'],
})

const makeElectronPlatformLayerForDaemonLockingIntegration = (homeDirectory: string) =>
	Layer.succeed(
		ElectronPlatform,
		ElectronPlatform.of({
			productName: 'HumanLayer-Test Electron',
			version: '1.0.0',
			isPackaged: false,
			resourcesPath: '/resources',
			preloadPath: '/preload.cjs',
			homeDirectory,
			userDataPath: `${homeDirectory}/profile`,
			configureBeforeReady: () => Effect.void,
			whenReady: Effect.void,
			requestSingleInstanceLock: Effect.succeed(true),
			secondInstanceEvents: Stream.empty,
			quit: Effect.void,
			resolveWindowState: ({ persistedState, defaultWidth, defaultHeight }) =>
				Effect.succeed(
					persistedState ?? { width: defaultWidth, height: defaultHeight, x: 0, y: 0, maximized: false },
				),
			setApplicationIcon: () => Effect.void,
			openWindow: () => Effect.die('openWindow was not expected'),
		}),
	)

describe('Electron daemon launch locking integration', () => {
	it.live(
		'owns only ready children and hands daemon lease contention to an incumbent command-line daemon',
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const crypto = yield* Crypto.Crypto
					const fileSystem = yield* FileSystem.FileSystem
					const pathService = yield* Path.Path
					const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
					const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'electron-daemon-lock-' })
					const daemonLockingFixtureExecutable = pathService.join(homeDirectory, 'daemon-locking-fixture.ts')
					const loginShellEnvironmentFixtureExecutable = pathService.join(
						homeDirectory,
						'login-shell-environment-fixture.sh',
					)
					yield* fileSystem.writeFileString(
						loginShellEnvironmentFixtureExecutable,
						'#!/bin/sh\nHOME="$(dirname "$0")" /usr/bin/env\n',
					)
					yield* fileSystem.chmod(loginShellEnvironmentFixtureExecutable, 0o700)
					const fixtureBuildProcess = yield* childProcessSpawner.spawn(
						ChildProcess.make(
							'bun',
							[
								'build',
								`${import.meta.dirname}/fixtures/daemon-locking-fixture.ts`,
								'--target',
								'bun',
								'--outfile',
								daemonLockingFixtureExecutable,
							],
							{
								stdin: 'ignore',
								stdout: 'ignore',
								stderr: 'pipe',
							},
						),
					)
					const fixtureBuildResult = yield* Effect.all(
						{
							exitCode: fixtureBuildProcess.exitCode,
							stderr: fixtureBuildProcess.stderr.pipe(Stream.decodeText(), Stream.mkString),
						},
						{ concurrency: 'unbounded' },
					)
					expect(Number(fixtureBuildResult.exitCode), fixtureBuildResult.stderr).toBe(0)
					yield* fileSystem.chmod(daemonLockingFixtureExecutable, 0o700)

					const daemonIdentityFingerprint = bytesToHexadecimalString(
						yield* crypto.digest(
							'SHA-256',
							new TextEncoder().encode(
								`${integrationDaemonIdentity.userId}\u0000${integrationDaemonIdentity.organizationId}\u0000${integrationDaemonIdentity.hostId}\u0000local`,
							),
						),
					)
					const daemonLockPath = pathService.join(
						homeDirectory,
						'.humanlayer',
						'riptide',
						'daemon-locks',
						`${daemonIdentityFingerprint}.lock`,
					)
					const daemonStartRequest = {
						token: Redacted.make(JSON.stringify(integrationDaemonIdentity)),
						userId: integrationDaemonIdentity.userId,
						organizationId: integrationDaemonIdentity.organizationId,
						syncMode: 'auto' as const,
						apiOrigin: homeDirectory,
						syncOrigin: homeDirectory,
						verifiedClaudePath: null,
					}
					const daemonSupervisorDependencies = Layer.mergeAll(
						Layer.succeed(InheritedEnvironment, { snapshot: Effect.succeed({}) }),
						NodeServices.layer,
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								SHELL: loginShellEnvironmentFixtureExecutable,
								HOME: homeDirectory,
							}),
						),
						makeElectronPlatformLayerForDaemonLockingIntegration(homeDirectory),
						Layer.succeed(
							HostIdService,
							HostIdService.of({ get: Effect.succeed(integrationDaemonIdentity.hostId) }),
						),
					)
					const daemonSupervisorLayer = makeDaemonSupervisorLive(
						makeElectronConfigurationForDaemonLockingIntegration(
							homeDirectory,
							daemonLockingFixtureExecutable,
						),
					).pipe(Layer.provide(daemonSupervisorDependencies))

					yield* Effect.scoped(
						Effect.gen(function* () {
							const daemonSupervisor = yield* DaemonSupervisor
							expect(yield* daemonSupervisor.start(daemonStartRequest)).toEqual({ type: 'daemon_ready' })
							expect(yield* daemonSupervisor.isRunning(daemonStartRequest)).toBe(true)
							const daemonLockOwner = yield* fileSystem
								.readFileString(pathService.join(daemonLockPath, 'owner.json'))
								.pipe(
									Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(DaemonLockOwner))),
								)
							expect(daemonLockOwner).toMatchObject({ ...integrationDaemonIdentity, stage: 'local' })
							yield* daemonSupervisor.stop(daemonStartRequest)
							expect(yield* fileSystem.exists(daemonLockPath)).toBe(false)
						}).pipe(Effect.provide(Layer.mergeAll(daemonSupervisorLayer, daemonSupervisorDependencies))),
					)

					yield* Effect.scoped(
						Effect.gen(function* () {
							const incumbentCommandLineDaemon = yield* childProcessSpawner.spawn(
								ChildProcess.make(daemonLockingFixtureExecutable, [], {
									env: {
										HOME: homeDirectory,
										RIPTIDE_API_ORIGIN: homeDirectory,
										DAEMON_IDENTITY: JSON.stringify(integrationDaemonIdentity),
										RIPTIDE_DAEMON_CHANNEL: 'local',
									},
									extendEnv: true,
									stdin: 'ignore',
									stdout: 'pipe',
									stderr: 'pipe',
								}),
							)
							const incumbentStandardError = yield* incumbentCommandLineDaemon.stderr.pipe(
								Stream.decodeText(),
								Stream.mkString,
								Effect.forkScoped,
							)
							const incumbentReadyEventLine = yield* incumbentCommandLineDaemon.stdout.pipe(
								Stream.decodeText(),
								Stream.splitLines,
								Stream.runHead,
								Effect.timeoutOrElse({
									duration: '10 seconds',
									orElse: () =>
										Effect.die(
											'Incumbent local-stage fixture did not emit its first protocol event',
										),
								}),
								Effect.map(Option.getOrThrow),
							)
							expect(yield* decodeDaemonProcessEventLine({ line: incumbentReadyEventLine })).toEqual({
								type: 'daemon_ready',
							})

							yield* Effect.scoped(
								Effect.gen(function* () {
									const daemonSupervisor = yield* DaemonSupervisor
									expect(yield* daemonSupervisor.start(daemonStartRequest)).toEqual({
										type: 'daemon_already_running',
										message: 'Matching daemon already owns the lease',
									})
									expect(yield* daemonSupervisor.isRunning(daemonStartRequest)).toBe(false)
								}).pipe(
									Effect.provide(Layer.mergeAll(daemonSupervisorLayer, daemonSupervisorDependencies)),
								),
							)

							expect(yield* incumbentCommandLineDaemon.isRunning).toBe(true)
							expect(yield* fileSystem.exists(daemonLockPath)).toBe(true)
							yield* incumbentCommandLineDaemon.kill({ killSignal: 'SIGTERM' })
							const incumbentTermination = yield* Effect.exit(incumbentCommandLineDaemon.exitCode)
							const incumbentStandardErrorOutput = yield* Fiber.join(incumbentStandardError)
							const terminatedWithoutSuccess = Exit.match(incumbentTermination, {
								onFailure: () => true,
								onSuccess: (exitCode) => Number(exitCode) !== 0,
							})
							expect(
								terminatedWithoutSuccess,
								`SIGTERM must terminate the incumbent daemon, not report a successful exit: ${incumbentStandardErrorOutput}`,
							).toBe(true)
							expect(yield* incumbentCommandLineDaemon.isRunning).toBe(false)
							expect(yield* fileSystem.exists(daemonLockPath)).toBe(false)
						}),
					)
					expect(yield* fileSystem.exists(daemonLockPath)).toBe(false)
				}),
			).pipe(Effect.provide(NodeServices.layer)),
		30_000,
	)
})
