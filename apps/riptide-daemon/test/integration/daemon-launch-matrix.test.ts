import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import { DaemonIdentity, DaemonLockOwner } from '@humanlayer/schemas/effect/daemon/identity'
import {
	DaemonAuthenticationFailed,
	decodeDaemonProcessEventLine,
	type DaemonLaunchResult,
} from '@humanlayer/schemas/effect/daemon/process-event'
import type { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Crypto from 'effect/Crypto'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Schema from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

type Launcher = 'cli' | 'electron' | 'tauri'

const identity = DaemonIdentity.make({
	userId: 'matrix-user',
	organizationId: 'matrix-org',
	hostId: 'matrix-host',
})
const launchers: readonly Launcher[] = ['cli', 'electron', 'tauri']
const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const lockPathFor = Effect.fn('daemon_launch_matrix.lock_path_for')(function* (
	homeDirectory: string,
	stage: DaemonStage,
) {
	const crypto = yield* Crypto.Crypto
	const pathService = yield* Path.Path
	const fingerprint = bytesToHex(
		yield* crypto.digest(
			'SHA-256',
			new TextEncoder().encode(
				`${identity.userId}\u0000${identity.organizationId}\u0000${identity.hostId}\u0000${stage}`,
			),
		),
	)
	return pathService.join(homeDirectory, '.humanlayer', 'riptide', 'daemon-locks', `${fingerprint}.lock`)
})

const launch = Effect.fn('daemon_launch_matrix.launch')(function* (
	launcher: Launcher,
	homeDirectory: string,
	stage: DaemonStage,
	origins = { api: 'https://api-one.example.com', sync: 'https://sync-one.example.com' },
) {
	const pathService = yield* Path.Path
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
	const stdio = yield* Stdio.Stdio
	const childFixture = pathService.join(import.meta.dirname, 'helpers', 'daemon-launch-matrix-child.ts')
	const handle = yield* spawner.spawn(
		ChildProcess.make('bun', [childFixture], {
			env: {
				HOME: homeDirectory,
				DAEMON_MATRIX_INPUT: JSON.stringify({ ...identity, stage, launcher }),
				RIPTIDE_API_ORIGIN: origins.api,
				RIPTIDE_SYNC_ORIGIN: origins.sync,
			},
			extendEnv: true,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
		}),
	)
	yield* handle.stderr.pipe(Stream.run(stdio.stderr()), Effect.forkScoped)
	const line = yield* handle.stdout.pipe(
		Stream.decodeText(),
		Stream.splitLines,
		Stream.runHead,
		Effect.timeoutOrElse({
			duration: '50 seconds',
			orElse: () => Effect.die(`${launcher} did not report a result`),
		}),
		Effect.map(Option.getOrThrow),
	)
	const event = yield* decodeDaemonProcessEventLine({ line })
	if (Schema.is(DaemonAuthenticationFailed)(event)) return yield* Effect.die('Unexpected auth failure')
	return { handle, result: event }
})

const readLockOwner = Effect.fn('daemon_launch_matrix.read_lock_owner')(function* (lockPath: string) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const contents = yield* fileSystem.readFileString(pathService.join(lockPath, 'owner.json'))
	const encoded = yield* Effect.try(() => JSON.parse(contents))
	return yield* Schema.decodeUnknownEffect(DaemonLockOwner)(encoded)
})

const expectLaunchResult = (actual: DaemonLaunchResult, expected: DaemonLaunchResult): void => {
	expect(actual).toEqual(expected)
}

describe('cross-launcher daemon ownership matrix', () => {
	it.live(
		'excludes every same-stage launcher order and ignores runtime origins',
		() =>
			Effect.forEach(
				launchers,
				(ownerLauncher) =>
					Effect.scoped(
						Effect.gen(function* () {
							const fileSystem = yield* FileSystem.FileSystem
							const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-launch-matrix-' })
							const owner = yield* launch(ownerLauncher, home, 'dev')
							expectLaunchResult(owner.result, { type: 'daemon_ready' })
							const contenders = launchers.filter((launcher) => launcher !== ownerLauncher)
							yield* Effect.forEach(
								contenders,
								(launcher) =>
									Effect.scoped(
										Effect.gen(function* () {
											const contender = yield* launch(launcher, home, 'dev', {
												api: `https://api-${launcher}.example.com`,
												sync: `https://sync-${launcher}.example.com`,
											})
											expectLaunchResult(contender.result, {
												type: 'daemon_already_running',
												message: 'Matching daemon already owns the lease',
											})
											yield* contender.handle.exitCode
										}),
									),
								{ concurrency: 2 },
							)
							expect(yield* owner.handle.isRunning).toBe(true)
							yield* owner.handle.kill()
							yield* owner.handle.exitCode
							expect(yield* fileSystem.exists(yield* lockPathFor(home, 'dev'))).toBe(false)
						}),
					),
				{ concurrency: 3 },
			).pipe(Effect.asVoid, Effect.provide(NodeServices.layer)),
		60_000,
	)

	it.live('allows different stages and replaces a gracefully released owner', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-launch-matrix-' })
				const devOwner = yield* launch('tauri', home, 'dev')
				const prodOwner = yield* launch('electron', home, 'prod')
				expectLaunchResult(devOwner.result, { type: 'daemon_ready' })
				expectLaunchResult(prodOwner.result, { type: 'daemon_ready' })
				const devLockPath = yield* lockPathFor(home, 'dev')
				const prodLockPath = yield* lockPathFor(home, 'prod')
				expect(devLockPath).not.toBe(prodLockPath)
				expect(yield* fileSystem.exists(devLockPath)).toBe(true)
				expect(yield* fileSystem.exists(prodLockPath)).toBe(true)
				yield* devOwner.handle.kill()
				yield* devOwner.handle.exitCode
				expect(yield* fileSystem.exists(devLockPath)).toBe(false)
				const replacement = yield* launch('cli', home, 'dev')
				expectLaunchResult(replacement.result, { type: 'daemon_ready' })
				expect(yield* prodOwner.handle.isRunning).toBe(true)
				yield* replacement.handle.kill()
				yield* replacement.handle.exitCode
				yield* prodOwner.handle.kill()
				yield* prodOwner.handle.exitCode
				expect(yield* fileSystem.exists(devLockPath)).toBe(false)
				expect(yield* fileSystem.exists(prodLockPath)).toBe(false)
			}),
		).pipe(Effect.provide(NodeServices.layer)),
	)

	it.live('recovers a stale lease after abrupt owner death without overlapping live owners', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-launch-matrix-' })
				const owner = yield* launch('tauri', home, 'dev')
				expectLaunchResult(owner.result, { type: 'daemon_ready' })
				const lockPath = yield* lockPathFor(home, 'dev')
				expect(yield* readLockOwner(lockPath)).toMatchObject({
					...identity,
					stage: 'dev',
					generationId: 'tauri',
				})
				const liveContender = yield* launch('cli', home, 'dev')
				expectLaunchResult(liveContender.result, {
					type: 'daemon_already_running',
					message: 'Matching daemon already owns the lease',
				})
				yield* liveContender.handle.exitCode
				yield* owner.handle.kill({ killSignal: 'SIGKILL' })
				const killedOwnerExit = yield* Effect.exit(owner.handle.exitCode)
				expect(
					Exit.isFailure(killedOwnerExit),
					'SIGKILL must be observed as signal termination before stale lease recovery',
				).toBe(true)
				const staleTime = DateTime.toDateUtc(DateTime.makeUnsafe(0))
				yield* fileSystem.utimes(lockPath, staleTime, staleTime)
				const replacement = yield* launch('electron', home, 'dev')
				expectLaunchResult(replacement.result, { type: 'daemon_ready' })
				expect(yield* readLockOwner(lockPath)).toMatchObject({
					...identity,
					stage: 'dev',
					generationId: 'electron',
				})
				yield* replacement.handle.kill()
				yield* replacement.handle.exitCode
				expect(yield* fileSystem.exists(lockPath)).toBe(false)
			}),
		).pipe(Effect.provide(NodeServices.layer)),
	)
})
