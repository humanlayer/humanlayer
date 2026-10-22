import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import { makeProperLockfileTestLayer } from '@humanlayer/effect-proper-lockfile/test-utils'
import { DaemonLockOwner } from '@humanlayer/schemas/effect/daemon/identity'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import { TestClock } from 'effect/testing'

import { DaemonInstanceLockLive } from '../../src/effects/services/daemon-instance-lock/daemon-instance-lock.layer'
import { DaemonInstanceLock } from '../../src/effects/services/daemon-instance-lock/daemon-instance-lock.service'
import {
	DaemonInstanceAlreadyRunning,
	DaemonInstanceLockError,
} from '../../src/effects/services/daemon-instance-lock/errors'

const request = {
	userId: 'user-1',
	organizationId: 'org-1',
	hostId: 'host-1',
	stage: 'dev',
	generationId: 'generation-1',
} as const

const makeTestLayer = (homeDirectory: string, properLockfileLayer = ProperLockfileLive) => {
	const platform = Layer.mergeAll(
		NodeFileSystem.layer,
		NodePath.layer,
		NodeCrypto.layer,
		ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: homeDirectory })),
	)
	return DaemonInstanceLockLive.pipe(Layer.provideMerge(Layer.mergeAll(properLockfileLayer, platform)))
}

const expectAlreadyRunning = <R>(
	effect: Effect.Effect<unknown, DaemonInstanceAlreadyRunning | DaemonInstanceLockError, R>,
	expectedLockPath?: string,
) =>
	effect.pipe(
		Effect.flatMap(() => Effect.die('Expected daemon lock contention')),
		Effect.catchTag('DaemonInstanceAlreadyRunning', (error) =>
			Effect.sync(() => {
				if (expectedLockPath !== undefined) expect(error.lockPath).toBe(expectedLockPath)
			}),
		),
	)

describe('DaemonInstanceLock', () => {
	it.effect('rejects canonical identity contention and releases normally', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const releasedLockPath = yield* Effect.scoped(
						Effect.gen(function* () {
							const leaseOwnedByNestedScope = yield* lock.acquire(request)
							yield* expectAlreadyRunning(lock.acquire(request))
							return leaseOwnedByNestedScope.lockPath
						}),
					)
					const reacquired = yield* Effect.scoped(lock.acquire(request))
					expect(reacquired.lockPath).toBe(releasedLockPath)
				}).pipe(Effect.provide(makeTestLayer(homeDirectory, makeProperLockfileTestLayer())))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)

	it.effect('keeps every canonical identity dimension independent', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const owner = yield* lock.acquire(request)
					const variants = [
						{ ...request, userId: 'user-2' },
						{ ...request, organizationId: 'org-2' },
						{ ...request, hostId: 'host-2' },
						{ ...request, stage: 'prod' as const },
					]
					for (const variant of variants) {
						expect((yield* lock.acquire(variant)).lockPath).not.toBe(owner.lockPath)
					}
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory, makeProperLockfileTestLayer())))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)

	it.effect('shares one same-stage lease across launcher generations while stages remain independent', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const owner = yield* lock.acquire({ ...request, generationId: 'tauri-generation' })
					for (const generationId of ['electron-generation', 'cli-generation']) {
						yield* expectAlreadyRunning(lock.acquire({ ...request, generationId }), owner.lockPath)
					}
					for (const stage of ['local', 'beta', 'prod'] as const) {
						expect(
							(yield* lock.acquire({ ...request, stage, generationId: `cli-${stage}` })).lockPath,
						).not.toBe(owner.lockPath)
					}
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory, makeProperLockfileTestLayer())))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)

	it.effect('ignores runtime origins and generation metadata when identifying the owner', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const ownerInput = {
						...request,
						apiOrigin: 'https://api-one.example.com',
						syncOrigin: 'https://sync-one.example.com',
					}
					const contenderInput = {
						...request,
						generationId: 'generation-2',
						apiOrigin: 'https://api-two.example.com',
						syncOrigin: 'https://sync-two.example.com',
					}
					const owner = yield* lock.acquire(ownerInput)
					yield* expectAlreadyRunning(lock.acquire(contenderInput), owner.lockPath)
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory, makeProperLockfileTestLayer())))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)

	it.effect('uses a product-neutral path and records canonical owner metadata', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const lease = yield* lock.acquire(request)
					expect(
						lease.lockPath.startsWith(
							pathService.join(homeDirectory, '.humanlayer', 'riptide', 'daemon-locks'),
						),
					).toBe(true)
					const ownerContents = yield* fileSystem.readFileString(
						pathService.join(lease.lockPath, 'owner.json'),
					)
					const owner = yield* Effect.try(() => JSON.parse(ownerContents)).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(DaemonLockOwner)),
					)
					expect(owner).toMatchObject({
						userId: request.userId,
						organizationId: request.organizationId,
						hostId: request.hostId,
						stage: request.stage,
						generationId: request.generationId,
					})
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('reports compromise when ownership changes', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const lease = yield* lock.acquire(request)
					const compromiseMonitoringStarted = yield* Deferred.make<void>()
					yield* fileSystem.writeFileString(
						pathService.join(lease.lockPath, 'owner.json'),
						JSON.stringify({ ownerId: 'replacement-owner', acquiredAt: 1 }),
					)
					const compromised = yield* Effect.gen(function* () {
						yield* Deferred.succeed(compromiseMonitoringStarted, undefined)
						yield* lease.monitorCompromise.pipe(
							Effect.catchTag('LockCompromisedError', (error) =>
								Effect.sync(() => expect(error.reason).toBe('owner-changed')),
							),
						)
					}).pipe(Effect.forkChild)
					yield* Deferred.await(compromiseMonitoringStarted)
					yield* TestClock.adjust('5 seconds')
					yield* Fiber.join(compromised)
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory)))
			}),
		).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
	)

	it.effect('recovers a stale tuple lock', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'daemon-lock-' })
				yield* TestClock.setTime(60_000)
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const firstLeaseAcquired = yield* Deferred.make<string>()
					const staleLeaseRecoveryCompleted = yield* Deferred.make<void>()
					const staleLeaseOwner = yield* Effect.scoped(
						Effect.gen(function* () {
							const firstLease = yield* lock.acquire(request)
							yield* Deferred.succeed(firstLeaseAcquired, firstLease.lockPath)
							yield* Deferred.await(staleLeaseRecoveryCompleted)
						}),
					).pipe(Effect.forkChild)
					const firstLockPath = yield* Deferred.await(firstLeaseAcquired)
					const staleTime = DateTime.toDateUtc(DateTime.makeUnsafe(0))
					yield* fileSystem.utimes(firstLockPath, staleTime, staleTime)
					const recovered = yield* lock.acquire(request)
					expect(recovered.lockPath).toBe(firstLockPath)
					yield* Deferred.succeed(staleLeaseRecoveryCompleted, undefined)
					yield* Fiber.join(staleLeaseOwner)
					expect(yield* fileSystem.exists(recovered.lockPath)).toBe(true)
				}).pipe(Effect.scoped, Effect.provide(makeTestLayer(homeDirectory)))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)
})
