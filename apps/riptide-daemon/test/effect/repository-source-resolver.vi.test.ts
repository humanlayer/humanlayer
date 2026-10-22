import { describe, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Logger, Path, Ref } from 'effect'
import { expect } from 'vitest'

import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { GitCommandFailedError, GitTimeoutError } from '@/effects/services/task-diff/errors'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'
import {
	RepositorySourceResolver,
	RepositorySourceResolverLive,
} from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'

describe('repository source candidates with real Git', () => {
	it.effect('uses the configured source or falls back to the deterministic managed checkout', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const identity = 'github.com/acme/repo'
			const checkout = path.join(fixture.root, 'explicit')
			yield* fixture.run(['clone', `https://${identity}.git`, checkout])
			const nested = path.join(checkout, 'nested')
			yield* fs.makeDirectory(nested)
			const plain = path.join(fixture.root, 'plain')
			yield* fs.makeDirectory(plain)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const resolver = yield* RepositorySourceResolver
				const managed = yield* cache.prepare({
					repositoryIdentity: identity,
					remoteUrl: `git@github.com:acme/repo.git`,
				})
				const managedFallback = { sourceKind: 'managed_clone' as const, sourcePath: managed }
				// Each request has at most one configured source, never remembered checkout history.
				for (const sourcePath of [
					'relative/path',
					path.join(fixture.root, 'missing'),
					path.join(checkout, 'README.md/invalid'),
					plain,
					nested,
					fixture.source,
					checkout,
				]) {
					expect(
						yield* resolver.findReusableSource({
							repositoryIdentity: identity,
							sourceCandidates: [{ sourceKind: 'filesystem', sourcePath }, managedFallback],
						}),
					).toEqual({
						_tag: 'Reusable',
						source: sourcePath === checkout ? { sourceKind: 'filesystem', sourcePath } : managedFallback,
					})
				}
				expect(
					yield* resolver.findReusableSource({
						repositoryIdentity: identity,
						sourceCandidates: [managedFallback],
					}),
				).toEqual({ _tag: 'Reusable', source: managedFallback })
				expect(
					yield* resolver.findReusableSource({ repositoryIdentity: identity, sourceCandidates: [] }),
				).toEqual({ _tag: 'NoCandidate' })
				yield* fs.remove(checkout, { recursive: true })
				expect(
					yield* resolver.findReusableSource({
						repositoryIdentity: identity,
						sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: checkout }, managedFallback],
					}),
				).toEqual({ _tag: 'Reusable', source: managedFallback })
				expect(
					yield* resolver.findReusableSource({
						repositoryIdentity: 'gitlab.com/acme/repo',
						sourceCandidates: [{ sourceKind: 'managed_clone', sourcePath: managed }],
					}),
				).toMatchObject({ _tag: 'Rejected', reason: { _tag: 'RemoteMismatch' } })
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('accepts equivalent SSH and HTTPS remotes independently for each repository', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const path = yield* Path.Path
			const first = path.join(fixture.root, 'first')
			const second = path.join(fixture.root, 'second')
			yield* fixture.run(['clone', 'git@github.com:acme/repo.git', first])
			yield* fixture.run(['clone', 'https://gitlab.com/acme/repo.git', second])
			yield* Effect.gen(function* () {
				const resolver = yield* RepositorySourceResolver
				expect(
					yield* resolver.findReusableSource({
						repositoryIdentity: 'github.com/acme/repo',
						sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: first }],
					}),
				).toEqual({ _tag: 'Reusable', source: { sourceKind: 'filesystem', sourcePath: first } })
				expect(
					yield* resolver.findReusableSource({
						repositoryIdentity: 'gitlab.com/acme/repo',
						sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: second }],
					}),
				).toEqual({ _tag: 'Reusable', source: { sourceKind: 'filesystem', sourcePath: second } })
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('rejects stale and non-Git paths without reporting expected fallbacks as incidents', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const plain = path.join(fixture.root, 'plain')
			yield* fs.makeDirectory(plain)
			const messages: unknown[] = []
			const warnings: unknown[] = []
			const logger = Logger.layer([
				Logger.make((entry) => {
					if (entry.logLevel === 'Error') messages.push(entry.message)
					if (entry.logLevel === 'Warn') warnings.push(entry.message)
				}),
			])
			for (const sourcePath of [path.join(fixture.root, 'missing'), plain]) {
				const result = yield* Effect.flatMap(RepositorySourceResolver, (resolver) =>
					resolver.findReusableSource({
						repositoryIdentity: 'github.com/acme/repo',
						sourceCandidates: [{ sourceKind: 'filesystem', sourcePath }],
					}),
				).pipe(Effect.provide(fixture.cacheLayer()), Effect.provide(logger))
				expect(result).toMatchObject({ _tag: 'Rejected' })
			}
			expect(messages).toEqual([])
			expect(warnings.flat()).toContain('Repository source path no longer exists')
			expect(warnings.flat()).toContain('Repository source candidate rejected')
			expect(yield* fs.readDirectory(plain)).toEqual([])
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('captures corrupt real Git config before narrowing instead of falling back to cloning', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const configPath = path.join(fixture.source, '.git', 'config')
			yield* fs.writeFileString(configPath, '[broken\n')
			const messages: unknown[] = []
			const failure = yield* Effect.flatMap(RepositorySourceResolver, (resolver) =>
				resolver.findReusableSource({
					repositoryIdentity: 'github.com/acme/repo',
					sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: fixture.source }],
				}),
			).pipe(
				Effect.flip,
				Effect.provide(fixture.cacheLayer()),
				Effect.provide(Logger.layer([Logger.make((entry) => messages.push(entry.message))])),
			)
			expect(failure).toMatchObject({
				_tag: 'WorkspaceRepositoryLocalOperationError',
				exitCode: 128,
				stderr: expect.stringContaining('bad config'),
			})
			expect(messages.flat()).toContainEqual(
				expect.objectContaining({ _tag: 'GitCommandFailedError', exitCode: 128 }),
			)
			expect(yield* fs.readFileString(configPath)).toBe('[broken\n')
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('keeps timeout and corrupt-config failures typed at the Git runner seam', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const attempts = yield* Ref.make(0)
			const messages: unknown[] = []
			const logger = Logger.layer([
				Logger.make((entry) => {
					messages.push(entry.message)
				}),
			])
			const resolver = yield* RepositorySourceResolver
			const request = {
				repositoryIdentity: 'github.com/acme/repo',
				sourceCandidates: [
					{ sourceKind: 'filesystem' as const, sourcePath: fixture.source },
					{ sourceKind: 'managed_clone' as const, sourcePath: fixture.cacheRoot },
				],
			}
			const timedOut = yield* Effect.flip(
				resolver.findReusableSource(request).pipe(
					Effect.provide(
						Layer.succeed(GitCommandRunner, {
							run: (argv) =>
								Ref.update(attempts, (count) => count + 1).pipe(
									Effect.andThen(
										Effect.fail(new GitTimeoutError({ message: 'Git timed out', argv })),
									),
								),
						}),
					),
					Effect.provide(logger),
				),
			)
			expect(timedOut).toMatchObject({
				_tag: 'WorkspaceRepositoryLocalOperationError',
				message: 'Git timed out',
				command: 'rev-parse --show-toplevel',
			})
			expect(yield* Ref.get(attempts)).toBe(1)
			expect(messages.flat()).toContainEqual(expect.objectContaining({ _tag: 'GitTimeoutError' }))
			const corrupt = yield* Effect.flip(
				resolver.findReusableSource(request).pipe(
					Effect.provide(
						Layer.succeed(GitCommandRunner, {
							run: (argv) =>
								Effect.fail(
									new GitCommandFailedError({
										message: 'Git failed',
										argv,
										exitCode: 128,
										stderr: 'fatal: bad config line 1',
									}),
								),
						}),
					),
				),
			)
			expect(corrupt).toMatchObject({
				_tag: 'WorkspaceRepositoryLocalOperationError',
				command: 'rev-parse --show-toplevel',
				exitCode: 128,
				stderr: 'fatal: bad config line 1',
			})
		}).pipe(
			Effect.scoped,
			Effect.provide(RepositorySourceResolverLive),
			Effect.provide(RealRepositoryTestPlatform),
		),
	)
})
