import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { Effect, Fiber, FileSystem, Layer, Path, PlatformError, Queue, Ref } from 'effect'
import { expect } from 'vitest'

import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'

const repository = { repositoryIdentity: 'github.com/acme/repo', remoteUrl: 'https://github.com/acme/repo.git' }
const branchRefs = {
	defaultBranch: 'main',
	workspaceBranch: 'workspace',
	workspaceId: 'test-workspace',
}

describe('managed repository real Git recovery', () => {
	it.effect('recovers a completed attempt while its owner is live without removing the owner directory', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const destination = path.join(fixture.cacheRoot, repository.repositoryIdentity, '.repository')
			const ownerReady = yield* Queue.unbounded<string>()
			const releaseOwner = yield* Queue.unbounded<void>()
			const ownerFs = Layer.succeed(FileSystem.FileSystem, {
				...fs,
				rename: (from, to) =>
					to !== destination
						? fs.rename(from, to)
						: Queue.offer(ownerReady, from).pipe(
								Effect.andThen(Queue.take(releaseOwner)),
								Effect.andThen(fs.rename(from, to)),
							),
			})
			const ownerLayer = Layer.fresh(
				Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(
						Layer.mergeAll(
							ownerFs,
							Layer.succeed(Path.Path, path),
							Layer.succeed(GitCommandRunner, git),
							fixture.config(),
						),
					),
				),
			)
			const prepare = Effect.flatMap(ManagedRepositoryCache, (cache) => cache.prepare(repository))
			const owner = yield* Effect.forkChild(prepare.pipe(Effect.provide(ownerLayer)))
			const checkout = yield* Queue.take(ownerReady)
			yield* fs.remove(fixture.remote, { recursive: true })
			expect(yield* prepare.pipe(Effect.provide(Layer.fresh(fixture.cacheLayer())))).toBe(destination)
			expect(yield* fs.exists(path.dirname(checkout))).toBe(true)
			expect(yield* fs.exists(checkout)).toBe(false)
			yield* Queue.offer(releaseOwner, undefined)
			expect(yield* Fiber.join(owner)).toBe(destination)
			expect(yield* fs.exists(path.dirname(checkout))).toBe(false)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], destination)).stdout.trim()).toBe(fixture.commit)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('retains a completed clone after publication failure and recovers offline in a fresh runtime', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const destination = path.join(fixture.cacheRoot, repository.repositoryIdentity, '.repository')
			const staged = yield* Queue.unbounded<string>()
			const failedPublication = Layer.succeed(FileSystem.FileSystem, {
				...fs,
				rename: (from, to) =>
					to !== destination
						? fs.rename(from, to)
						: Queue.offer(staged, from).pipe(
								Effect.andThen(
									Effect.fail(
										PlatformError.systemError({
											_tag: 'PermissionDenied',
											module: 'FileSystem',
											method: 'rename',
											pathOrDescriptor: to,
											description: 'transient publication failure',
										}),
									),
								),
							),
			})
			const failedLayer = Layer.fresh(
				Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(
						Layer.mergeAll(
							failedPublication,
							Layer.succeed(Path.Path, path),
							Layer.succeed(GitCommandRunner, git),
							fixture.config(),
						),
					),
				),
			)
			const prepare = Effect.flatMap(ManagedRepositoryCache, (cache) => cache.prepare(repository))
			const failure = yield* Effect.flip(prepare.pipe(Effect.provide(failedLayer)))
			expect(failure.message).toContain('completed attempt retained')
			const checkout = yield* Queue.take(staged)
			expect(yield* fs.readFileString(path.join(path.dirname(checkout), 'completed'))).toBe(
				repository.repositoryIdentity,
			)
			expect(yield* fs.exists(destination)).toBe(false)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], checkout)).stdout.trim()).toBe(fixture.commit)
			const active = path.join(fixture.cacheRoot, '.clone-foreign-active')
			yield* fs.makeDirectory(active)
			yield* fs.writeFileString(path.join(active, 'partial'), 'still downloading')
			yield* fs.remove(fixture.remote, { recursive: true })
			expect(yield* prepare.pipe(Effect.provide(Layer.fresh(fixture.cacheLayer())))).toBe(destination)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], destination)).stdout.trim()).toBe(fixture.commit)
			expect(yield* fs.exists(checkout)).toBe(false)
			expect(yield* fs.readFileString(path.join(active, 'partial'))).toBe('still downloading')
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('adopts the final path when the owner publishes while recovery is validating its completed attempt', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const destination = path.join(fixture.cacheRoot, repository.repositoryIdentity, '.repository')
			const ownerReady = yield* Queue.unbounded<string>()
			const releaseOwner = yield* Queue.unbounded<void>()
			const readerReady = yield* Queue.unbounded<void>()
			const releaseReader = yield* Queue.unbounded<void>()
			const ownerFs = Layer.succeed(FileSystem.FileSystem, {
				...fs,
				rename: (from, to) =>
					to !== destination
						? fs.rename(from, to)
						: Queue.offer(ownerReady, from).pipe(
								Effect.andThen(Queue.take(releaseOwner)),
								Effect.andThen(fs.rename(from, to)),
							),
			})
			const ownerLayer = Layer.fresh(
				Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(
						Layer.mergeAll(
							ownerFs,
							Layer.succeed(Path.Path, path),
							Layer.succeed(GitCommandRunner, git),
							fixture.config(),
						),
					),
				),
			)
			const prepare = Effect.flatMap(ManagedRepositoryCache, (cache) => cache.prepare(repository))
			const owner = yield* Effect.forkChild(prepare.pipe(Effect.provide(ownerLayer)))
			const checkout = yield* Queue.take(ownerReady)
			expect(yield* fs.readFileString(path.join(path.dirname(checkout), 'completed'))).toBe(
				repository.repositoryIdentity,
			)
			const readerGit = Layer.succeed(GitCommandRunner, {
				run: (argv, options) =>
					options.cwd === checkout && argv[0] === 'rev-parse'
						? Queue.offer(readerReady, undefined).pipe(
								Effect.andThen(Queue.take(releaseReader)),
								Effect.andThen(git.run(argv, options)),
							)
						: git.run(argv, options),
			})
			const readerLayer = Layer.fresh(
				Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(Layer.mergeAll(readerGit, NodeServices.layer, fixture.config())),
				),
			)
			const reader = yield* Effect.forkChild(prepare.pipe(Effect.provide(readerLayer)))
			yield* Queue.take(readerReady)
			yield* Queue.offer(releaseOwner, undefined)
			expect(yield* Fiber.join(owner)).toBe(destination)
			expect(yield* fs.exists(path.dirname(checkout))).toBe(false)
			yield* Queue.offer(releaseReader, undefined)
			expect(yield* Fiber.join(reader)).toBe(destination)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], destination)).stdout.trim()).toBe(fixture.commit)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('isolates overlapping clone attempts in distinct cache runtimes and adopts the atomic winner', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const destination = path.join(fixture.cacheRoot, repository.repositoryIdentity, '.repository')
			const staged = yield* Queue.unbounded<string>()
			const releaseFirst = yield* Queue.unbounded<void>()
			const releaseSecond = yield* Queue.unbounded<void>()
			const attemptLayer = (owner: string, release: Queue.Queue<void>) =>
				Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(
						Layer.mergeAll(
							NodeServices.layer,
							fixture.config(),
							Layer.succeed(GitCommandRunner, {
								run: (argv, options) =>
									argv[0] !== 'clone'
										? git.run(argv, options)
										: Effect.gen(function* () {
												const checkout = argv.at(-1)
												if (checkout === undefined)
													return yield* Effect.die('Missing clone destination')
												const output = yield* git.run(argv, options)
												yield* fs.writeFileString(
													path.join(checkout, '.git', 'attempt-owner'),
													owner,
												)
												yield* Queue.offer(staged, checkout)
												yield* Queue.take(release)
												return output
											}).pipe(Effect.catchTag('PlatformError', Effect.die)),
							}),
						),
					),
					Layer.fresh,
				)
			const prepare = Effect.flatMap(ManagedRepositoryCache, (cache) => cache.prepare(repository))
			const first = yield* Effect.forkChild(prepare.pipe(Effect.provide(attemptLayer('first', releaseFirst))))
			const firstStaging = yield* Queue.take(staged)
			const second = yield* Effect.forkChild(prepare.pipe(Effect.provide(attemptLayer('second', releaseSecond))))
			const secondStaging = yield* Queue.take(staged)
			expect(firstStaging).not.toBe(secondStaging)
			expect(yield* fs.readFileString(path.join(firstStaging, '.git', 'attempt-owner'))).toBe('first')
			yield* Queue.offer(releaseFirst, undefined)
			expect(yield* Fiber.join(first)).toBe(destination)
			expect(yield* fs.readFileString(path.join(secondStaging, '.git', 'attempt-owner'))).toBe('second')
			yield* Queue.offer(releaseSecond, undefined)
			expect(yield* Fiber.join(second)).toBe(destination)
			expect(yield* fs.readFileString(path.join(destination, '.git', 'attempt-owner'))).toBe('first')
			expect(yield* fs.exists(path.dirname(firstStaging))).toBe(false)
			expect(yield* fs.exists(path.dirname(secondStaging))).toBe(false)
			yield* fs.remove(fixture.remote, { recursive: true })
			const recovered = yield* prepare.pipe(Effect.provide(fixture.cacheLayer()))
			expect(recovered).toBe(destination)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], recovered)).stdout.trim()).toBe(fixture.commit)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('separates hosts and namespaces without removing foreign staging and reuses published clones', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const partial = path.join(fixture.cacheRoot, '.cloning', repository.repositoryIdentity)
			yield* fs.makeDirectory(partial, { recursive: true })
			yield* fs.writeFileString(path.join(partial, 'partial'), 'interrupted clone')
			const first = yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const first = yield* cache.prepare(repository)
				expect(yield* fs.readFileString(path.join(partial, 'partial'))).toBe('interrupted clone')
				const otherHost = yield* cache.prepare({
					repositoryIdentity: 'gitlab.com/acme/repo',
					remoteUrl: 'https://gitlab.com/acme/repo.git',
				})
				const nested = yield* cache.prepare({
					repositoryIdentity: 'gitlab.com/group/nested/repo',
					remoteUrl: 'https://gitlab.com/group/nested/repo.git',
				})
				expect(first).toBe(path.join(fixture.cacheRoot, 'github.com/acme/repo/.repository'))
				expect(otherHost).toBe(path.join(fixture.cacheRoot, 'gitlab.com/acme/repo/.repository'))
				expect(nested).toBe(path.join(fixture.cacheRoot, 'gitlab.com/group/nested/repo/.repository'))
				for (const checkout of [first, otherHost, nested])
					expect((yield* fixture.run(['rev-parse', 'HEAD'], checkout)).stdout.trim()).toBe(fixture.commit)
				return first
			}).pipe(Effect.provide(fixture.cacheLayer()))
			// A published clone survives a lost report and a completely new cache layer.
			yield* fs.remove(fixture.remote, { recursive: true })
			const reused = yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
				cache.prepare({ ...repository, sourcePath: first }),
			).pipe(Effect.provide(fixture.cacheLayer()))
			expect(reused).toBe(first)
			expect((yield* fixture.run(['rev-parse', 'HEAD'], reused)).stdout.trim()).toBe(fixture.commit)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect(
		'refreshes, materializes and publishes from a validated legacy path after reconfiguration and restart',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const legacyPath = path.join(fixture.root, 'old-cache/acme/repo')
				yield* fs.makeDirectory(path.dirname(legacyPath), { recursive: true })
				yield* fixture.run(['clone', '--no-checkout', repository.remoteUrl, legacyPath])
				const newRoot = path.join(fixture.root, 'new-cache')
				const targetPath = path.join(fixture.root, 'workspace')
				yield* Effect.gen(function* () {
					const cache = yield* ManagedRepositoryCache
					expect(yield* cache.prepare({ ...repository, sourcePath: legacyPath })).toBe(legacyPath)
					expect(yield* cache.refresh({ ...repository, ...branchRefs, sourcePath: legacyPath })).toBe(
						legacyPath,
					)
					expect(
						(yield* fixture.run(
							['rev-parse', 'refs/humanlayer/workspaces/test-workspace/base'],
							legacyPath,
						)).stdout.trim(),
					).toBe(fixture.commit)
					yield* cache.materialize({
						...repository,
						sourcePath: legacyPath,
						targetPath,
						branch: 'workspace',
						resolvedCommit: fixture.commit,
					})
				}).pipe(Effect.provide(fixture.cacheLayer(newRoot)))
				yield* Effect.gen(function* () {
					const cache = yield* ManagedRepositoryCache
					yield* cache.materialize({
						...repository,
						sourcePath: legacyPath,
						targetPath,
						branch: 'workspace',
						resolvedCommit: fixture.commit,
					})
					yield* cache.publishBranch({ ...repository, materializationPath: targetPath, branch: 'workspace' })
				}).pipe(Effect.provide(fixture.cacheLayer(newRoot)))
				expect(yield* fs.exists(newRoot)).toBe(false)
				expect(yield* fs.readFileString(path.join(targetPath, 'README.md'))).toBe('fixture\n')
				expect((yield* fixture.run(['rev-parse', 'refs/heads/workspace'], fixture.remote)).stdout.trim()).toBe(
					fixture.commit,
				)
				yield* fixture.run(['remote', 'set-url', 'origin', 'https://gitlab.com/acme/repo.git'], legacyPath)
				const error = yield* Effect.flip(
					Effect.flatMap(ManagedRepositoryCache, (cache) =>
						cache.prepare({ ...repository, sourcePath: legacyPath }),
					).pipe(Effect.provide(fixture.cacheLayer(newRoot))),
				)
				expect(error.message).toContain('does not have the selected remote')
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('serializes equivalent identities while another host performs real Git fetches concurrently', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const git = yield* GitCommandRunner
			const paths = yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				return {
					first: yield* cache.prepare(repository),
					other: yield* cache.prepare({
						repositoryIdentity: 'gitlab.com/acme/repo',
						remoteUrl: 'https://gitlab.com/acme/repo.git',
					}),
				}
			}).pipe(Effect.provide(fixture.cacheLayer()))
			const started = yield* Queue.unbounded<string>()
			const release = yield* Queue.unbounded<void>()
			const active = yield* Ref.make(new Map<string, number>())
			const maximum = yield* Ref.make(new Map<string, number>())
			const runner = Layer.succeed(GitCommandRunner, {
				run: (argv, options) =>
					argv[0] !== 'fetch'
						? git.run(argv, options)
						: Effect.gen(function* () {
								const counts = yield* Ref.updateAndGet(active, (state) =>
									new Map(state).set(options.cwd, (state.get(options.cwd) ?? 0) + 1),
								)
								yield* Ref.update(maximum, (state) =>
									new Map(state).set(
										options.cwd,
										Math.max(state.get(options.cwd) ?? 0, counts.get(options.cwd) ?? 0),
									),
								)
								yield* Queue.offer(started, options.cwd)
								yield* Queue.take(release)
								return yield* git.run(argv, options)
							}).pipe(
								Effect.ensuring(
									Ref.update(active, (state) =>
										new Map(state).set(options.cwd, (state.get(options.cwd) ?? 0) - 1),
									),
								),
							),
			})
			const cacheLayer = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
				Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, fixture.config())),
			)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const first = yield* Effect.forkChild(
					cache.refresh({ ...repository, ...branchRefs, sourcePath: paths.first }),
				)
				expect(yield* Queue.take(started)).toBe(paths.first)
				const equivalent = yield* Effect.forkChild(
					cache.refresh({
						...repository,
						...branchRefs,
						remoteUrl: 'git@github.com:acme/repo.git',
						sourcePath: paths.first,
					}),
				)
				const other = yield* Effect.forkChild(
					cache.refresh({
						repositoryIdentity: 'gitlab.com/acme/repo',
						remoteUrl: 'https://gitlab.com/acme/repo.git',
						...branchRefs,
						sourcePath: paths.other,
					}),
				)
				expect(yield* Queue.take(started)).toBe(paths.other)
				yield* Queue.offerAll(release, [undefined, undefined])
				expect(yield* Queue.take(started)).toBe(paths.first)
				yield* Queue.offer(release, undefined)
				yield* Fiber.join(first)
				yield* Fiber.join(equivalent)
				yield* Fiber.join(other)
			}).pipe(Effect.provide(cacheLayer))
			expect(yield* Ref.get(maximum)).toEqual(
				new Map([
					[paths.first, 1],
					[paths.other, 1],
				]),
			)
			for (const sourcePath of Object.values(paths))
				expect(
					(yield* fixture.run(
						['rev-parse', 'refs/humanlayer/workspaces/test-workspace/base'],
						sourcePath,
					)).stdout.trim(),
				).toBe(fixture.commit)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)
})
