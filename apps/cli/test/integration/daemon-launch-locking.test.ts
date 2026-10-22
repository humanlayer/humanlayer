import * as NodeCrypto from '@effect/platform-node/NodeCrypto'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { makeProperLockfileTestLayer } from '@humanlayer/effect-proper-lockfile/test-utils'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'

import { DaemonInstanceLockLive } from '../../../riptide-daemon/src/effects/services/daemon-instance-lock/daemon-instance-lock.layer'
import { DaemonInstanceLock } from '../../../riptide-daemon/src/effects/services/daemon-instance-lock/daemon-instance-lock.service'

const identity = {
	userId: 'cli-user',
	organizationId: 'cli-org',
	hostId: 'cli-host',
	stage: 'dev',
	generationId: null,
} as const

const makeTestLayer = (homeDirectory: string) => {
	const platform = Layer.mergeAll(
		NodeFileSystem.layer,
		NodePath.layer,
		NodeCrypto.layer,
		ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: homeDirectory })),
	)
	return DaemonInstanceLockLive.pipe(Layer.provideMerge(Layer.mergeAll(makeProperLockfileTestLayer(), platform)))
}

describe('CLI daemon launch locking integration', () => {
	it.effect('hands a duplicate dev-stage launch to the owner and removes the scoped lease', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'cli-daemon-lock-' })
				yield* Effect.gen(function* () {
					const lock = yield* DaemonInstanceLock
					const ownerScope = yield* Scope.make()
					const owner = yield* lock.acquire(identity).pipe(Effect.provideService(Scope.Scope, ownerScope))
					const contender = yield* lock.acquire(identity).pipe(Effect.flip)

					expect(contender._tag).toBe('DaemonInstanceAlreadyRunning')
					expect(contender.lockPath).toBe(owner.lockPath)

					yield* Scope.close(ownerScope, Exit.void)
					const replacement = yield* Effect.scoped(lock.acquire(identity))
					expect(replacement.lockPath).toBe(owner.lockPath)
				}).pipe(Effect.provide(makeTestLayer(homeDirectory)))
			}),
		).pipe(Effect.provide(NodeFileSystem.layer)),
	)
})
