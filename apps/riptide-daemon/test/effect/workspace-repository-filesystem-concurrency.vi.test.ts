import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import type { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { Effect, Fiber, FileSystem, Layer, Path, Queue, Ref } from 'effect'
import { expect } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'
import { RepositorySourceResolverLive } from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'
import { WorkspaceRepositoryActorOperationsLive } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'
import { workspaceRepositorySnapshotAt } from '../helpers/workspace-repository-snapshot'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

interface FilesystemActorFixtureInput {
	readonly workspaceId: string
	readonly sourcePath: string
	readonly repositoryIdentity: string
}

describe('filesystem repository actor concurrency', () => {
	it.effect(
		'serializes shared filesystem refresh and materialization across projects while another identity progresses',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const git = yield* GitCommandRunner
				const remoteUrl = 'https://github.com/acme/repo.git'
				yield* fixture.run(['remote', 'set-url', 'origin', remoteUrl], fixture.source)
				const otherSource = path.join(fixture.root, 'other-source')
				yield* fixture.run(['clone', 'https://gitlab.com/acme/repo.git', otherSource])
				yield* fs.writeFileString(path.join(fixture.source, 'user-notes'), 'preserve user work')
				const started = yield* Queue.unbounded<string>()
				const release = yield* Queue.unbounded<void>()
				const requested = yield* Queue.unbounded<void>()
				const active = yield* Ref.make({ shared: 0, maximum: 0 })
				const runner = Layer.succeed(GitCommandRunner, {
					run: (argv, options) => {
						if (argv[0] !== 'fetch' && !(argv[0] === 'worktree' && argv[1] === 'add'))
							return git.run(argv, options)
						return Effect.gen(function* () {
							if (options.cwd === fixture.source)
								yield* Ref.update(active, (state) => ({
									shared: state.shared + 1,
									maximum: Math.max(state.maximum, state.shared + 1),
								}))
							yield* Queue.offer(started, `${options.cwd}:${argv[0]}`)
							yield* Queue.take(release)
							return yield* git.run(argv, options)
						}).pipe(
							Effect.ensuring(
								options.cwd === fixture.source
									? Ref.update(active, (state) => ({ ...state, shared: state.shared - 1 }))
									: Effect.void,
							),
						)
					},
				})
				const cacheLayer = Layer.mergeAll(ManagedRepositoryCacheLive, RepositorySourceContextLive).pipe(
					Layer.provideMerge(Layer.mergeAll(runner, NodeServices.layer, fixture.config())),
				)
				const snapshot = ({
					workspaceId,
					sourcePath,
					repositoryIdentity,
				}: FilesystemActorFixtureInput): WorkspaceRepositoryActorSnapshot => {
					const initial = workspaceRepositorySnapshotAt('materializing')
					const repository = {
						...initial.repository,
						repositoryIdentity,
						remoteUrl: `https://${repositoryIdentity}.git`,
						branch: `workspace-${workspaceId}`,
					}
					return {
						...initial,
						repository,
						workspace: {
							...initial.workspace,
							id: workspaceId,
							projectId: `project-${workspaceId}`,
							repositories: [repository],
						},
						location: { ...initial.location, filePath: path.join(fixture.root, workspaceId) },
						status: {
							...initial.status,
							projectId: `project-${workspaceId}`,
							workspaceId,
							sourceKind: 'filesystem',
							sourcePath,
							resolvedCommit: fixture.commit,
							repositoryIdentity,
							repositoryRemoteUrl: repository.remoteUrl,
						},
						sourceCandidates: [],
					}
				}
				const first = snapshot({
					workspaceId: 'first',
					sourcePath: fixture.source,
					repositoryIdentity: 'github.com/acme/repo',
				})
				const second = snapshot({
					workspaceId: 'second',
					sourcePath: fixture.source,
					repositoryIdentity: 'github.com/acme/repo',
				})
				const other = snapshot({
					workspaceId: 'other',
					sourcePath: otherSource,
					repositoryIdentity: 'gitlab.com/acme/repo',
				})
				const reports = yield* Ref.make<ReadonlyArray<string>>([])
				const api = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						reportWorkspaceRepositoryResult: (input) =>
							Ref.update(reports, (seen) => [...seen, input.workspaceId]).pipe(
								Effect.as({
									snapshot:
										input.workspaceId === 'first'
											? first
											: input.workspaceId === 'second'
												? second
												: other,
								}),
							),
					}),
				)
				yield* Effect.gen(function* () {
					const cache = yield* ManagedRepositoryCache
					const recordingCache = Layer.succeed(ManagedRepositoryCache, {
						...cache,
						refresh: (input) =>
							Queue.offer(requested, undefined).pipe(Effect.andThen(cache.refresh(input))),
					})
					const actors = WorkspaceRepositoryActorOperationsLive.pipe(
						Layer.provideMerge(
							Layer.mergeAll(
								recordingCache,
								api,
								runner,
								NodeServices.layer,
								RepositorySourceResolverLive,
							),
						),
					)
					yield* Effect.gen(function* () {
						const actor = yield* WorkspaceRepositoryActorOperations
						const materializing = yield* Effect.forkChild(actor.materialize(first))
						expect(yield* Queue.take(started)).toBe(`${fixture.source}:worktree`)
						const refreshing = yield* Effect.forkChild(actor.refreshSource(second))
						yield* Queue.take(requested)
						const independent = yield* Effect.forkChild(actor.refreshSource(other))
						yield* Queue.take(requested)
						expect(yield* Queue.take(started)).toBe(`${otherSource}:fetch`)
						expect((yield* Ref.get(active)).maximum).toBe(1)
						yield* Queue.offerAll(release, [undefined, undefined])
						expect(yield* Queue.take(started)).toBe(`${fixture.source}:fetch`)
						yield* Queue.offer(release, undefined)
						yield* Fiber.join(materializing)
						yield* Fiber.join(refreshing)
						yield* Fiber.join(independent)
						yield* actor.copyFiles({
							...first,
							repository: { ...first.repository, copyGlobs: ['user-*'] },
							status: {
								...first.status,
								materialization: {
									kind: 'worktree',
									path: first.location.filePath,
									branch: first.repository.branch,
								},
							},
						})
					}).pipe(Effect.provide(actors))
				}).pipe(Effect.provide(cacheLayer))
				expect(yield* Ref.get(active)).toEqual({ shared: 0, maximum: 1 })
				expect([...(yield* Ref.get(reports))].sort()).toEqual(['first', 'first', 'other', 'second'])
				expect(yield* fs.readFileString(path.join(first.location.filePath, 'user-notes'))).toBe(
					'preserve user work',
				)
				expect(yield* fs.readFileString(path.join(first.location.filePath, 'README.md'))).toBe('fixture\n')
				expect(yield* fs.readFileString(path.join(fixture.source, 'user-notes'))).toBe('preserve user work')
				expect(
					(yield* fixture.run(
						['rev-parse', 'refs/humanlayer/workspaces/second/base'],
						fixture.source,
					)).stdout.trim(),
				).toBe(fixture.commit)
				expect((yield* fixture.run(['branch', '--show-current'], fixture.source)).stdout.trim()).toBe('main')
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('rejects foreign filesystem checkouts and reuses only an actual shared worktree', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const path = yield* Path.Path
			const fs = yield* FileSystem.FileSystem
			const targetPath = path.join(fixture.root, 'independent-user-checkout')
			const remoteUrl = 'https://github.com/acme/repo.git'
			yield* fixture.run(['remote', 'set-url', 'origin', remoteUrl], fixture.source)
			yield* fixture.run(['clone', remoteUrl, targetPath])
			yield* fixture.run(['checkout', '-b', 'workspace-user'], targetPath)
			yield* fs.writeFileString(path.join(fixture.source, 'user-notes'), 'preserve source files')
			const sharedPath = path.join(fixture.root, 'shared-worktree')
			yield* fixture.run(['worktree', 'add', '-b', 'workspace-user', sharedPath, fixture.commit], fixture.source)
			const initial = workspaceRepositorySnapshotAt('materializing')
			const repository = {
				...initial.repository,
				repositoryIdentity: 'github.com/acme/repo',
				remoteUrl,
				branch: 'workspace-user',
			}
			const snapshot: WorkspaceRepositoryActorSnapshot = {
				...initial,
				repository,
				workspace: { ...initial.workspace, repositories: [repository] },
				location: { ...initial.location, filePath: targetPath },
				status: {
					...initial.status,
					sourceKind: 'filesystem',
					sourcePath: fixture.source,
					resolvedCommit: fixture.commit,
				},
			}
			const reports = yield* Ref.make<ReadonlyArray<string>>([])
			const api = Layer.succeed(
				DaemonApi,
				makeMockDaemonApi({
					reportWorkspaceRepositoryResult: (input) => {
						return Ref.update(reports, (seen) => [...seen, input.result._tag]).pipe(Effect.as({ snapshot }))
					},
				}),
			)
			const actors = WorkspaceRepositoryActorOperationsLive.pipe(
				Layer.provideMerge(Layer.mergeAll(api, fixture.cacheLayer())),
			)
			yield* Effect.gen(function* () {
				const actor = yield* WorkspaceRepositoryActorOperations
				expect(yield* Effect.flip(actor.materialize(snapshot))).toMatchObject({
					_tag: 'WorkspaceRepositoryParked',
				})
				const sharedSnapshot = { ...snapshot, location: { ...snapshot.location, filePath: sharedPath } }
				yield* actor.materialize(sharedSnapshot)
				yield* actor.materialize(sharedSnapshot)
			}).pipe(Effect.provide(actors))
			expect(yield* Ref.get(reports)).toEqual(['StageFailed', 'WorktreeMaterialized', 'WorktreeMaterialized'])
			expect((yield* fixture.run(['rev-parse', 'HEAD'], targetPath)).stdout.trim()).toBe(fixture.commit)
			expect((yield* fixture.run(['branch', '--show-current'], targetPath)).stdout.trim()).toBe('workspace-user')
			expect(yield* fs.readFileString(path.join(sharedPath, 'README.md'))).toBe('fixture\n')
			expect(yield* fs.readFileString(path.join(fixture.source, 'user-notes'))).toBe('preserve source files')
			expect((yield* fixture.run(['branch', '--show-current'], fixture.source)).stdout.trim()).toBe('main')
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)
})
