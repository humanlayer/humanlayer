import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Fiber, FileSystem, Layer, Option, Path, Queue, Ref } from 'effect'
import { expect } from 'vitest'

import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandFailedError } from '@/effects/services/task-diff/errors'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'

describe('ManagedRepositoryCache', () => {
	it.effect('creates, refreshes, and reuses the full-identity cache path for equivalent URLs', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const identity = 'github.com/acme/repo'
				const [firstPath, equivalentPath] = yield* Effect.all(
					[
						cache.prepare({
							repositoryIdentity: identity,
							remoteUrl: 'git@github.com:acme/repo.git',
						}),
						cache.prepare({
							repositoryIdentity: identity,
							remoteUrl: 'https://github.com/acme/repo.git',
						}),
					],
					{ concurrency: 'unbounded' },
				)
				expect(firstPath).toBe(path.join(fixture.cacheRoot, 'github.com', 'acme', 'repo', '.repository'))
				expect(equivalentPath).toBe(firstPath)
				expect((yield* fixture.run(['rev-parse', '--is-bare-repository'], firstPath)).stdout.trim()).toBe(
					'false',
				)

				yield* fs.writeFileString(path.join(fixture.source, 'README.md'), 'second\n')
				yield* fixture.run(['add', 'README.md'], fixture.source)
				yield* fixture.run(['commit', '-m', 'second'], fixture.source)
				yield* fixture.run(['push', 'origin', 'main'], fixture.source)
				const secondPath = yield* cache.refresh({
					sourcePath: firstPath,
					repositoryIdentity: identity,
					remoteUrl: 'https://github.com/acme/repo.git',
					defaultBranch: 'main',
					workspaceBranch: 'workspace-test',
					workspaceId: 'test-workspace',
				})
				expect(secondPath).toBe(firstPath)
				const [sourceHead, cachedHead] = yield* Effect.all([
					fixture.run(['rev-parse', 'HEAD'], fixture.source),
					fixture.run(['rev-parse', 'refs/humanlayer/workspaces/test-workspace/base'], firstPath),
				])
				expect(cachedHead.stdout.trim()).toBe(sourceHead.stdout.trim())
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('rejects an existing checkout with another identity', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const checkout = path.join(fixture.cacheRoot, 'github.com', 'acme', 'repo', '.repository')
			yield* fixture.run(['init', '--initial-branch=main', checkout])
			yield* fixture.run(['remote', 'add', 'origin', 'git@github.com:other/repo.git'], checkout)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const error = yield* Effect.flip(
					cache.prepare({
						repositoryIdentity: 'github.com/acme/repo',
						remoteUrl: 'git@github.com:acme/repo.git',
					}),
				)
				expect(error.message).toContain('does not have the selected remote')
			}).pipe(Effect.provide(fixture.cacheLayer()))
			expect(yield* fs.exists(checkout)).toBe(true)
			expect((yield* fixture.run(['config', '--get', 'remote.origin.url'], checkout)).stdout.trim()).toBe(
				'git@github.com:other/repo.git',
			)
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('disables interactive credentials and returns a typed clone failure', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped({ prefix: 'managed-repository-auth-' })
			const home = path.join(root, 'home')
			const cacheRoot = path.join(root, 'cache')
			yield* fs.makeDirectory(home)
			const environments = yield* Ref.make<ReadonlyArray<Readonly<Record<string, string>>>>([])
			const runner = Layer.succeed(GitCommandRunner, {
				run: (argv, options) =>
					Ref.update(environments, (seen) => [...seen, options.env ?? {}]).pipe(
						Effect.andThen(
							Effect.fail(
								new GitCommandFailedError({
									message: 'credentials unavailable',
									argv,
									exitCode: 128,
									stderr: 'terminal prompts disabled',
								}),
							),
						),
					),
			})
			const config = ConfigProvider.layer(
				ConfigProvider.fromUnknown({ HOME: home, RIPTIDE_MANAGED_REPOSITORY_ROOT: cacheRoot }),
			)
			const cacheLayer = Layer.mergeAll(
				ManagedRepositoryCacheLive,
				RepositorySourceContextLive,
				GitRunnerConfigurationLive,
			).pipe(Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, config)))
			const error = yield* Effect.flip(
				Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.prepare({
						repositoryIdentity: 'github.com/acme/private',
						remoteUrl: 'git@github.com:acme/private.git',
					}),
				).pipe(Effect.provide(cacheLayer)),
			)
			expect(error).toMatchObject({
				command: 'git clone',
				exitCode: 128,
				stderr: 'terminal prompts disabled',
			})
			expect(yield* Ref.get(environments)).toContainEqual(
				expect.objectContaining({
					GIT_TERMINAL_PROMPT: '0',
					GCM_INTERACTIVE: 'never',
					SSH_ASKPASS_REQUIRE: 'never',
				}),
			)
			expect((yield* fs.readDirectory(cacheRoot)).filter((entry) => entry.startsWith('.clone-'))).toEqual([])
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	)

	it.effect('releases the repository permit when a Git process is interrupted', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped({ prefix: 'managed-repository-interrupt-' })
			const cacheRoot = path.join(root, 'cache')
			yield* fs.makeDirectory(path.join(cacheRoot, 'github.com', 'acme', 'repo', '.repository'), {
				recursive: true,
			})
			const fetchStarted = yield* Queue.unbounded<number>()
			const attempts = yield* Ref.make(0)
			const runner = Layer.succeed(GitCommandRunner, {
				run: (argv, { cwd }) => {
					const command = argv.join(' ')
					if (command === 'remote') return Effect.succeed({ stdout: 'origin\n', stderr: '', exitCode: 0 })
					if (argv[0] === 'config') {
						return Effect.succeed({
							stdout: 'git@github.com:acme/repo.git\n',
							stderr: '',
							exitCode: 0,
						})
					}
					if (argv[0] === 'fetch') {
						return Effect.gen(function* () {
							const attempt = yield* Ref.updateAndGet(attempts, (value) => value + 1)
							yield* Queue.offer(fetchStarted, attempt)
							if (attempt === 1) return yield* Effect.never
							return { stdout: '', stderr: '', exitCode: 0 }
						})
					}
					return Effect.succeed({
						stdout:
							command === 'rev-parse --show-toplevel'
								? cwd
								: command.startsWith('ls-remote')
									? ''
									: 'true\n',
						stderr: '',
						exitCode: command.startsWith('ls-remote') ? 2 : 0,
					})
				},
			})
			const config = ConfigProvider.layer(
				ConfigProvider.fromUnknown({ HOME: root, RIPTIDE_MANAGED_REPOSITORY_ROOT: cacheRoot }),
			)
			const cacheLayer = Layer.mergeAll(
				ManagedRepositoryCacheLive,
				RepositorySourceContextLive,
				GitRunnerConfigurationLive,
			).pipe(Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, config)))
			const refresh = Effect.flatMap(ManagedRepositoryCache, (cache) =>
				cache.refresh({
					sourcePath: path.join(cacheRoot, 'github.com', 'acme', 'repo', '.repository'),
					repositoryIdentity: 'github.com/acme/repo',
					remoteUrl: 'git@github.com:acme/repo.git',
					defaultBranch: 'main',
					workspaceBranch: 'workspace',
					workspaceId: 'test-workspace',
				}),
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const interrupted = yield* Effect.forkChild(refresh)
					expect(yield* Queue.take(fetchStarted)).toBe(1)
					yield* Fiber.interrupt(interrupted)
					const retry = yield* Effect.forkChild(refresh)
					expect(yield* Queue.take(fetchStarted)).toBe(2)
					yield* Fiber.join(retry)
				}),
			).pipe(Effect.provide(cacheLayer))
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	)

	it.effect('serializes equivalent identities while unrelated repositories refresh concurrently', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped({ prefix: 'managed-repository-locks-' })
			const cacheRoot = path.join(root, 'cache')
			yield* fs.makeDirectory(path.join(cacheRoot, 'github.com', 'acme', 'repo', '.repository'), {
				recursive: true,
			})
			yield* fs.makeDirectory(path.join(cacheRoot, 'github.com', 'other', 'repo', '.repository'), {
				recursive: true,
			})
			const started = yield* Queue.unbounded<string>()
			const release = yield* Queue.unbounded<void>()
			const active = yield* Ref.make({ current: 0, maximum: 0 })
			const runner = Layer.succeed(GitCommandRunner, {
				run: (argv, { cwd }) => {
					const command = argv.join(' ')
					if (command === 'remote') return Effect.succeed({ stdout: 'origin\n', stderr: '', exitCode: 0 })
					if (argv[0] === 'config') {
						const owner = cwd.includes('/other/') ? 'other' : 'acme'
						return Effect.succeed({
							stdout: `git@github.com:${owner}/repo.git\n`,
							stderr: '',
							exitCode: 0,
						})
					}
					if (argv[0] === 'fetch' || command === 'worktree prune') {
						return Effect.gen(function* () {
							yield* Ref.update(active, ({ current, maximum }) => ({
								current: current + 1,
								maximum: Math.max(maximum, current + 1),
							}))
							yield* Queue.offer(started, cwd)
							yield* Queue.take(release)
							yield* Ref.update(active, (state) => ({ ...state, current: state.current - 1 }))
							return { stdout: '', stderr: '', exitCode: 0 }
						})
					}
					if (argv[0] === 'status') return Effect.succeed({ stdout: '', stderr: '', exitCode: 0 })
					if (argv[0] === 'worktree' && argv[1] === 'add')
						return fs
							.makeDirectory(path.join(root, 'workspace'), { recursive: true })
							.pipe(Effect.orDie, Effect.as({ stdout: '', stderr: '', exitCode: 0 }))
					return Effect.succeed({
						stdout:
							command === 'rev-parse --show-toplevel'
								? cwd
								: command.startsWith('ls-remote')
									? ''
									: 'true\n',
						stderr: '',
						exitCode: command.startsWith('ls-remote') ? 2 : command.startsWith('show-ref') ? 1 : 0,
					})
				},
			})
			const config = ConfigProvider.layer(
				ConfigProvider.fromUnknown({ HOME: root, RIPTIDE_MANAGED_REPOSITORY_ROOT: cacheRoot }),
			)
			const cacheLayer = Layer.mergeAll(
				ManagedRepositoryCacheLive,
				RepositorySourceContextLive,
				GitRunnerConfigurationLive,
			).pipe(Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, config)))
			const refresh = (repositoryIdentity: string, remoteUrl: string) =>
				Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.refresh({
						sourcePath: path.join(cacheRoot, ...repositoryIdentity.split('/'), '.repository'),
						repositoryIdentity,
						remoteUrl,
						defaultBranch: 'main',
						workspaceBranch: 'workspace',
						workspaceId: 'test-workspace',
					}),
				)
			const materialize = Effect.flatMap(ManagedRepositoryCache, (cache) =>
				cache.materialize({
					repositoryIdentity: 'github.com/acme/repo',
					remoteUrl: 'https://github.com/acme/repo.git',
					sourcePath: path.join(cacheRoot, 'github.com', 'acme', 'repo', '.repository'),
					targetPath: path.join(root, 'workspace'),
					branch: 'workspace',
					resolvedCommit: 'a'.repeat(40),
				}),
			)

			yield* Effect.scoped(
				Effect.gen(function* () {
					const first = yield* Effect.forkChild(
						refresh('github.com/acme/repo', 'git@github.com:acme/repo.git'),
					)
					const equivalent = yield* Effect.forkChild(materialize)
					const unrelated = yield* Effect.forkChild(
						refresh('github.com/other/repo', 'git@github.com:other/repo.git'),
					)
					yield* Queue.take(started)
					yield* Queue.take(started)
					expect(Option.isNone(yield* Queue.poll(started))).toBe(true)
					expect((yield* Ref.get(active)).maximum).toBe(2)
					yield* Queue.offerAll(release, [undefined, undefined])
					yield* Queue.take(started)
					yield* Queue.offer(release, undefined)
					yield* Fiber.join(first)
					yield* Fiber.join(equivalent)
					yield* Fiber.join(unrelated)
				}),
			).pipe(Effect.provide(cacheLayer))
			expect(yield* Ref.get(active)).toEqual({ current: 0, maximum: 2 })
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	)
})
