#!/usr/bin/env bun

import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import {
	DaemonInstanceLeaseState,
	DaemonInstanceLockLive,
	makeActiveDaemonInstanceLeaseLive,
} from '../../src/effects/services/daemon-instance-lock'
import { createShutdownDeadline } from '../../src/lifecycle/shutdown-deadline'
import { installShutdownSignals } from '../../src/lifecycle/shutdown-signals'
import { createStartupShutdown } from '../../src/lifecycle/startup-shutdown'

const homeDirectory = process.env.HOME
if (homeDirectory === undefined) throw new Error('HOME is required')
const disposeHangs = process.argv[2] === 'dispose-hangs'

const platform = Layer.mergeAll(
	NodeFileSystem.layer,
	NodePath.layer,
	NodeCrypto.layer,
	ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: homeDirectory })),
)
const LeaseLive = makeActiveDaemonInstanceLeaseLive({
	userId: 'signal-user',
	organizationId: 'signal-org',
	hostId: 'signal-host',
	stage: 'dev',
	generationId: null,
}).pipe(
	Layer.provideMerge(DaemonInstanceLockLive.pipe(Layer.provideMerge(Layer.mergeAll(ProperLockfileLive, platform)))),
)
const SessionsThatNeverStopLive = Layer.effectDiscard(Effect.addFinalizer(() => Effect.never))
const runtime = ManagedRuntime.make(
	disposeHangs ? SessionsThatNeverStopLive.pipe(Layer.provideMerge(LeaseLive)) : LeaseLive,
)

const shutdownDeadline = createShutdownDeadline({
	forceShutdown: () => process.exit(1),
	timeoutMs: Number(process.env.SHUTDOWN_DEADLINE_MS ?? 5_000),
})
const startupShutdown = createStartupShutdown({
	deadline: shutdownDeadline,
	stopHeartbeat: () => {},
	disposeRuntime: () => runtime.dispose(),
	exit: () => process.exit(0),
})
installShutdownSignals(startupShutdown.shutdown)

const leaseState = await runtime.runPromise(DaemonInstanceLeaseState)
if (leaseState.mode !== 'active') throw new Error('Expected an active lease')
console.log(JSON.stringify({ lockPath: leaseState.lease.lockPath }))
setInterval(() => {}, 60_000)
