import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupResult,
} from '@humanlayer/schemas/effect/project-workspace'
import { Effect, FileSystem, Layer, Path, Ref } from 'effect'
import { expect } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContextLive } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunnerLive, GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'
import { RepositorySourceResolverLive } from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'
import { WorkspaceRepositoryActorOperationsLive } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'
import { workspaceRepositorySnapshotAt } from '../helpers/workspace-repository-snapshot'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

const managedPath = '/tmp/managed-cache/github.com/humanlayer/syncopate/.repository'

const commitResult = (
	snapshot: WorkspaceRepositoryActorSnapshot,
	result: WorkspaceRepositorySetupResult,
): WorkspaceRepositoryActorSnapshot => {
	switch (result._tag) {
		case 'ManagedCloneRequested':
			return {
				...snapshot,
				status: {
					...snapshot.status,
					status: 'cloning_source',
					sourceKind: 'managed_clone',
					sourcePath: result.sourcePath,
					updatedAt: snapshot.status.updatedAt + 1,
				},
			}
		case 'ManagedCloneReady':
			return {
				...snapshot,
				status: {
					...snapshot.status,
					status: 'refreshing_source',
					repoAvailable: true,
					sourceKind: 'managed_clone',
					sourcePath: result.sourcePath,
					updatedAt: snapshot.status.updatedAt + 1,
				},
			}
		case 'SourceChecked':
			return {
				...snapshot,
				status: {
					...snapshot.status,
					status: 'refreshing_source',
					repoAvailable: true,
					sourceKind: result.sourceKind,
					sourcePath: result.sourcePath,
					updatedAt: snapshot.status.updatedAt + 1,
				},
			}
		case 'StageFailed':
			return {
				...snapshot,
				status: { ...snapshot.status, error: result.error, updatedAt: snapshot.status.updatedAt + 1 },
			}
		default:
			throw new Error(`Unexpected result ${result._tag}`)
	}
}

const operationsLayer = (prepared: Ref.Ref<number>) => {
	const api = Layer.succeed(
		DaemonApi,
		makeMockDaemonApi({
			reportWorkspaceRepositoryResult: (input) =>
				Effect.succeed({
					snapshot: commitResult(
						workspaceRepositorySnapshotAt(
							input.result._tag === 'ManagedCloneReady' ? 'cloning_source' : 'checking_source',
						),
						input.result,
					),
				}),
		}),
	)
	const cache = Layer.succeed(ManagedRepositoryCache, {
		repositoryPath: () => Effect.succeed(managedPath),
		prepare: () => Ref.update(prepared, (count) => count + 1).pipe(Effect.as(managedPath)),
		refresh: () => Effect.die('unused managed refresh'),
		materialize: () => Effect.die('unused managed materialize'),
		publishBranch: () => Effect.die('unused managed publish'),
	})
	const git = Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive, RepositorySourceContextLive).pipe(
		Layer.provideMerge(NodeServices.layer),
		Layer.orDie,
	)
	return WorkspaceRepositoryActorOperationsLive.pipe(
		Layer.provideMerge(Layer.mergeAll(api, cache, git, NodeServices.layer, RepositorySourceResolverLive)),
	)
}

describe('workspace repository source selection', () => {
	it.effect(
		'retries cloning and refreshes the persisted source even when candidates and cache configuration change',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const sourcePath = yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.prepare({
						repositoryIdentity: 'github.com/acme/repo',
						remoteUrl: 'https://github.com/acme/repo.git',
					}),
				).pipe(Effect.provide(fixture.cacheLayer()))
				const initial = workspaceRepositorySnapshotAt('cloning_source', 42)
				yield* fixture.run(['remote', 'set-url', 'origin', 'https://github.com/acme/repo.git'], fixture.source)
				const repository = {
					...initial.repository,
					repositoryIdentity: 'github.com/acme/repo',
					remoteUrl: 'https://github.com/acme/repo.git',
				}
				const snapshot: WorkspaceRepositoryActorSnapshot = {
					...initial,
					repository,
					workspace: { ...initial.workspace, repositories: [repository] },
					sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: fixture.source }],
					status: {
						...initial.status,
						sourceKind: 'managed_clone',
						sourcePath,
						repositoryIdentity: repository.repositoryIdentity,
						repositoryRemoteUrl: repository.remoteUrl,
					},
				}
				const reports = yield* Ref.make<ReadonlyArray<WorkspaceRepositorySetupResult>>([])
				const api = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						reportWorkspaceRepositoryResult: (input) =>
							Effect.gen(function* () {
								expect(input.expectedUpdatedAt).toBe(42)
								expect(input.generation).toBe(snapshot.status.generation)
								yield* Ref.update(reports, (seen) => [...seen, input.result])
								return { snapshot }
							}),
					}),
				)
				const operations = WorkspaceRepositoryActorOperationsLive.pipe(
					Layer.provideMerge(Layer.mergeAll(api, fixture.cacheLayer(`${fixture.root}/new-cache`))),
				)
				yield* Effect.gen(function* () {
					const actor = yield* WorkspaceRepositoryActorOperations
					yield* actor.cloneSource(snapshot)
					yield* actor.refreshSource({
						...snapshot,
						status: { ...snapshot.status, status: 'refreshing_source' },
					})
				}).pipe(Effect.provide(operations))
				expect(yield* Ref.get(reports)).toEqual([
					{ _tag: 'ManagedCloneReady', sourcePath },
					{ _tag: 'SourceRefreshed', sourceKind: 'managed_clone', sourcePath },
				])
				expect(
					(yield* fixture.run(
						['rev-parse', `refs/humanlayer/workspaces/${snapshot.workspace.id}/base`],
						sourcePath,
					)).stdout.trim(),
				).toBe(fixture.commit)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('moves managed-clone sources through durable cloning_source before refresh', () =>
		Effect.gen(function* () {
			const prepared = yield* Ref.make(0)
			yield* Effect.gen(function* () {
				const initial = workspaceRepositorySnapshotAt('checking_source')
				const managed = {
					...initial,
					sourceCandidates: [],
					status: {
						...initial.status,
						sourcePolicy: 'managed_clone' as const,
						sourceKind: null,
						sourcePath: null,
					},
				}
				const operations = yield* WorkspaceRepositoryActorOperations
				const cloning = yield* operations.checkSource(managed)
				expect(cloning.status).toMatchObject({
					status: 'cloning_source',
					sourceKind: 'managed_clone',
					sourcePath: managedPath,
					repoAvailable: false,
				})
				const refreshing = yield* operations.cloneSource(cloning)
				expect(refreshing.status).toMatchObject({
					status: 'refreshing_source',
					sourceKind: 'managed_clone',
					sourcePath: managedPath,
					repoAvailable: true,
				})
			}).pipe(Effect.provide(operationsLayer(prepared)))
			expect(yield* Ref.get(prepared)).toBe(1)
		}),
	)

	it.effect('keeps valid filesystem sources and falls back when the saved path is invalid', () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const git = yield* GitCommandRunner
			const root = yield* fs.makeTempDirectoryScoped({ prefix: 'workspace-source-policy-' })
			const source = path.join(root, 'source')
			yield* git.run(['init', '--initial-branch=main', source], { cwd: root })
			yield* git.run(['remote', 'add', 'origin', 'git@github.com:humanlayer/syncopate.git'], { cwd: source })
			const prepared = yield* Ref.make(0)
			yield* Effect.gen(function* () {
				const operations = yield* WorkspaceRepositoryActorOperations
				const initial = workspaceRepositorySnapshotAt('checking_source')
				const valid = yield* operations.checkSource({
					...initial,
					sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: source }],
					status: { ...initial.status, sourcePath: source },
				})
				expect(valid.status).toMatchObject({
					status: 'refreshing_source',
					sourceKind: 'filesystem',
					sourcePath: source,
				})

				const fallback = yield* operations.checkSource({
					...initial,
					sourceCandidates: [{ sourceKind: 'filesystem', sourcePath: path.join(root, 'missing') }],
					status: { ...initial.status, sourcePath: path.join(root, 'missing') },
				})
				expect(fallback.status).toMatchObject({
					status: 'cloning_source',
					sourceKind: 'managed_clone',
					sourcePath: managedPath,
				})
			}).pipe(Effect.provide(operationsLayer(prepared)))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('parks an invalid filesystem-required source without requesting a managed clone', () =>
		Effect.gen(function* () {
			const prepared = yield* Ref.make(0)
			const initial = workspaceRepositorySnapshotAt('checking_source')
			const snapshot = {
				...initial,
				sourceCandidates: [{ sourceKind: 'filesystem' as const, sourcePath: '/definitely/missing/source' }],
				status: {
					...initial.status,
					sourcePolicy: 'filesystem_required' as const,
					sourcePath: '/definitely/missing/source',
				},
			}
			const failure = yield* Effect.flatMap(WorkspaceRepositoryActorOperations, (operations) =>
				operations.checkSource(snapshot),
			).pipe(Effect.flip, Effect.provide(operationsLayer(prepared)))
			expect(failure).toMatchObject({
				_tag: 'WorkspaceRepositoryParked',
				snapshot: { status: { error: { stage: 'checking_source', message: 'Source path does not exist' } } },
			})
			expect(yield* Ref.get(prepared)).toBe(0)
		}),
	)
})
