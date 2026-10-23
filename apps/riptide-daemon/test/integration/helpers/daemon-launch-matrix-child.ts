#!/usr/bin/env bun

import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import { DaemonLeaseIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import { encodeDaemonProcessEvent } from '@humanlayer/schemas/effect/daemon/process-event'
import * as Config from 'effect/Config'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import { DaemonInstanceLockLive } from '../../../src/effects/services/daemon-instance-lock/daemon-instance-lock.layer'
import { DaemonInstanceLock } from '../../../src/effects/services/daemon-instance-lock/daemon-instance-lock.service'

const LaunchInput = Schema.Struct({
	...DaemonLeaseIdentity.fields,
	launcher: Schema.Literals(['cli', 'electron', 'tauri']),
})

const emitProcessEvent = Effect.fn('daemon_launch_matrix_child.emit_process_event')(function* (
	event: Parameters<typeof encodeDaemonProcessEvent>[0],
) {
	const stdio = yield* Stdio.Stdio
	yield* Stream.run(Stream.make(`${encodeDaemonProcessEvent(event)}\n`), stdio.stdout())
})

const program = Effect.gen(function* () {
	const encodedInput = yield* Config.String('DAEMON_MATRIX_INPUT')
	const homeDirectory = yield* Config.String('HOME')
	const parsedInput = yield* Effect.try(() => JSON.parse(encodedInput))
	const input = yield* Schema.decodeUnknownEffect(LaunchInput)(parsedInput)
	const platform = Layer.mergeAll(
		NodeFileSystem.layer,
		NodePath.layer,
		NodeCrypto.layer,
		ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: homeDirectory })),
	)
	const lockLayer = DaemonInstanceLockLive.pipe(Layer.provideMerge(Layer.mergeAll(ProperLockfileLive, platform)))

	yield* Effect.gen(function* () {
		const lock = yield* DaemonInstanceLock
		const lease = yield* lock.acquire({
			userId: input.userId,
			organizationId: input.organizationId,
			hostId: input.hostId,
			stage: input.stage,
			generationId: input.launcher,
		})
		yield* emitProcessEvent({ type: 'daemon_ready' })
		yield* lease.monitorCompromise.pipe(
			Effect.catchTag('LockCompromisedError', (error) =>
				Effect.logError('Daemon matrix lease was compromised').pipe(Effect.annotateLogs({ error })),
			),
		)
	}).pipe(
		Effect.catchTag('DaemonInstanceAlreadyRunning', () =>
			emitProcessEvent({
				type: 'daemon_already_running',
				message: 'Matching daemon already owns the lease',
			}),
		),
		Effect.scoped,
		Effect.provide(lockLayer),
	)
}).pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program)
