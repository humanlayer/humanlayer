import * as NodePath from '@effect/platform-node/NodePath'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { describe, it, expect } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import { TestClock } from 'effect/testing'

import {
	LockAlreadyHeldError,
	LockAlreadyReleasedError,
	LockAcquireError,
	LockCheckError,
	LockCompromisedError,
	LockReleaseError,
	ProperLockfile,
	ProperLockfileLive,
} from '../src/index'
import { makeProperLockfileTestLayer } from '../src/proper-lockfile-test.layer'

const Live = ProperLockfileLive.pipe(Layer.provide(NodeServices.layer))
const TestRuntime = Layer.mergeAll(Live, NodeServices.layer)
const lockHolderFixture = new URL('./fixtures/lock-holder.ts', import.meta.url).pathname
const lockStressWorkerFixture = new URL('./fixtures/lock-stress-worker.ts', import.meta.url).pathname

const platformFailure = (method: string) =>
	PlatformError.systemError({
		_tag: 'Unknown',
		module: 'FileSystem',
		method,
		description: 'Injected filesystem failure',
	})

const makeFileSystemOverrideRuntime = (
	override: (base: typeof FileSystem.FileSystem.Service) => Partial<typeof FileSystem.FileSystem.Service>,
) => {
	const FaultFileSystem = Layer.effect(
		FileSystem.FileSystem,
		Effect.gen(function* () {
			const base = yield* FileSystem.FileSystem
			return FileSystem.FileSystem.of({ ...base, ...override(base) })
		}),
	).pipe(Layer.provide(NodeServices.layer))
	const FaultInfrastructure = Layer.mergeAll(FaultFileSystem, NodePath.layer)
	return Layer.mergeAll(ProperLockfileLive.pipe(Layer.provide(FaultInfrastructure)), FaultInfrastructure)
}

const makeRefreshObservedRuntime = (refreshObserved: Deferred.Deferred<void>, mtimeUpdateCount: Ref.Ref<number>) =>
	makeFileSystemOverrideRuntime((base) => ({
		utimes: (path, atime, mtime) =>
			base
				.utimes(path, atime, mtime)
				.pipe(
					Effect.tap(() =>
						Ref.updateAndGet(mtimeUpdateCount, (count) => count + 1).pipe(
							Effect.flatMap((count) =>
								count === 2 ? Deferred.succeed(refreshObserved, undefined) : Effect.void,
							),
						),
					),
				),
	}))

const withTemporaryTarget = <A, E, R>(
	use: (input: { readonly targetPath: string; readonly lockPath: string }) => Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'effect-proper-lockfile-' })
			const directory = yield* fileSystem.realPath(temporaryDirectory)
			const targetPath = pathService.join(directory, 'resource')
			const lockPath = pathService.join(directory, 'resource.lock')
			yield* fileSystem.writeFileString(targetPath, '')
			return yield* use({ targetPath, lockPath })
		}),
	)

describe('ProperLockfileLive', () => {
	it.effect('probes mtime at the sampled time rounded up to seconds plus five milliseconds', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				yield* TestClock.setTime(10_987)
				yield* Effect.scoped(
					Effect.gen(function* () {
						yield* properLockfile.acquire({ path: targetPath })
						const stat = yield* fileSystem.stat(lockPath)
						expect(Option.getOrThrow(stat.mtime).getTime()).toBe(11_005)
					}),
				)
				expect(yield* fileSystem.exists(lockPath)).toBe(false)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('requires the target to exist when realPath is enabled', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'effect-proper-lockfile-' })
				const missingPath = pathService.join(directory, 'missing')
				const error = yield* properLockfile.acquire({ path: missingPath }).pipe(Effect.flip)
				expect(error._tag).toBe('LockAcquireError')
			}).pipe(Effect.provide(TestRuntime)),
		),
	)

	it.effect('locks a missing target when realPath is disabled', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'effect-proper-lockfile-' })
				const missingPath = pathService.join(directory, 'missing')
				const lease = yield* properLockfile.acquire({ path: missingPath, realPath: false })
				expect(yield* fileSystem.exists(lease.lockPath)).toBe(true)
			}).pipe(Effect.provide(TestRuntime)),
		),
	)

	it.effect('fails when the custom lock parent does not exist', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const error = yield* properLockfile
					.acquire({ path: targetPath, lockPath: `${lockPath}/missing/lock` })
					.pipe(Effect.flip)
				expect(error._tag).toBe('LockAcquireError')
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('holds a lock until its scope closes', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				expect(yield* properLockfile.check({ path: targetPath })).toBe(false)

				yield* Effect.scoped(
					Effect.gen(function* () {
						const lease = yield* properLockfile.acquire({ path: targetPath })
						expect(lease.lockPath).toBe(`${lease.path}.lock`)
						expect(yield* properLockfile.check({ path: targetPath })).toBe(true)
						expect(yield* fileSystem.exists(lease.lockPath)).toBe(true)
					}),
				)

				expect(yield* properLockfile.check({ path: targetPath })).toBe(false)
				expect(yield* fileSystem.exists(lockPath)).toBe(false)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('uses a custom lock path inside the target directory', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'effect-proper-lockfile-' })
				const canonicalDirectory = yield* fileSystem.realPath(directory)
				const lockPath = pathService.join(canonicalDirectory, 'dir.lock')
				const lease = yield* properLockfile.acquire({ path: canonicalDirectory, lockPath })
				expect(lease.lockPath).toBe(lockPath)
				expect(yield* fileSystem.exists(lockPath)).toBe(true)
			}).pipe(Effect.provide(TestRuntime)),
		),
	)

	it.effect('rejects a concurrent owner', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				yield* properLockfile.acquire({ path: targetPath })
				const error = yield* properLockfile.acquire({ path: targetPath }).pipe(Effect.flip)
				expect(error).toBeInstanceOf(LockAlreadyHeldError)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('resolves symlinks by default', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const aliasPath = `${targetPath}-alias`
					yield* fileSystem.symlink(targetPath, aliasPath)
					yield* properLockfile.acquire({ path: aliasPath })
					const error = yield* properLockfile.acquire({ path: targetPath }).pipe(Effect.flip)
					expect(error).toBeInstanceOf(LockAlreadyHeldError)
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('keeps symlink and target locks separate when realPath is disabled', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const aliasPath = `${targetPath}-alias`
					yield* fileSystem.symlink(targetPath, aliasPath)
					const aliasLease = yield* properLockfile.acquire({ path: aliasPath, realPath: false })
					const targetLease = yield* properLockfile.acquire({ path: targetPath, realPath: false })
					expect(aliasLease.lockPath).not.toBe(targetLease.lockPath)
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('keeps a newer lock when an older owner scope closes', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const ownerScope = yield* Scope.make()
				const firstLease = yield* properLockfile
					.acquire({ path: targetPath })
					.pipe(Effect.provideService(Scope.Scope, ownerScope))
				yield* fileSystem.remove(lockPath, { recursive: true })
				yield* fileSystem.makeDirectory(lockPath)
				yield* fileSystem.writeFileString(
					pathService.join(lockPath, 'owner.json'),
					JSON.stringify({ ownerId: 'new-owner', acquiredAt: 1 }),
				)
				yield* Scope.close(ownerScope, Exit.void)
				expect(firstLease.ownerId).not.toBe('new-owner')
				expect(yield* fileSystem.exists(lockPath)).toBe(true)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('retries lock contention with the Effect clock', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const firstOwnerScope = yield* Scope.make()
				yield* properLockfile
					.acquire({ path: targetPath })
					.pipe(Effect.provideService(Scope.Scope, firstOwnerScope))
				const contender = yield* properLockfile
					.acquire({
						path: targetPath,
						retries: { retries: 2, factor: 1, minTimeout: '1 second', maxTimeout: '1 second' },
					})
					.pipe(Effect.forkChild)
				yield* TestClock.adjust('1 second')
				yield* Scope.close(firstOwnerScope, Exit.void)
				yield* TestClock.adjust('1 second')
				const lease = yield* Fiber.join(contender)
				expect(lease.path).toBe(targetPath)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('reclaims a stale lock directory', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				yield* TestClock.setTime(10_000)
				yield* fileSystem.makeDirectory(lockPath)
				yield* fileSystem.writeFileString(
					pathService.join(lockPath, 'owner.json'),
					JSON.stringify({ ownerId: 'stale-owner', acquiredAt: 0 }),
				)
				const staleTime = DateTime.toDateUtc(DateTime.makeUnsafe(0))
				yield* fileSystem.utimes(lockPath, staleTime, staleTime)

				yield* Effect.scoped(
					Effect.gen(function* () {
						const lease = yield* properLockfile.acquire({ path: targetPath, stale: '2 seconds' })
						expect(lease.ownerId).not.toBe('stale-owner')
						expect(yield* properLockfile.check({ path: targetPath, stale: '2 seconds' })).toBe(true)
					}),
				)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	for (const ownerState of ['missing', 'malformed'] as const) {
		it.effect(`reclaims a stale lock with ${ownerState} owner data`, () =>
			withTemporaryTarget(({ targetPath, lockPath }) =>
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					yield* TestClock.setTime(10_000)
					yield* fileSystem.makeDirectory(lockPath)
					if (ownerState === 'malformed')
						yield* fileSystem.writeFileString(`${lockPath}/owner.json`, '{invalid')
					const staleTime = DateTime.toDateUtc(DateTime.makeUnsafe(0))
					yield* fileSystem.utimes(lockPath, staleTime, staleTime)

					yield* Effect.scoped(properLockfile.acquire({ path: targetPath, stale: '2 seconds' }))
					expect(yield* fileSystem.exists(lockPath)).toBe(false)
				}),
			).pipe(Effect.provide(TestRuntime)),
		)
	}

	it.effect('clamps the update interval to one second', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const pathService = yield* Path.Path
					yield* TestClock.setTime(10_000)
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						updateInterval: 100,
					})
					yield* fileSystem.writeFileString(
						pathService.join(lease.lockPath, 'owner.json'),
						JSON.stringify({ ownerId: 'replacement-owner', acquiredAt: 1 }),
					)
					const compromiseFiber = yield* lease.failWhenLockOwnershipIsCompromised.pipe(
						Effect.flip,
						Effect.forkChild,
					)
					yield* TestClock.adjust(999)
					expect(compromiseFiber.pollUnsafe()).toBeUndefined()
					yield* TestClock.adjust(1)
					expect((yield* Fiber.join(compromiseFiber)).reason).toBe('owner-changed')
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('clamps update interval to half the stale interval', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const pathService = yield* Path.Path
					yield* TestClock.setTime(10_000)
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						stale: '5 seconds',
						updateInterval: '6 seconds',
					})
					yield* fileSystem.writeFileString(
						pathService.join(lease.lockPath, 'owner.json'),
						JSON.stringify({ ownerId: 'replacement-owner', acquiredAt: 1 }),
					)
					const compromiseFiber = yield* lease.failWhenLockOwnershipIsCompromised.pipe(
						Effect.flip,
						Effect.forkChild,
					)
					yield* TestClock.adjust('2499 millis')
					expect(compromiseFiber.pollUnsafe()).toBeUndefined()
					yield* TestClock.adjust('1 milli')
					expect((yield* Fiber.join(compromiseFiber)).reason).toBe('owner-changed')
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.live(
		'refreshes the lock directory mtime',
		() =>
			Effect.gen(function* () {
				const refreshObserved = yield* Deferred.make<void>()
				const mtimeUpdateCount = yield* Ref.make(0)
				yield* withTemporaryTarget(({ targetPath }) =>
					Effect.scoped(
						Effect.gen(function* () {
							const properLockfile = yield* ProperLockfile
							const fileSystem = yield* FileSystem.FileSystem
							const lease = yield* properLockfile.acquire({
								path: targetPath,
								updateInterval: '1 second',
							})
							const initial = yield* fileSystem.stat(lease.lockPath)
							yield* Deferred.await(refreshObserved)
							const refreshed = yield* fileSystem.stat(lease.lockPath)
							expect(refreshed.mtime).not.toEqual(initial.mtime)
						}),
					),
				).pipe(Effect.provide(makeRefreshObservedRuntime(refreshObserved, mtimeUpdateCount)))
			}),
		15_000,
	)

	it.live(
		'keeps refreshing after the acquisition fiber completes',
		() =>
			Effect.gen(function* () {
				const refreshObserved = yield* Deferred.make<void>()
				const mtimeUpdateCount = yield* Ref.make(0)
				yield* withTemporaryTarget(({ targetPath }) =>
					Effect.gen(function* () {
						const properLockfile = yield* ProperLockfile
						const fileSystem = yield* FileSystem.FileSystem
						const leaseScope = yield* Scope.make()
						const acquisition = yield* properLockfile
							.acquire({ path: targetPath, updateInterval: '1 second' })
							.pipe(Effect.provideService(Scope.Scope, leaseScope), Effect.forkChild)
						const lease = yield* Fiber.join(acquisition)
						const initial = yield* fileSystem.stat(lease.lockPath)
						yield* Deferred.await(refreshObserved)
						const refreshed = yield* fileSystem.stat(lease.lockPath)
						expect(refreshed.mtime).not.toEqual(initial.mtime)
						yield* Scope.close(leaseScope, Exit.void)
					}),
				).pipe(Effect.provide(makeRefreshObservedRuntime(refreshObserved, mtimeUpdateCount)))
			}),
		15_000,
	)

	it.effect('clamps stale duration to two seconds', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				yield* TestClock.setTime(10_000)
				yield* fileSystem.makeDirectory(lockPath)
				const modifiedAt = DateTime.toDateUtc(DateTime.makeUnsafe(9_000))
				yield* fileSystem.utimes(lockPath, modifiedAt, modifiedAt)
				expect(yield* properLockfile.check({ path: targetPath, stale: 100 })).toBe(true)
				yield* TestClock.adjust(1_001)
				expect(yield* properLockfile.check({ path: targetPath, stale: 100 })).toBe(false)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('reports when another owner replaces the lock', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const pathService = yield* Path.Path
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						stale: '2 seconds',
						updateInterval: '1 second',
					})
					yield* fileSystem.writeFileString(
						pathService.join(lease.lockPath, 'owner.json'),
						JSON.stringify({ ownerId: 'replacement-owner', acquiredAt: 1 }),
					)
					const compromiseFiber = yield* lease.failWhenLockOwnershipIsCompromised.pipe(
						Effect.flip,
						Effect.forkChild,
					)
					yield* TestClock.adjust('1 second')
					const error = yield* Fiber.join(compromiseFiber)
					expect(error).toBeInstanceOf(LockCompromisedError)
					expect(error.reason).toBe('owner-changed')
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('reports when the lock disappears during refresh', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						stale: '2 seconds',
						updateInterval: '1 second',
					})
					yield* fileSystem.remove(lease.lockPath, { recursive: true })
					const compromise = yield* lease.failWhenLockOwnershipIsCompromised.pipe(
						Effect.flip,
						Effect.forkChild,
					)
					yield* TestClock.adjust('1 second')
					expect((yield* Fiber.join(compromise)).reason).toBe('lock-missing')
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('reports refresh failures that last through the stale deadline', () => {
		let failRefresh = false
		return withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					yield* TestClock.setTime(10_000)
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						stale: '2 seconds',
						updateInterval: '1 second',
					})
					failRefresh = true
					const compromise = yield* lease.failWhenLockOwnershipIsCompromised.pipe(
						Effect.flip,
						Effect.forkChild,
					)
					yield* TestClock.adjust('2 seconds')
					expect((yield* Fiber.join(compromise)).reason).toBe('refresh-overdue')
				}),
			),
		).pipe(
			Effect.provide(
				makeFileSystemOverrideRuntime((base) => ({
					utimes: (path, atime, mtime) =>
						failRefresh ? Effect.fail(platformFailure('utimes')) : base.utimes(path, atime, mtime),
				})),
			),
		)
	})

	it.effect('withLock releases after success and failure', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				expect(yield* properLockfile.withLock({ path: targetPath }, Effect.succeed('done'))).toBe('done')
				expect(yield* properLockfile.check({ path: targetPath })).toBe(false)
				const failure = yield* properLockfile
					.withLock({ path: targetPath }, Effect.fail('expected' as const))
					.pipe(Effect.flip)
				expect(failure).toBe('expected')
				expect(yield* properLockfile.check({ path: targetPath })).toBe(false)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('withLock interrupts its body when ownership is compromised', () =>
		withTemporaryTarget(({ targetPath, lockPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const bodyStarted = yield* Deferred.make<void>()
				const bodyInterrupted = yield* Deferred.make<void>()
				const body = Deferred.succeed(bodyStarted, undefined).pipe(
					Effect.andThen(Effect.never),
					Effect.ensuring(Deferred.succeed(bodyInterrupted, undefined)),
				)
				const fiber = yield* properLockfile
					.withLock(
						{
							path: targetPath,
							stale: '2 seconds',
							updateInterval: '1 second',
						},
						body,
					)
					.pipe(Effect.flip, Effect.forkChild)
				yield* Deferred.await(bodyStarted)
				yield* fileSystem.writeFileString(
					`${lockPath}/owner.json`,
					JSON.stringify({ ownerId: 'replacement-owner', acquiredAt: 1 }),
				)
				yield* TestClock.adjust('1 second')
				const error = yield* Fiber.join(fiber)
				expect(error).toBeInstanceOf(LockCompromisedError)
				if (error instanceof LockCompromisedError) expect(error.reason).toBe('owner-changed')
				yield* Deferred.await(bodyInterrupted)
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('rejects non-finite timing and retry options at the service boundary', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				for (const options of [
					{ stale: Number.POSITIVE_INFINITY },
					{ updateInterval: Number.NaN },
					{ retries: Number.POSITIVE_INFINITY },
					{ retries: { retries: 1, factor: Number.NaN } },
					{ realPath: 'false' as unknown as boolean },
					{ retries: { retries: 1, randomize: 'false' as unknown as boolean } },
					{ ownerMetadata: { nested: {} as unknown as string } },
				] as const) {
					const error = yield* properLockfile.acquire({ path: targetPath, ...options }).pipe(Effect.flip)
					expect(error).toBeInstanceOf(LockAcquireError)
				}
			}),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('writes safe owner metadata without allowing core field overrides', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const fileSystem = yield* FileSystem.FileSystem
					const lease = yield* properLockfile.acquire({
						path: targetPath,
						ownerMetadata: {
							ownerId: 'spoofed',
							acquiredAt: 0,
							pid: 42,
							daemon: true,
							note: null,
						},
					})
					const owner = JSON.parse(yield* fileSystem.readFileString(`${lease.lockPath}/owner.json`))
					expect(owner).toMatchObject({
						ownerId: lease.ownerId,
						acquiredAt: lease.acquiredAt,
						pid: 42,
						daemon: true,
						note: null,
					})
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('supports explicit early release and rejects a second release', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const lease = yield* properLockfile.acquire({ path: targetPath })
					yield* lease.release
					expect(yield* properLockfile.check({ path: targetPath })).toBe(false)
					const error = yield* lease.release.pipe(Effect.flip)
					expect(error).toBeInstanceOf(LockAlreadyReleasedError)
					yield* Effect.scoped(properLockfile.acquire({ path: targetPath }))
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.effect('check handles missing targets according to realPath', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const fileSystem = yield* FileSystem.FileSystem
				const pathService = yield* Path.Path
				const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'effect-proper-lockfile-' })
				const missingPath = pathService.join(directory, 'missing')
				const error = yield* properLockfile.check({ path: missingPath }).pipe(Effect.flip)
				expect(error._tag).toBe('LockCheckError')
				expect(yield* properLockfile.check({ path: missingPath, realPath: false })).toBe(false)
			}).pipe(Effect.provide(TestRuntime)),
		),
	)

	it.effect('maps filesystem path failures at the service boundary', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.gen(function* () {
				const properLockfile = yield* ProperLockfile
				const acquireError = yield* properLockfile.acquire({ path: targetPath }).pipe(Effect.flip)
				expect(acquireError).toBeInstanceOf(LockAcquireError)
				const checkError = yield* properLockfile.check({ path: targetPath }).pipe(Effect.flip)
				expect(checkError).toBeInstanceOf(LockCheckError)
			}).pipe(
				Effect.provide(
					makeFileSystemOverrideRuntime(() => ({
						realPath: () => Effect.fail(platformFailure('realPath')),
					})),
				),
			),
		).pipe(Effect.provide(NodeServices.layer)),
	)

	it.effect('reports an explicit release failure', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const lease = yield* properLockfile.acquire({ path: targetPath })
					const error = yield* lease.release.pipe(Effect.flip)
					expect(error).toBeInstanceOf(LockReleaseError)
				}),
			),
		).pipe(
			Effect.provide(
				makeFileSystemOverrideRuntime((base) => ({
					remove: (path, options) =>
						path.includes('.lock.release.')
							? Effect.fail(platformFailure('remove'))
							: base.remove(path, options),
				})),
			),
		),
	)

	it.effect('allows explicit release to retry after cleanup fails', () => {
		let failures = 1
		return withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const lease = yield* properLockfile.acquire({ path: targetPath })
					expect(yield* lease.release.pipe(Effect.flip)).toBeInstanceOf(LockReleaseError)
					expect(yield* properLockfile.check({ path: targetPath })).toBe(true)
					yield* lease.release
				}),
			),
		).pipe(
			Effect.provide(
				makeFileSystemOverrideRuntime((base) => ({
					remove: (path, options) =>
						path.includes('.lock.release.') && failures-- > 0
							? Effect.fail(platformFailure('remove'))
							: base.remove(path, options),
				})),
			),
		)
	})
})

describe('ProperLockfile test layer', () => {
	it.effect('models held and released locks', () =>
		Effect.gen(function* () {
			const properLockfile = yield* ProperLockfile
			expect(yield* properLockfile.check({ path: '/resource' })).toBe(false)
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* properLockfile.acquire({ path: '/resource' })
					expect(yield* properLockfile.check({ path: '/resource' })).toBe(true)
				}),
			)
			expect(yield* properLockfile.check({ path: '/resource' })).toBe(false)
		}).pipe(Effect.provide(Layer.mergeAll(makeProperLockfileTestLayer(), NodeServices.layer))),
	)
})

describe('cross-process parity', () => {
	it.live('releases the lock on graceful process shutdown', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const properLockfile = yield* ProperLockfile
					const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
					const handle = yield* spawner.spawn(
						ChildProcess.make('bun', [lockHolderFixture, targetPath], {
							stdin: 'ignore',
							stdout: 'pipe',
							stderr: 'pipe',
						}),
					)
					const ready = yield* handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead)
					expect(Option.getOrThrow(ready)).toBe('LOCK_READY')
					expect(yield* properLockfile.check({ path: targetPath, stale: '2 seconds' })).toBe(true)
					yield* handle.kill({ killSignal: 'SIGTERM' })
					expect(yield* properLockfile.check({ path: targetPath, stale: '2 seconds' })).toBe(false)
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)

	it.live(
		'recovers a stale lock after SIGKILL',
		() =>
			withTemporaryTarget(({ targetPath }) =>
				Effect.scoped(
					Effect.gen(function* () {
						const properLockfile = yield* ProperLockfile
						const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
						const handle = yield* spawner.spawn(
							ChildProcess.make('bun', [lockHolderFixture, targetPath], {
								stdin: 'ignore',
								stdout: 'pipe',
								stderr: 'pipe',
							}),
						)
						yield* handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead)
						yield* handle.kill({ killSignal: 'SIGKILL' })
						expect(yield* properLockfile.check({ path: targetPath, stale: '2 seconds' })).toBe(true)
						yield* Effect.sleep('3200 millis')
						yield* Effect.scoped(properLockfile.acquire({ path: targetPath, stale: '2 seconds' }))
						expect(yield* properLockfile.check({ path: targetPath, stale: '2 seconds' })).toBe(false)
					}),
				),
			).pipe(Effect.provide(TestRuntime)),
		15_000,
	)

	it.live('keeps the protected section exclusive under process contention', () =>
		withTemporaryTarget(({ targetPath }) =>
			Effect.scoped(
				Effect.gen(function* () {
					const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
					const guardPath = `${targetPath}.guard`
					const handles = yield* Effect.forEach(
						Array.from({ length: 6 }),
						() =>
							spawner.spawn(
								ChildProcess.make('bun', [lockStressWorkerFixture, targetPath, guardPath, '25'], {
									stdin: 'ignore',
									stdout: 'pipe',
									stderr: 'pipe',
								}),
							),
						{ concurrency: 6 },
					)
					const results = yield* Effect.forEach(
						handles,
						(handle) =>
							Effect.all(
								{
									exitCode: handle.exitCode,
									stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
									stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
								},
								{ concurrency: 'unbounded' },
							),
						{ concurrency: 6 },
					)
					for (const result of results) {
						expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
					}
				}),
			),
		).pipe(Effect.provide(TestRuntime)),
	)
})
