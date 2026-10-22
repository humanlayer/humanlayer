#!/usr/bin/env bun

import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { DaemonIdentity, DaemonLeaseIdentity, DaemonLockOwner } from '@humanlayer/schemas/effect/daemon/identity'
import { type DaemonProcessEvent, encodeDaemonProcessEvent } from '@humanlayer/schemas/effect/daemon/process-event'
import * as Config from 'effect/Config'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

const bytesToHexadecimalString = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const writeDaemonProcessEventToStandardOutput = Effect.fn(
	'daemon_locking_fixture.write_daemon_process_event_to_standard_output',
)(function* (event: DaemonProcessEvent) {
	const standardInputOutput = yield* Stdio.Stdio
	yield* Stream.make(`${encodeDaemonProcessEvent(event)}\n`).pipe(Stream.run(standardInputOutput.stdout()))
})

const daemonLockingFixtureProgram = Effect.scoped(
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const homeDirectory = yield* Config.String('RIPTIDE_API_ORIGIN').pipe(
			Config.orElse(() => Config.String('HOME')),
		)
		const encodedDaemonIdentity = yield* Config.String('DAEMON_IDENTITY')
		const daemonStage = yield* Config.String('RIPTIDE_DAEMON_CHANNEL').pipe(Config.withDefault('local'))
		const daemonGenerationId = yield* Config.option(Config.String('RIPTIDE_DAEMON_GENERATION_ID'))
		const daemonIdentity = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(DaemonIdentity))(
			encodedDaemonIdentity,
		)
		const daemonLeaseIdentity = yield* Schema.decodeUnknownEffect(DaemonLeaseIdentity)({
			...daemonIdentity,
			stage: daemonStage,
		})
		const daemonIdentityBytes = new TextEncoder().encode(
			`${daemonLeaseIdentity.userId}\u0000${daemonLeaseIdentity.organizationId}\u0000${daemonLeaseIdentity.hostId}\u0000${daemonLeaseIdentity.stage}`,
		)
		const daemonIdentityFingerprint = bytesToHexadecimalString(yield* crypto.digest('SHA-256', daemonIdentityBytes))
		const daemonLockDirectory = pathService.join(homeDirectory, '.humanlayer', 'riptide', 'daemon-locks')
		const daemonLockPath = pathService.join(daemonLockDirectory, `${daemonIdentityFingerprint}.lock`)

		yield* fileSystem.makeDirectory(daemonLockDirectory, { recursive: true })
		const acquiredDaemonLockPath = yield* Effect.acquireRelease(
			fileSystem.makeDirectory(daemonLockPath).pipe(Effect.as(daemonLockPath)),
			(pathToRelease) =>
				fileSystem
					.remove(pathToRelease, { recursive: true, force: true })
					.pipe(Effect.tapError(Effect.logError), Effect.orDie),
		).pipe(
			Effect.catchIf(
				(error) =>
					Predicate.isTagged('AlreadyExists')(error.reason) &&
					error.reason.module === 'FileSystem' &&
					error.reason.method === 'makeDirectory' &&
					error.reason.pathOrDescriptor === daemonLockPath,
				() =>
					writeDaemonProcessEventToStandardOutput({
						type: 'daemon_already_running',
						message: 'Matching daemon already owns the lease',
					}).pipe(Effect.andThen(Effect.interrupt)),
			),
		)

		const daemonLockOwner = DaemonLockOwner.make({
			pid: process.pid,
			...daemonLeaseIdentity,
			generationId: Option.getOrNull(daemonGenerationId),
		})
		const encodedDaemonLockOwner = yield* Schema.encodeEffect(DaemonLockOwner)(daemonLockOwner)
		yield* fileSystem.writeFileString(
			pathService.join(acquiredDaemonLockPath, 'owner.json'),
			JSON.stringify(encodedDaemonLockOwner),
		)
		yield* writeDaemonProcessEventToStandardOutput({ type: 'daemon_ready' })
		yield* Effect.logInfo('Daemon locking fixture acquired the daemon lease')
		yield* Effect.never
	}),
)

daemonLockingFixtureProgram.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
