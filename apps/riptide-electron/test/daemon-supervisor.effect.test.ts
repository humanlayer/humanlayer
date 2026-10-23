import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { HostIdPersistenceError } from '@humanlayer/riptide-electron-rpc'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as PlatformError from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Queue from 'effect/Queue'
import * as Redacted from 'effect/Redacted'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import * as Sink from 'effect/Sink'
import * as Stream from 'effect/Stream'
import { TestClock } from 'effect/testing'

import type { ElectronConfig } from '../src/config/electron-config'
import { mergeDaemonEnvironment } from '../src/daemon/daemon-environment'
import { terminateDaemonGeneration } from '../src/daemon/daemon-generation'
import { startDaemonOutputConsumers } from '../src/daemon/daemon-log'
import { makeDaemonSupervisorLive } from '../src/daemon/daemon-supervisor.layer'
import { DaemonSupervisor } from '../src/daemon/daemon-supervisor.service'
import { HostIdService } from '../src/host/host-id-service'
import { ElectronPlatform } from '../src/platform/electron-platform.service'
import { InheritedEnvironment } from '../src/platform/inherited-environment'

const textEncoder = new TextEncoder()
const daemonReadyLine = textEncoder.encode('{"type":"daemon_ready"}\n')

const platformLayer = Layer.succeed(
	ElectronPlatform,
	ElectronPlatform.of({
		productName: 'HumanLayer-Test Electron',
		version: '1.0.0',
		isPackaged: false,
		resourcesPath: '/resources',
		preloadPath: '/preload.cjs',
		homeDirectory: '/Users/test',
		userDataPath: '/test/profile',
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
).pipe(Layer.merge(Layer.succeed(InheritedEnvironment, { snapshot: Effect.succeed({}) })))

const makeProcessLayer = (input: {
	readonly daemonSpawns: Ref.Ref<number>
	readonly signals: Queue.Queue<ChildProcess.Signal>
	readonly exit: Deferred.Deferred<ChildProcessSpawner.ExitCode>
	readonly generationExits?: readonly Deferred.Deferred<ChildProcessSpawner.ExitCode>[]
	readonly exitAwaited?: Deferred.Deferred<void>
	readonly exitAwaitCount?: Ref.Ref<number>
	readonly exitOnTerm: boolean
	readonly registerScopeFinalizer?: boolean
	readonly failDaemonSpawnAt?: number
	readonly stdout?: Stream.Stream<Uint8Array>
	readonly stderr?: Stream.Stream<Uint8Array>
	readonly daemonEnvironments?: Array<Record<string, string>>
	readonly generationStdouts?: readonly Stream.Stream<Uint8Array>[]
	readonly generationStderrs?: readonly Stream.Stream<Uint8Array>[]
	readonly spawnEvents?: Queue.Queue<number>
	readonly daemonEnvironment?: Ref.Ref<Record<string, string | undefined> | null>
}) => {
	const exitAwaited = input.exitAwaited
	const exitAwaitCount = input.exitAwaitCount
	const spawner = ChildProcessSpawner.make((command) =>
		Effect.gen(function* () {
			if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die('Piped commands are not expected')
			if (command.args[0] === '-il') {
				const stdout = Stream.make(
					textEncoder.encode(
						'HOME=/Users/test\0PATH=/usr/local/bin:/usr/bin\0DAEMON_IDENTITY=stale-token\0RIPTIDE_DAEMON_EXPECTED_IDENTITY={"userId":"stale"}\0',
					),
				)
				return ChildProcessSpawner.makeHandle({
					pid: ChildProcessSpawner.ProcessId(10),
					exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
					isRunning: Effect.succeed(false),
					kill: () => Effect.void,
					stdin: Sink.drain,
					stdout,
					stderr: Stream.empty,
					all: stdout,
					getInputFd: () => Sink.drain,
					getOutputFd: () => Stream.empty,
					unref: Effect.succeed(Effect.void),
				})
			}
			// Record each daemon spawn's environment and sequence number so tests
			expect(command.options.extendEnv).toBe(false)
			// can assert on launch order, restart behavior, and injected env vars
			// (e.g. HUMANLAYER_CLAUDE_PATH) without module mocks.
			if (input.daemonEnvironments !== undefined) {
				input.daemonEnvironments.push(
					Object.fromEntries(
						Object.entries(command.options.env ?? {}).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
				)
			}
			const spawnNumber = yield* Ref.updateAndGet(input.daemonSpawns, (count) => count + 1)
			if (input.daemonEnvironment !== undefined) {
				yield* Ref.set(input.daemonEnvironment, { ...command.options.env })
			}
			if (input.spawnEvents !== undefined) yield* Queue.offer(input.spawnEvents, spawnNumber)
			if (spawnNumber === input.failDaemonSpawnAt) {
				return yield* Effect.fail(
					PlatformError.systemError({
						_tag: 'Unknown',
						module: 'ChildProcess',
						method: 'spawn',
						description: 'scripted spawn failure',
					}),
				)
			}
			const running = yield* Ref.make(true)
			const generationExit = input.generationExits?.[spawnNumber - 1] ?? input.exit
			const handle = ChildProcessSpawner.makeHandle({
				pid: ChildProcessSpawner.ProcessId(100),
				exitCode:
					exitAwaited === undefined || exitAwaitCount === undefined
						? Deferred.await(generationExit)
						: Ref.updateAndGet(exitAwaitCount, (count) => count + 1).pipe(
								Effect.flatMap((count) =>
									count >= 2 ? Deferred.succeed(exitAwaited, undefined) : Effect.void,
								),
								Effect.andThen(Deferred.await(generationExit)),
							),
				isRunning: Ref.get(running),
				kill: (options) => {
					const signal = options?.killSignal ?? 'SIGTERM'
					return Queue.offer(input.signals, signal).pipe(
						Effect.andThen(
							signal === 'SIGKILL' || input.exitOnTerm
								? Ref.set(running, false).pipe(
										Effect.andThen(
											Deferred.succeed(generationExit, ChildProcessSpawner.ExitCode(0)),
										),
										Effect.asVoid,
									)
								: Effect.void,
						),
						Effect.andThen(Deferred.await(generationExit)),
						Effect.asVoid,
					)
				},
				stdin: Sink.drain,
				stdout: input.generationStdouts?.[spawnNumber - 1] ?? input.stdout ?? Stream.make(daemonReadyLine),
				stderr: input.generationStderrs?.[spawnNumber - 1] ?? input.stderr ?? Stream.empty,
				all: Stream.empty,
				getInputFd: () => Sink.drain,
				getOutputFd: () => Stream.empty,
				unref: Effect.succeed(Effect.void),
			})
			if (input.registerScopeFinalizer) {
				yield* Effect.addFinalizer(() => handle.kill().pipe(Effect.catch(() => Effect.void)))
			}
			return handle
		}),
	)
	return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

const makeElectronConfig = (directory: string, executable: string): ElectronConfig => ({
	channel: 'local',
	isPackaged: false,
	userDataPath: directory,
	homeDirectory: directory,
	devstackId: undefined,
	rendererUrl: new URL('http://localhost:3000'),
	applicationIconPath: undefined,
	remoteDebuggingPort: 9222,
	cdpEnabled: false,
	openDevTools: false,
	logPath: `${directory}/electron.log`,
	daemonMode: 'staged',
	stagedDaemonPath: executable,
	protocolSchemes: ['humanlayer-electron-local'],
})

const daemonRequest = {
	token: Redacted.make('secret'),
	userId: 'user-1',
	organizationId: 'org-1',
	syncMode: 'auto' as const,
	apiOrigin: 'http://localhost:8700',
	syncOrigin: 'http://localhost:3002',
	verifiedClaudePath: null,
}

describe('DaemonSupervisor', () => {
	it('preserves launcher PATH entries missing from the interactive shell', () => {
		expect(
			mergeDaemonEnvironment(
				{ PATH: '/electron/bin:/shared/bin', ELECTRON_ONLY: 'present' },
				{ PATH: '/shell/bin:/shared/bin', SHELL_ONLY: 'present' },
			),
		).toEqual({
			PATH: '/shell/bin:/shared/bin:/electron/bin',
			ELECTRON_ONLY: 'present',
			SHELL_ONLY: 'present',
		})
	})

	it.effect('starts one generation per tuple and stops it gracefully', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const daemonEnvironment = yield* Ref.make<Record<string, string | undefined> | null>(null)
				const config: ElectronConfig = {
					channel: 'local',
					isPackaged: false,
					userDataPath: directory,
					homeDirectory: directory,
					devstackId: undefined,
					rendererUrl: new URL('http://localhost:3000'),
					applicationIconPath: undefined,
					remoteDebuggingPort: 9222,
					cdpEnabled: false,
					openDevTools: false,
					logPath: `${directory}/electron.log`,
					daemonMode: 'staged',
					stagedDaemonPath: executable,
					protocolSchemes: ['humanlayer-electron-local'],
				}
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({ daemonSpawns, signals, exit, exitOnTerm: true, daemonEnvironment }),
				)
				const layer = makeDaemonSupervisorLive(config).pipe(Layer.provide(dependencies))
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const request = {
						token: Redacted.make('secret'),
						userId: 'user-1',
						organizationId: 'org-1',
						syncMode: 'auto' as const,
						apiOrigin: 'http://localhost:8700',
						syncOrigin: 'http://localhost:3002',
						verifiedClaudePath: null,
					}
					const first = yield* supervisor.start(request)
					const second = yield* supervisor.start(request)
					expect(first).toEqual({ type: 'daemon_ready' })
					expect(second).toEqual({ type: 'daemon_ready' })
					expect(yield* Ref.get(daemonSpawns)).toBe(1)
					expect(yield* Ref.get(daemonEnvironment)).toMatchObject({
						DAEMON_IDENTITY: 'secret',
						RIPTIDE_DAEMON_EXPECTED_IDENTITY: JSON.stringify({
							userId: request.userId,
							organizationId: request.organizationId,
							hostId: 'host-1',
						}),
					})
					yield* supervisor.stop(request)
					expect(yield* Queue.take(signals)).toBe('SIGTERM')
					expect(yield* supervisor.isRunning(request)).toBe(false)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('keeps start pending until ready and only then promotes the candidate', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const output = yield* Queue.unbounded<Uint8Array>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit,
						exitOnTerm: true,
						stdout: Stream.fromQueue(output),
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const startFiber = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)

					yield* Queue.offer(output, daemonReadyLine)
					expect(yield* Fiber.join(startFiber)).toEqual({ type: 'daemon_ready' })
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(true)
					yield* supervisor.stop(daemonRequest)
					expect(yield* Queue.take(signals)).toBe('SIGTERM')
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('shares one pending contention result across concurrent starts without ownership or restart', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const output = yield* Queue.unbounded<Uint8Array>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit,
						exitOnTerm: true,
						stdout: Stream.fromQueue(output),
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const events =
						yield* Queue.unbounded<import('@humanlayer/riptide-electron-rpc').DaemonLifecycleEvent>()
					yield* supervisor.lifecycleEvents.pipe(
						Stream.runForEach((event) => Queue.offer(events, event)),
						Effect.forkScoped,
					)
					const first = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)
					const second = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					const alreadyRunning = textEncoder.encode(
						'{"type":"daemon_already_running","message":"Matching daemon already owns the lease"}\n',
					)
					yield* Queue.offer(output, alreadyRunning)
					const expected = {
						type: 'daemon_already_running',
						message: 'Matching daemon already owns the lease',
					} as const
					expect(yield* Fiber.join(first)).toEqual(expected)
					expect(yield* Fiber.join(second)).toEqual(expected)
					yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(0))
					expect(yield* Ref.get(daemonSpawns)).toBe(1)
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
					expect(Option.isNone(yield* Queue.poll(events))).toBe(true)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('allows an explicit launch to become owned after an external incumbent disappears', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const replacementExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const firstOutput = yield* Queue.unbounded<Uint8Array>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const alreadyRunning = textEncoder.encode(
					'{"type":"daemon_already_running","message":"External incumbent owns the lease"}\n',
				)
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit: firstExit,
						generationExits: [firstExit, replacementExit],
						exitOnTerm: true,
						generationStdouts: [Stream.fromQueue(firstOutput), Stream.make(daemonReadyLine)],
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const firstStart = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)
					yield* Queue.offer(firstOutput, alreadyRunning)
					expect(yield* Fiber.join(firstStart)).toEqual({
						type: 'daemon_already_running',
						message: 'External incumbent owns the lease',
					})
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
					yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(0))

					expect(yield* supervisor.start(daemonRequest)).toEqual({ type: 'daemon_ready' })
					expect(yield* Ref.get(daemonSpawns)).toBe(2)
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(true)
					yield* supervisor.stop(daemonRequest)
					expect(yield* Queue.take(signals)).toBe('SIGTERM')
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('fails and cleans up when a candidate exits before a launch result', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit,
						exitOnTerm: true,
						stdout: Stream.empty,
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const startFiber = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)
					yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(12))
					const result = yield* Fiber.await(startFiber)
					expect(result._tag).toBe('Failure')
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('times out and terminates an unready candidate after 45 seconds', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit,
						exitOnTerm: true,
						stdout: Stream.never,
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const startFiber = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)
					yield* TestClock.adjust('45 seconds')
					expect(yield* Queue.take(signals)).toBe('SIGTERM')
					const result = yield* Fiber.await(startFiber)
					expect(result._tag).toBe('Failure')
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('resolves the expected host identity before spawning a generation', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const config: ElectronConfig = {
					channel: 'local',
					isPackaged: false,
					userDataPath: directory,
					homeDirectory: directory,
					devstackId: undefined,
					rendererUrl: new URL('http://localhost:3000'),
					applicationIconPath: undefined,
					remoteDebuggingPort: 9222,
					cdpEnabled: false,
					openDevTools: false,
					logPath: `${directory}/electron.log`,
					daemonMode: 'staged',
					stagedDaemonPath: executable,
					protocolSchemes: ['humanlayer-electron-local'],
				}
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(
						HostIdService,
						HostIdService.of({
							get: Effect.fail(new HostIdPersistenceError({ message: 'host ID unavailable' })),
						}),
					),
					makeProcessLayer({ daemonSpawns, signals, exit, exitOnTerm: true, registerScopeFinalizer: true }),
				)
				const layer = makeDaemonSupervisorLive(config).pipe(Layer.provide(dependencies))
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const result = yield* Effect.exit(
						supervisor.start({
							token: Redacted.make('secret'),
							userId: 'user-1',
							organizationId: 'org-1',
							syncMode: 'auto',
							apiOrigin: 'http://localhost:8700',
							syncOrigin: 'http://localhost:3002',
							verifiedClaudePath: null,
						}),
					)
					expect(result._tag).toBe('Failure')
					expect(yield* Ref.get(daemonSpawns)).toBe(0)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('injects the verified Claude path and replaces the daemon when it changes', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				const firstClaude = `${directory}/claude-a`
				const secondClaude = `${directory}/claude-b`
				yield* Effect.forEach([executable, firstClaude, secondClaude], (path) =>
					fileSystem.writeFileString(path, 'fixture'),
				)
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const secondExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const daemonEnvironments: Array<Record<string, string>> = []
				const config: ElectronConfig = {
					channel: 'local',
					isPackaged: false,
					userDataPath: directory,
					homeDirectory: directory,
					devstackId: undefined,
					rendererUrl: new URL('http://localhost:3000'),
					applicationIconPath: undefined,
					remoteDebuggingPort: 9222,
					cdpEnabled: false,
					openDevTools: false,
					logPath: `${directory}/electron.log`,
					daemonMode: 'staged',
					stagedDaemonPath: executable,
					protocolSchemes: ['humanlayer-electron-local'],
				}
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit: firstExit,
						generationExits: [firstExit, secondExit],
						exitOnTerm: true,
						daemonEnvironments,
					}),
				)
				const layer = makeDaemonSupervisorLive(config).pipe(Layer.provide(dependencies))
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const baseRequest = {
						token: Redacted.make('secret'),
						userId: 'user-1',
						organizationId: 'org-1',
						syncMode: 'auto' as const,
						apiOrigin: 'http://localhost:8700',
						syncOrigin: 'http://localhost:3002',
					}
					yield* supervisor.start({ ...baseRequest, verifiedClaudePath: firstClaude })
					// Same verified path: the running daemon is reused, not replaced.
					yield* supervisor.start({ ...baseRequest, verifiedClaudePath: firstClaude })
					expect(yield* Ref.get(daemonSpawns)).toBe(1)
					expect(yield* supervisor.isRunning(baseRequest)).toBe(true)
					// A different verified path replaces the daemon so the new binary takes effect.
					// The path itself is parsed/validated once at the RPC boundary (see
					// verified-claude-path.effect.test.ts), so the supervisor trusts it here.
					yield* supervisor.start({ ...baseRequest, verifiedClaudePath: secondClaude })

					expect(yield* Ref.get(daemonSpawns)).toBe(2)
					expect(daemonEnvironments.map((environment) => environment.HUMANLAYER_CLAUDE_PATH)).toEqual([
						firstClaude,
						secondClaude,
					])
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('waits ten seconds before forcing a daemon process group down', () =>
		Effect.gen(function* () {
			const signals = yield* Queue.unbounded<ChildProcess.Signal>()
			const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
			const exitAwaited = yield* Deferred.make<void>()
			const running = yield* Ref.make(true)
			const intentionalStop = yield* Ref.make(false)
			const scope = yield* Scope.make()
			const handle = ChildProcessSpawner.makeHandle({
				pid: ChildProcessSpawner.ProcessId(100),
				exitCode: Deferred.succeed(exitAwaited, undefined).pipe(Effect.andThen(Deferred.await(exit))),
				isRunning: Ref.get(running),
				kill: (options) => {
					const signal = options?.killSignal ?? 'SIGTERM'
					return Queue.offer(signals, signal).pipe(
						Effect.andThen(Deferred.succeed(exitAwaited, undefined)),
						Effect.andThen(
							signal === 'SIGKILL'
								? Ref.set(running, false).pipe(
										Effect.andThen(Deferred.succeed(exit, ChildProcessSpawner.ExitCode(0))),
										Effect.asVoid,
									)
								: Effect.void,
						),
						Effect.andThen(Deferred.await(exit)),
						Effect.asVoid,
					)
				},
				stdin: Sink.drain,
				stdout: Stream.empty,
				stderr: Stream.empty,
				all: Stream.empty,
				getInputFd: () => Sink.drain,
				getOutputFd: () => Stream.empty,
				unref: Effect.succeed(Effect.void),
			})
			const stopFiber = yield* terminateDaemonGeneration({
				generation: {
					info: { userId: 'user-1', organizationId: 'org-1', hostId: 'host-1', pid: 100, syncMode: 'auto' },
					handle,
					scope,
					intentionalStop,
				},
				gracePeriod: '10 seconds',
			}).pipe(Effect.forkChild)
			expect(yield* Queue.take(signals)).toBe('SIGTERM')
			yield* Deferred.await(exitAwaited)
			yield* TestClock.adjust('9999 millis')
			expect(Option.isNone(yield* Queue.poll(signals))).toBe(true)
			yield* TestClock.adjust('1 millis')
			expect(yield* Queue.take(signals)).toBe('SIGKILL')
			yield* Fiber.join(stopFiber)
		}),
	)

	for (const scenario of ['restart-succeeds', 'restart-fails', 'authentication-fails'] as const) {
		it.effect(`publishes deterministic ${scenario} lifecycle outcomes`, () =>
			Effect.scoped(
				Effect.gen(function* () {
					const fileSystem = yield* FileSystem.FileSystem
					const directory = yield* fileSystem.makeTempDirectoryScoped()
					const executable = `${directory}/riptided`
					yield* fileSystem.writeFileString(executable, 'fixture')
					const daemonSpawns = yield* Ref.make(0)
					const signals = yield* Queue.unbounded<ChildProcess.Signal>()
					const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
					const replacementExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
					const exitAwaited = yield* Deferred.make<void>()
					const exitAwaitCount = yield* Ref.make(1)
					const config: ElectronConfig = {
						channel: 'local',
						isPackaged: false,
						userDataPath: directory,
						homeDirectory: directory,
						devstackId: undefined,
						rendererUrl: new URL('http://localhost:3000'),
						applicationIconPath: undefined,
						remoteDebuggingPort: 9222,
						cdpEnabled: false,
						openDevTools: false,
						logPath: `${directory}/electron.log`,
						daemonMode: 'staged',
						stagedDaemonPath: executable,
						protocolSchemes: ['humanlayer-electron-local'],
					}
					const authenticationLine = textEncoder.encode('{"type":"auth_failure","message":"Sign in again"}\n')
					const dependencies = Layer.mergeAll(
						NodeFileSystem.layer,
						NodePath.layer,
						NodeCrypto.layer,
						ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
						platformLayer,
						Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
						makeProcessLayer({
							daemonSpawns,
							signals,
							exit: firstExit,
							generationExits: [firstExit, replacementExit],
							exitAwaited,
							exitAwaitCount,
							exitOnTerm: true,
							failDaemonSpawnAt: scenario === 'restart-fails' ? 2 : undefined,
							stderr:
								scenario === 'authentication-fails' ? Stream.make(authenticationLine) : Stream.empty,
						}),
					)
					const layer = makeDaemonSupervisorLive(config).pipe(Layer.provide(dependencies))
					yield* Effect.gen(function* () {
						const supervisor = yield* DaemonSupervisor
						const events =
							yield* Queue.unbounded<import('@humanlayer/riptide-electron-rpc').DaemonLifecycleEvent>()
						yield* supervisor.lifecycleEvents.pipe(
							Stream.runForEach((event) => Queue.offer(events, event)),
							Effect.forkScoped,
						)
						const request = {
							token: Redacted.make('secret'),
							userId: 'user-1',
							organizationId: 'org-1',
							syncMode: 'auto' as const,
							apiOrigin: 'http://localhost:8700',
							syncOrigin: 'http://localhost:3002',
							verifiedClaudePath: null,
						}
						yield* supervisor.start(request)
						if (scenario === 'authentication-fails') {
							const authenticationFailed = yield* Queue.take(events)
							expect(authenticationFailed).toMatchObject({
								_tag: 'AuthenticationFailed',
								message: 'Sign in again',
							})
							yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(1))
							yield* Deferred.await(exitAwaited)
							expect(yield* Ref.get(daemonSpawns)).toBe(1)
							return
						}
						yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(1))
						const unexpected = yield* Queue.take(events)
						const restartOutcome = yield* Queue.take(events)
						expect(unexpected._tag).toBe('UnexpectedExit')
						expect(restartOutcome._tag).toBe(
							scenario === 'restart-succeeds' ? 'RestartSucceeded' : 'RestartFailed',
						)
						expect(yield* Ref.get(daemonSpawns)).toBe(2)
						if (scenario === 'restart-succeeds') {
							expect(yield* supervisor.isRunning(request)).toBe(true)
							yield* Effect.yieldNow
							expect(yield* Ref.get(daemonSpawns)).toBe(2)
							expect(Option.isNone(yield* Queue.poll(events))).toBe(true)
						}
					}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
				}),
			).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
		)
	}

	it.effect('publishes restart success only after the replacement reports ready', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const replacementOutput = yield* Queue.unbounded<Uint8Array>()
				const firstExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const replacementExit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit: firstExit,
						generationExits: [firstExit, replacementExit],
						exitOnTerm: true,
						generationStdouts: [Stream.make(daemonReadyLine), Stream.fromQueue(replacementOutput)],
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const events =
						yield* Queue.unbounded<import('@humanlayer/riptide-electron-rpc').DaemonLifecycleEvent>()
					yield* supervisor.lifecycleEvents.pipe(
						Stream.runForEach((event) => Queue.offer(events, event)),
						Effect.forkScoped,
					)
					expect(yield* supervisor.start(daemonRequest)).toEqual({ type: 'daemon_ready' })
					expect(yield* Queue.take(spawnEvents)).toBe(1)

					yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(1))
					expect((yield* Queue.take(events))._tag).toBe('UnexpectedExit')
					expect(yield* Queue.take(spawnEvents)).toBe(2)
					expect(Option.isNone(yield* Queue.poll(events))).toBe(true)
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)

					yield* Queue.offer(replacementOutput, daemonReadyLine)
					expect((yield* Queue.take(events))._tag).toBe('RestartSucceeded')
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(true)
					yield* supervisor.stop(daemonRequest)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('attributes logs and decodes launch results from both output streams', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const launchResultTypes = yield* Ref.make(new Set<string>())
				yield* startDaemonOutputConsumers({
					userId: 'user/one',
					organizationId: 'org:one',
					generationId: 'generation-7',
					stdout: Stream.make(
						textEncoder.encode('stdout fragment'),
						textEncoder.encode(
							' complete\n{"type":"daemon_already_running","message":"Already running"}\n',
						),
					),
					stderr: Stream.make(textEncoder.encode('stderr line\n{"type":"daemon_ready"}\n')),
					logDirectory: directory,
					onAuthenticationFailure: () => Effect.void,
					onLaunchResult: (result) =>
						Ref.update(launchResultTypes, (current) => new Set(current).add(result.type)),
				})
				const logPath = `${directory}/riptide-daemon-user_one-org_one-generation-7.log`
				const contents = yield* fileSystem.readFileString(logPath)
				expect(contents).toContain('[stdout] stdout fragment complete')
				expect(contents).toContain('[stderr] stderr line')
				expect(yield* Ref.get(launchResultTypes)).toEqual(new Set(['daemon_ready', 'daemon_already_running']))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('turning management off stops every owned tuple and blocks starts until it is turned on', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const exits = [
					yield* Deferred.make<ChildProcessSpawner.ExitCode>(),
					yield* Deferred.make<ChildProcessSpawner.ExitCode>(),
					yield* Deferred.make<ChildProcessSpawner.ExitCode>(),
				]
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit: exits[0]!,
						generationExits: exits,
						exitOnTerm: true,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const events =
						yield* Queue.unbounded<import('@humanlayer/riptide-electron-rpc').DaemonLifecycleEvent>()
					yield* supervisor.lifecycleEvents.pipe(
						Stream.runForEach((event) => Queue.offer(events, event)),
						Effect.forkScoped,
					)
					const otherOrganization = { ...daemonRequest, organizationId: 'org-2' }
					yield* supervisor.start(daemonRequest)
					yield* supervisor.start(otherOrganization)

					yield* supervisor.setManagementEnabled(false)
					expect([yield* Queue.take(signals), yield* Queue.take(signals)]).toEqual(['SIGTERM', 'SIGTERM'])
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
					expect(yield* supervisor.isRunning(otherOrganization)).toBe(false)
					const blocked = yield* Effect.flip(supervisor.start(daemonRequest))
					expect(blocked._tag).toBe('DaemonUnavailableError')
					yield* supervisor.setManagementEnabled(false)
					expect(yield* Ref.get(daemonSpawns)).toBe(2)
					expect(Option.isNone(yield* Queue.poll(events))).toBe(true)

					yield* supervisor.setManagementEnabled(true)
					expect(yield* supervisor.start(daemonRequest)).toEqual({ type: 'daemon_ready' })
					expect(yield* Ref.get(daemonSpawns)).toBe(3)
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(true)
					yield* supervisor.stop(daemonRequest)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('turning management off cancels a pending launch and terminates its candidate', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const directory = yield* fileSystem.makeTempDirectoryScoped()
				const executable = `${directory}/riptided`
				yield* fileSystem.writeFileString(executable, 'fixture')
				const daemonSpawns = yield* Ref.make(0)
				const signals = yield* Queue.unbounded<ChildProcess.Signal>()
				const spawnEvents = yield* Queue.unbounded<number>()
				const output = yield* Queue.unbounded<Uint8Array>()
				const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>()
				const dependencies = Layer.mergeAll(
					NodeFileSystem.layer,
					NodePath.layer,
					NodeCrypto.layer,
					ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/bin/zsh' })),
					platformLayer,
					Layer.succeed(HostIdService, HostIdService.of({ get: Effect.succeed('host-1') })),
					makeProcessLayer({
						daemonSpawns,
						signals,
						exit,
						exitOnTerm: true,
						stdout: Stream.fromQueue(output),
						spawnEvents,
					}),
				)
				const layer = makeDaemonSupervisorLive(makeElectronConfig(directory, executable)).pipe(
					Layer.provideMerge(dependencies),
				)
				yield* Effect.gen(function* () {
					const supervisor = yield* DaemonSupervisor
					const startFiber = yield* supervisor.start(daemonRequest).pipe(Effect.forkChild)
					expect(yield* Queue.take(spawnEvents)).toBe(1)

					yield* supervisor.setManagementEnabled(false)
					expect(yield* Queue.take(signals)).toBe('SIGTERM')
					const cancelled = yield* Effect.flip(Fiber.join(startFiber))
					expect(cancelled._tag).toBe('DaemonUnavailableError')
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)

					// A late ready line from the cancelled candidate must not promote it.
					yield* Queue.offer(output, daemonReadyLine)
					yield* Effect.yieldNow
					expect(yield* supervisor.isRunning(daemonRequest)).toBe(false)
					expect(yield* Ref.get(daemonSpawns)).toBe(1)
				}).pipe(Effect.provide(Layer.mergeAll(layer, dependencies)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)
})
