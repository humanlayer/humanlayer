import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { Effect, Fiber, FileSystem, Layer, Logger, Path, Queue, Ref } from 'effect'
import { expect } from 'vitest'

import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'

const repository = { repositoryIdentity: 'github.com/acme/repo', remoteUrl: 'https://github.com/acme/repo.git' }

describe('managed repository safety', () => {
	it.effect('keeps repository prefixes and reserved leaf identities disjoint', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const identities = [
					'git.example/team/repo',
					'git.example/team/repo/subrepo',
					'git.example/team/repo/.repository',
					'git.example/team/repo/~2erepository',
				]
				const paths = yield* Effect.forEach(
					identities,
					(repositoryIdentity) =>
						cache.prepare({ repositoryIdentity, remoteUrl: `https://${repositoryIdentity}.git` }),
					{ concurrency: 4 },
				)
				expect(paths).toEqual(
					[
						'git.example/team/repo/.repository',
						'git.example/team/repo/subrepo/.repository',
						'git.example/team/repo/~2erepository/.repository',
						'git.example/team/repo/~7e2erepository/.repository',
					].map((suffix) => path.join(fixture.cacheRoot, suffix)),
				)
				for (const checkout of paths) {
					expect(
						yield* fs.realPath(
							(yield* fixture.run(['rev-parse', '--show-toplevel'], checkout)).stdout.trim(),
						),
					).toBe(yield* fs.realPath(checkout))
					expect((yield* fixture.run(['rev-parse', 'HEAD'], checkout)).stdout.trim()).toBe(fixture.commit)
				}
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('normalizes cache paths to lowercase while retaining old persisted paths', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const inputs = ['Acme', '~41cme'].map((owner) => ({
					repositoryIdentity: `github.com/${owner}/repo`,
					remoteUrl: `https://github.com/${owner}/repo.git`,
				}))
				const paths = yield* Effect.forEach(inputs, (input) => cache.prepare(input), { concurrency: 2 })
				expect(paths).toEqual(
					['acme', '~7e41cme'].map((owner) =>
						path.join(fixture.cacheRoot, 'github.com', owner, 'repo', '.repository'),
					),
				)
				for (const sourcePath of paths)
					expect((yield* fixture.run(['rev-parse', 'HEAD'], sourcePath)).stdout.trim()).toBe(fixture.commit)
				const oldPath = path.join(fixture.root, 'legacy/Acme/repo')
				yield* fs.makeDirectory(path.dirname(oldPath), { recursive: true })
				yield* fixture.run(['clone', 'https://github.com/Acme/repo.git', oldPath])
				expect(
					yield* cache.prepare({
						repositoryIdentity: 'github.com/Acme/repo',
						remoteUrl: 'https://github.com/Acme/repo.git',
						sourcePath: oldPath,
					}),
				).toBe(oldPath)
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('rejects credential-bearing HTTP URLs before Git or raw error capture', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const calls = yield* Ref.make(0)
			const messages: unknown[] = []
			const runner = Layer.succeed(GitCommandRunner, {
				run: () =>
					Ref.update(calls, (count) => count + 1).pipe(
						Effect.andThen(Effect.die('Credential URL reached Git')),
					),
			})
			const cacheLayer = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
				Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, fixture.config())),
			)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				for (const remoteUrl of [
					'https://username:private-token@github.com/acme/repo.git',
					'http://private-token@github.com/acme/repo.git',
				]) {
					const error = yield* Effect.flip(cache.prepare({ ...repository, remoteUrl }))
					expect(error.message).toContain('must not contain credentials')
					expect(JSON.stringify(error)).not.toContain('private-token')
				}
			}).pipe(
				Effect.provide(cacheLayer),
				Effect.provide(
					Logger.layer([
						Logger.make((entry) => {
							messages.push(entry.message)
						}),
					]),
				),
			)
			expect(yield* Ref.get(calls)).toBe(0)
			expect(JSON.stringify(messages)).not.toContain('private-token')
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('cleans only its interrupted partial attempt and retries with a new directory', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const staged = yield* Queue.unbounded<string>()
			const attempts = yield* Ref.make(0)
			const runner = Layer.succeed(GitCommandRunner, {
				run: (argv, options) =>
					argv[0] !== 'clone'
						? git.run(argv, options)
						: Effect.gen(function* () {
								const checkout = argv.at(-1)
								if (checkout === undefined) return yield* Effect.die('Missing clone target')
								const attempt = yield* Ref.updateAndGet(attempts, (count) => count + 1)
								if (attempt === 1) {
									yield* fs.makeDirectory(checkout)
									yield* fs.writeFileString(path.join(checkout, 'partial'), 'download')
									yield* Queue.offer(staged, checkout)
									return yield* Effect.never
								}
								return yield* git.run(argv, options)
							}).pipe(Effect.catchTag('PlatformError', Effect.die)),
			})
			const cacheLayer = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
				Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, fixture.config())),
			)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const interrupted = yield* Effect.forkChild(cache.prepare(repository))
				const checkout = yield* Queue.take(staged)
				yield* Fiber.interrupt(interrupted)
				expect(yield* fs.exists(path.dirname(checkout))).toBe(false)
				const recovered = yield* cache.prepare(repository)
				expect((yield* fixture.run(['rev-parse', 'HEAD'], recovered)).stdout.trim()).toBe(fixture.commit)
				expect(yield* Ref.get(attempts)).toBe(2)
			}).pipe(Effect.provide(cacheLayer))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect(
		'rejects nested and incomplete worktrees without changing user files and reuses completed worktrees',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				yield* Effect.gen(function* () {
					const cache = yield* ManagedRepositoryCache
					const sourcePath = yield* cache.prepare(repository)
					const targetPath = path.join(fixture.root, 'workspace')
					const input = {
						...repository,
						sourcePath,
						targetPath,
						branch: 'workspace',
						resolvedCommit: fixture.commit,
					}
					yield* fixture.run(
						['worktree', 'add', '--no-checkout', '-b', 'workspace', targetPath, fixture.commit],
						sourcePath,
					)
					yield* fs.writeFileString(path.join(targetPath, 'user-notes'), 'preserve me')
					const incomplete = yield* Effect.flip(cache.materialize(input))
					expect(incomplete.message).toContain('incomplete')
					expect(yield* fs.readFileString(path.join(targetPath, 'user-notes'))).toBe('preserve me')
					expect(yield* fs.exists(path.join(targetPath, 'README.md'))).toBe(false)
					// The test explicitly repairs checkout; production never deletes or resets it.
					yield* fixture.run(['read-tree', 'HEAD'], targetPath)
					yield* fixture.run(['checkout-index', '-a'], targetPath)
					yield* fs.remove(path.join(targetPath, 'user-notes'))
					expect(yield* cache.materialize(input)).toEqual({
						kind: 'worktree',
						path: targetPath,
						branch: 'workspace',
					})
					const nested = path.join(targetPath, 'nested')
					yield* fs.makeDirectory(nested)
					const notRoot = yield* Effect.flip(cache.materialize({ ...input, targetPath: nested }))
					expect(notRoot.message).toContain('not the repository root')
					expect(yield* fs.readFileString(path.join(targetPath, 'README.md'))).toBe('fixture\n')
				}).pipe(Effect.provide(fixture.cacheLayer()))
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)
})
