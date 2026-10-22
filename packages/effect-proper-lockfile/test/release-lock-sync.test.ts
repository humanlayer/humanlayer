import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'

import { ProperLockfile, ProperLockfileLive, releaseLockSync } from '../src/index'

const TestRuntime = Layer.mergeAll(ProperLockfileLive.pipe(Layer.provide(NodeServices.layer)), NodeServices.layer)

const withHeldLock = <A, E, R>(
	use: (input: {
		readonly lockPath: string
		readonly ownerId: string
		readonly directory: string
	}) => Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'release-lock-sync-' })
			const targetPath = pathService.join(directory, 'target')
			yield* fileSystem.writeFileString(targetPath, 'target')
			const properLockfile = yield* ProperLockfile
			const lease = yield* properLockfile.acquire({ path: targetPath })
			return yield* use({ lockPath: lease.lockPath, ownerId: lease.ownerId, directory })
		}),
	).pipe(Effect.provide(TestRuntime))

describe('releaseLockSync', () => {
	it.live('removes a lock directory the owner still holds and leaves no quarantine behind', () =>
		withHeldLock(({ lockPath, ownerId, directory }) =>
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				releaseLockSync({ lockPath, ownerId })
				expect(yield* fileSystem.exists(lockPath)).toBe(false)
				expect(yield* fileSystem.readDirectory(directory)).toEqual(['target'])
			}),
		),
	)

	it.live('keeps a lock directory that another owner holds', () =>
		withHeldLock(({ lockPath, directory }) =>
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				releaseLockSync({ lockPath, ownerId: 'another-owner' })
				expect(yield* fileSystem.exists(lockPath)).toBe(true)
				expect((yield* fileSystem.readDirectory(directory)).toSorted()).toEqual(['target', 'target.lock'])
			}),
		),
	)

	it.live('does nothing when the lock directory is already gone', () =>
		withHeldLock(({ lockPath, ownerId }) =>
			Effect.gen(function* () {
				const fileSystem = yield* FileSystem.FileSystem
				yield* fileSystem.remove(lockPath, { recursive: true })
				expect(() => releaseLockSync({ lockPath, ownerId })).not.toThrow()
				expect(yield* fileSystem.exists(lockPath)).toBe(false)
			}),
		),
	)
})
