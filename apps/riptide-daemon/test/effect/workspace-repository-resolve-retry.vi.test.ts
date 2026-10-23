import { describe, it } from '@effect/vitest'
import type {
	WorkspaceRepositoryActorSnapshot,
	WorkspaceRepositorySetupResult,
} from '@humanlayer/schemas/effect/project-workspace'
import { Effect, FileSystem, Layer, Ref } from 'effect'
import { expect } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { GitTimeoutError } from '@/effects/services/task-diff/errors'
import { GitCommandRunner } from '@/effects/services/task-diff/git-command-runner.service'
import { WorkspaceRepositoryActorOperationsLive } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'

import { makeRealRepositoryCacheFixture, RealRepositoryTestPlatform } from '../helpers/real-repository-cache'
import { workspaceRepositorySnapshotAt } from '../helpers/workspace-repository-snapshot'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

interface ResolveRetrySnapshotInput {
	readonly sourcePath: string
	readonly sourceKind: 'filesystem' | 'managed_clone'
}

const makeSnapshot = (input: ResolveRetrySnapshotInput): WorkspaceRepositoryActorSnapshot => {
	const initial = workspaceRepositorySnapshotAt('resolving_commit')
	const repository = {
		...initial.repository,
		repositoryIdentity: 'github.com/acme/repo',
		remoteUrl: 'https://github.com/acme/repo.git',
		baseCommit: undefined,
	}
	return {
		...initial,
		repository,
		workspace: { ...initial.workspace, repositories: [repository] },
		status: {
			...initial.status,
			...input,
			resolvedCommit: null,
			repositoryIdentity: repository.repositoryIdentity,
			repositoryRemoteUrl: repository.remoteUrl,
		},
	}
}

describe('resolving_commit retry recovery', () => {
	it.effect(
		'repairs an undefined-workspace ref for both persisted source kinds without rewinding stages, then resolves offline',
		() =>
			Effect.gen(function* () {
				for (const sourceKind of ['filesystem', 'managed_clone'] as const) {
					const fixture = yield* makeRealRepositoryCacheFixture()
					const fs = yield* FileSystem.FileSystem
					yield* fixture.run(
						['remote', 'set-url', 'origin', 'https://github.com/acme/repo.git'],
						fixture.source,
					)
					yield* Effect.gen(function* () {
						const cache = yield* ManagedRepositoryCache
						const sourcePath =
							sourceKind === 'filesystem'
								? fixture.source
								: yield* cache.prepare({
										repositoryIdentity: 'github.com/acme/repo',
										remoteUrl: 'https://github.com/acme/repo.git',
									})
						const snapshot = makeSnapshot({ sourcePath, sourceKind })
						expect(snapshot.status.workspaceId).toBe(snapshot.workspace.id)
						yield* fixture.run(
							['update-ref', 'refs/humanlayer/workspaces/undefined/base', fixture.commit],
							sourcePath,
						)
						const reports = yield* Ref.make<ReadonlyArray<WorkspaceRepositorySetupResult>>([])
						const api = Layer.succeed(
							DaemonApi,
							makeMockDaemonApi({
								reportWorkspaceRepositoryResult: (input) => {
									expect(input.workspaceId).toBe(snapshot.workspace.id)
									expect(input.expectedUpdatedAt).toBe(snapshot.status.updatedAt)
									return Ref.update(reports, (seen) => [...seen, input.result]).pipe(
										Effect.as({ snapshot }),
									)
								},
							}),
						)
						const actors = WorkspaceRepositoryActorOperationsLive.pipe(Layer.provideMerge(api))
						yield* Effect.gen(function* () {
							const actor = yield* WorkspaceRepositoryActorOperations
							yield* actor.resolveCommit(snapshot)
							expect(
								(yield* fixture.run(
									['rev-parse', `refs/humanlayer/workspaces/${snapshot.workspace.id}/base`],
									sourcePath,
								)).stdout.trim(),
							).toBe(fixture.commit)
							yield* fs.remove(fixture.remote, { recursive: true })
							yield* actor.resolveCommit(snapshot)
						}).pipe(Effect.provide(actors))
						expect(yield* Ref.get(reports)).toEqual([
							{ _tag: 'CommitResolved', resolvedCommit: fixture.commit },
							{ _tag: 'CommitResolved', resolvedCommit: fixture.commit },
						])
					}).pipe(Effect.provide(fixture.cacheLayer()))
				}
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('does not repair explicit pins or swallow genuine ref inspection errors', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			const git = yield* GitCommandRunner
			const snapshot = makeSnapshot({ sourcePath: fixture.source, sourceKind: 'filesystem' })
			const reports = yield* Ref.make<ReadonlyArray<WorkspaceRepositorySetupResult>>([])
			const refreshes = yield* Ref.make(0)
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const cacheBoundary = Layer.succeed(ManagedRepositoryCache, {
					...cache,
					refresh: (input) =>
						Ref.update(refreshes, (count) => count + 1).pipe(Effect.andThen(cache.refresh(input))),
				})
				const api = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						reportWorkspaceRepositoryResult: (input) =>
							Ref.update(reports, (seen) => [...seen, input.result]).pipe(Effect.as({ snapshot })),
					}),
				)
				const runner = Layer.succeed(GitCommandRunner, {
					run: (argv, options) =>
						argv[0] === 'show-ref'
							? Effect.fail(new GitTimeoutError({ message: 'ref inspection timed out', argv }))
							: git.run(argv, options),
				})
				const actors = WorkspaceRepositoryActorOperationsLive.pipe(
					Layer.provideMerge(Layer.mergeAll(cacheBoundary, api, runner)),
				)
				yield* Effect.gen(function* () {
					const actor = yield* WorkspaceRepositoryActorOperations
					expect(
						yield* Effect.flip(
							actor.resolveCommit({
								...snapshot,
								repository: { ...snapshot.repository, baseCommit: 'f'.repeat(40) },
							}),
						),
					).toMatchObject({ _tag: 'WorkspaceRepositoryParked' })
					yield* actor.resolveCommit({
						...snapshot,
						status: { ...snapshot.status, resolvedCommit: fixture.commit },
					})
					expect(yield* Effect.flip(actor.resolveCommit(snapshot))).toMatchObject({
						_tag: 'WorkspaceRepositoryParked',
					})
				}).pipe(Effect.provide(actors))
			}).pipe(Effect.provide(fixture.cacheLayer()))
			expect(yield* Ref.get(refreshes)).toBe(0)
			expect(yield* Ref.get(reports)).toMatchObject([
				{ _tag: 'StageFailed', stage: 'resolving_commit' },
				{ _tag: 'CommitResolved', resolvedCommit: fixture.commit },
				{ _tag: 'StageFailed', stage: 'resolving_commit', error: { message: 'ref inspection timed out' } },
			])
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)

	it.effect('rejects an old runtime refresh payload without workspaceId before invoking Git', () =>
		Effect.gen(function* () {
			const fixture = yield* makeRealRepositoryCacheFixture()
			yield* Effect.gen(function* () {
				const cache = yield* ManagedRepositoryCache
				const failure = yield* Effect.flip(
					// @ts-expect-error Deliberately exercise a stale JavaScript caller from before the refresh API update.
					cache.refresh({
						repositoryIdentity: 'github.com/acme/repo',
						remoteUrl: 'https://github.com/acme/repo.git',
						sourcePath: fixture.source,
						defaultBranch: 'main',
						workspaceBranch: 'workspace',
					}),
				)
				expect(failure.message).toBe('Repository refresh requires a workspace ID')
				expect(
					yield* fixture
						.run(
							['show-ref', '--verify', '--quiet', 'refs/humanlayer/workspaces/undefined/base'],
							fixture.source,
						)
						.pipe(Effect.flip),
				).toMatchObject({ _tag: 'GitCommandFailedError', exitCode: 1 })
			}).pipe(Effect.provide(fixture.cacheLayer()))
		}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
	)
})
