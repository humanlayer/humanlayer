import { describe, it } from '@effect/vitest'
import type { WorkspaceRepositoryActorSnapshot } from '@humanlayer/schemas/effect/project-workspace'
import { Effect, FileSystem, Layer, Path, Ref } from 'effect'
import { expect } from 'vitest'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { ManagedRepositoryCacheLive } from '@/effects/services/managed-repository-cache/managed-repository-cache.layer'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { WorkspaceRepositoryActorOperationsLive } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositoryActorOperations } from '@/effects/services/workspace-repository-actor-operations/workspace-repository-actor-operations.service'

import {
	makeIsolatedRepositoryUserFixture,
	makeRealRepositoryCacheFixture,
	RealRepositoryTestPlatform,
} from '../helpers/real-repository-cache'
import { workspaceRepositorySnapshotAt } from '../helpers/workspace-repository-snapshot'
import { makeMockDaemonApi } from '../mocks/daemon-api.mock'

const repository = { repositoryIdentity: 'github.com/acme/repo', remoteUrl: 'https://github.com/acme/repo.git' }
// One portable branch name shared by every user's and host's placement of the workspace.
const branch = 'workspace-portable'
const workspaceId = '01990c8d-0000-7000-8000-000000000003'
const refresh = { ...repository, defaultBranch: 'main', workspaceBranch: branch, workspaceId }
// Each test clones, refreshes, and materializes for one or two users with real Git processes.
const REAL_GIT_TEST_TIMEOUT = 300_000

type UserFixture = Effect.Success<ReturnType<typeof makeIsolatedRepositoryUserFixture>>

interface UserPlacementInput {
	readonly user: UserFixture
	readonly resolvedCommit: string
}

/**
 * Runs one user's daemon-side setup against that user's own cache layer: managed
 * clone, refresh, and materialization into that user's own workspace root.
 */
const materializeUserPlacement = Effect.fn('test.materialize_user_placement')(function* (input: UserPlacementInput) {
	const path = yield* Path.Path
	const targetPath = path.join(input.user.workspaceRoot, 'workspace')
	const sourcePath = yield* Effect.gen(function* () {
		const cache = yield* ManagedRepositoryCache
		const sourcePath = yield* cache.prepare(repository)
		yield* cache.refresh({ ...refresh, sourcePath })
		yield* cache.materialize({
			...repository,
			sourcePath,
			targetPath,
			branch,
			resolvedCommit: input.resolvedCommit,
			workspaceId,
		})
		return sourcePath
	}).pipe(Effect.provide(input.user.cacheLayer()))
	return { sourcePath, targetPath }
})

interface UserWorkInput {
	readonly user: UserFixture
	readonly targetPath: string
	readonly label: string
}

/** Leaves the three kinds of work that must never move between users. */
const leaveUnpublishedWork = Effect.fn('test.leave_unpublished_work')(function* (input: UserWorkInput) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	yield* fs.writeFileString(path.join(input.targetPath, `${input.label}-committed.txt`), `${input.label}\n`)
	yield* input.user.run(['add', `${input.label}-committed.txt`], input.targetPath)
	yield* input.user.run(['commit', '-m', `${input.label} unpublished`], input.targetPath)
	const unpublishedCommit = (yield* input.user.run(['rev-parse', 'HEAD'], input.targetPath)).stdout.trim()
	yield* fs.writeFileString(path.join(input.targetPath, 'README.md'), `${input.label} uncommitted\n`)
	yield* fs.writeFileString(path.join(input.targetPath, `${input.label}-local-only.txt`), 'never committed\n')
	return unpublishedCommit
})

describe('same-owner worktree recovery and cross-user isolation', () => {
	it.effect(
		'reuses the same owner’s worktree and preserves unpublished commits, uncommitted changes, and local files',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const user = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'a',
				})
				const { sourcePath, targetPath } = yield* materializeUserPlacement({
					user,
					resolvedCommit: fixture.commit,
				})
				const unpublishedCommit = yield* leaveUnpublishedWork({ user, targetPath, label: 'a' })

				// Restart recovery: the same placement materializes again against the same pinned base.
				const reused = yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.materialize({
						...repository,
						sourcePath,
						targetPath,
						branch,
						resolvedCommit: fixture.commit,
						workspaceId,
					}),
				).pipe(Effect.provide(user.cacheLayer()))

				expect(reused).toEqual({ kind: 'worktree', path: targetPath, branch })
				expect((yield* user.run(['rev-parse', 'HEAD'], targetPath)).stdout.trim()).toBe(unpublishedCommit)
				expect((yield* user.run(['branch', '--show-current'], targetPath)).stdout.trim()).toBe(branch)
				expect(yield* fs.readFileString(path.join(targetPath, 'README.md'))).toBe('a uncommitted\n')
				expect(yield* fs.readFileString(path.join(targetPath, 'a-local-only.txt'))).toBe('never committed\n')
				// Reuse did not publish anything on the owner's behalf.
				expect(
					(yield* user.run(['ls-remote', '--heads', fixture.remote, `refs/heads/${branch}`], sourcePath))
						.stdout,
				).toBe('')
				const registered = (yield* user.run(['worktree', 'list', '--porcelain'], sourcePath)).stdout
					.split('\n')
					.filter((line) => line.startsWith('worktree ')).length
				expect(registered).toBe(2)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
		REAL_GIT_TEST_TIMEOUT,
	)

	it.effect(
		'gives a second user an isolated worktree that receives only published work',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const userA = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'a',
				})
				const userB = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'b',
				})
				const placementA = yield* materializeUserPlacement({ user: userA, resolvedCommit: fixture.commit })
				const unpublishedA = yield* leaveUnpublishedWork({
					user: userA,
					targetPath: placementA.targetPath,
					label: 'a',
				})

				const placementB = yield* materializeUserPlacement({ user: userB, resolvedCommit: fixture.commit })
				const commonDirectory = (user: UserFixture, cwd: string) =>
					Effect.flatMap(
						user.run(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd),
						(output) => fs.realPath(output.stdout.trim()),
					)
				expect(placementB.targetPath).not.toBe(placementA.targetPath)
				expect(yield* commonDirectory(userB, placementB.targetPath)).not.toBe(
					yield* commonDirectory(userA, placementA.targetPath),
				)
				expect((yield* userB.run(['branch', '--show-current'], placementB.targetPath)).stdout.trim()).toBe(
					branch,
				)
				expect((yield* userB.run(['rev-parse', 'HEAD'], placementB.targetPath)).stdout.trim()).toBe(
					fixture.commit,
				)
				expect(
					yield* userB.run(['cat-file', '-t', unpublishedA], placementB.sourcePath).pipe(
						Effect.map(() => 'present'),
						Effect.catchTag('GitCommandFailedError', () => Effect.succeed('absent')),
					),
				).toBe('absent')
				expect(yield* fs.exists(path.join(placementB.targetPath, 'a-committed.txt'))).toBe(false)
				expect(yield* fs.exists(path.join(placementB.targetPath, 'a-local-only.txt'))).toBe(false)
				expect(yield* fs.readFileString(path.join(placementB.targetPath, 'README.md'))).toBe('fixture\n')

				// Publishing moves the commit, and only the commit, to the second user.
				yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.publishBranch({
						...repository,
						sourcePath: placementA.sourcePath,
						materializationPath: placementA.targetPath,
						branch,
					}),
				).pipe(Effect.provide(userA.cacheLayer()))
				const materializeB = Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.refresh({ ...refresh, sourcePath: placementB.sourcePath }).pipe(
						Effect.andThen(
							cache.materialize({
								...repository,
								sourcePath: placementB.sourcePath,
								targetPath: placementB.targetPath,
								branch,
								resolvedCommit: fixture.commit,
								workspaceId,
							}),
						),
					),
				).pipe(Effect.provide(userB.cacheLayer()))
				yield* materializeB
				expect((yield* userB.run(['rev-parse', 'HEAD'], placementB.targetPath)).stdout.trim()).toBe(
					unpublishedA,
				)
				expect(yield* fs.readFileString(path.join(placementB.targetPath, 'a-committed.txt'))).toBe('a\n')
				expect(yield* fs.readFileString(path.join(placementB.targetPath, 'README.md'))).toBe('fixture\n')
				expect(yield* fs.exists(path.join(placementB.targetPath, 'a-local-only.txt'))).toBe(false)

				// A dirty checkout that is behind is kept as it is rather than reset or merged.
				const secondPublished = yield* leaveUnpublishedWork({
					user: userA,
					targetPath: placementA.targetPath,
					label: 'a2',
				})
				yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.publishBranch({
						...repository,
						sourcePath: placementA.sourcePath,
						materializationPath: placementA.targetPath,
						branch,
					}),
				).pipe(Effect.provide(userA.cacheLayer()))
				yield* fs.writeFileString(path.join(placementB.targetPath, 'README.md'), 'b uncommitted\n')
				yield* materializeB
				expect((yield* userB.run(['rev-parse', 'HEAD'], placementB.targetPath)).stdout.trim()).toBe(
					unpublishedA,
				)
				expect(yield* fs.readFileString(path.join(placementB.targetPath, 'README.md'))).toBe('b uncommitted\n')
				expect(yield* fs.exists(path.join(placementB.targetPath, 'a2-committed.txt'))).toBe(false)
				expect(
					(yield* userB.run(
						['rev-parse', `refs/humanlayer/workspaces/${workspaceId}/workspace`],
						placementB.sourcePath,
					)).stdout.trim(),
				).toBe(secondPublished)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
		REAL_GIT_TEST_TIMEOUT,
	)

	it.effect(
		'refuses to adopt another user’s worktree at a shared path and leaves it untouched',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const userA = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'a',
				})
				const userB = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'b',
				})
				const placementA = yield* materializeUserPlacement({ user: userA, resolvedCommit: fixture.commit })
				const unpublishedA = yield* leaveUnpublishedWork({
					user: userA,
					targetPath: placementA.targetPath,
					label: 'a',
				})

				const sourceB = yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.prepare(repository),
				).pipe(Effect.provide(userB.cacheLayer()))
				const error = yield* Effect.flip(
					Effect.flatMap(ManagedRepositoryCache, (cache) =>
						cache.materialize({
							...repository,
							sourcePath: sourceB,
							targetPath: placementA.targetPath,
							branch,
							resolvedCommit: fixture.commit,
						}),
					).pipe(Effect.provide(userB.cacheLayer())),
				)
				expect(error).toMatchObject({ _tag: 'ManagedRepositoryCacheError', path: placementA.targetPath })
				expect(error.message).toContain('different checkout')
				expect((yield* userA.run(['rev-parse', 'HEAD'], placementA.targetPath)).stdout.trim()).toBe(
					unpublishedA,
				)
				expect(yield* fs.readFileString(path.join(placementA.targetPath, 'README.md'))).toBe('a uncommitted\n')
				expect(yield* fs.exists(path.join(placementA.targetPath, 'a-local-only.txt'))).toBe(true)
				expect((yield* userB.run(['worktree', 'list', '--porcelain'], sourceB)).stdout).not.toContain(
					placementA.targetPath,
				)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
		REAL_GIT_TEST_TIMEOUT,
	)

	it.effect(
		'fails visibly when the pinned commit is another user’s unpublished commit',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const userA = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'a',
				})
				const userB = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'b',
				})
				const placementA = yield* materializeUserPlacement({ user: userA, resolvedCommit: fixture.commit })
				const unpublishedA = yield* leaveUnpublishedWork({
					user: userA,
					targetPath: placementA.targetPath,
					label: 'a',
				})
				const targetB = path.join(userB.workspaceRoot, 'workspace')

				const sourceB = yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache
						.prepare(repository)
						.pipe(Effect.tap((sourcePath) => cache.refresh({ ...refresh, sourcePath }))),
				).pipe(Effect.provide(userB.cacheLayer()))
				const cacheError = yield* Effect.flip(
					Effect.flatMap(ManagedRepositoryCache, (cache) =>
						cache.materialize({
							...repository,
							sourcePath: sourceB,
							targetPath: targetB,
							branch,
							resolvedCommit: unpublishedA,
							workspaceId,
						}),
					).pipe(Effect.provide(userB.cacheLayer())),
				)
				expect(cacheError.message).toContain(`Pinned commit ${unpublishedA} is not available`)
				expect(cacheError.message).toContain('not transferred')
				expect(yield* fs.exists(targetB)).toBe(false)

				// The resolve stage of user B's actor parks with the same explanation.
				const initial = workspaceRepositorySnapshotAt('resolving_commit')
				const workspaceRepository = {
					...initial.repository,
					...repository,
					branch,
					baseCommit: unpublishedA,
				}
				const snapshot: WorkspaceRepositoryActorSnapshot = {
					...initial,
					repository: workspaceRepository,
					workspace: { ...initial.workspace, id: workspaceId, repositories: [workspaceRepository] },
					location: { ...initial.location, workspaceId, userId: 'user-b', filePath: targetB },
					status: {
						...initial.status,
						workspaceId,
						userId: 'user-b',
						repositoryIdentity: repository.repositoryIdentity,
						repositoryRemoteUrl: repository.remoteUrl,
						sourceKind: 'managed_clone',
						sourcePath: sourceB,
						resolvedCommit: null,
					},
					sourceCandidates: [],
				}
				const reported = yield* Ref.make<ReadonlyArray<string>>([])
				const api = Layer.succeed(
					DaemonApi,
					makeMockDaemonApi({
						reportWorkspaceRepositoryResult: (input) =>
							Ref.update(reported, (seen) => [
								...seen,
								input.result._tag === 'StageFailed'
									? `${input.result.stage}: ${input.result.error.message}`
									: input.result._tag,
							]).pipe(Effect.as({ snapshot })),
					}),
				)
				const actors = WorkspaceRepositoryActorOperationsLive.pipe(
					Layer.provideMerge(Layer.mergeAll(api, userB.cacheLayer())),
				)
				const parked = yield* Effect.flip(
					Effect.flatMap(WorkspaceRepositoryActorOperations, (actor) => actor.resolveCommit(snapshot)).pipe(
						Effect.provide(actors),
					),
				)
				expect(parked._tag).toBe('WorkspaceRepositoryParked')
				const [report] = yield* Ref.get(reported)
				expect(report).toContain('resolving_commit: Pinned base commit')
				expect(report).toContain(unpublishedA)
				expect(report).toContain('not transferred')
				expect(yield* fs.exists(targetB)).toBe(false)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
		REAL_GIT_TEST_TIMEOUT,
	)

	it.effect(
		'rejects diverged, incomplete, and primary checkouts without changing any files',
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeRealRepositoryCacheFixture()
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const userA = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'a',
				})
				const userB = yield* makeIsolatedRepositoryUserFixture({
					root: fixture.root,
					remote: fixture.remote,
					name: 'b',
				})
				const placementA = yield* materializeUserPlacement({ user: userA, resolvedCommit: fixture.commit })
				const placementB = yield* materializeUserPlacement({ user: userB, resolvedCommit: fixture.commit })
				const unpublishedA = yield* leaveUnpublishedWork({
					user: userA,
					targetPath: placementA.targetPath,
					label: 'a',
				})
				yield* leaveUnpublishedWork({ user: userB, targetPath: placementB.targetPath, label: 'b' })
				yield* Effect.flatMap(ManagedRepositoryCache, (cache) =>
					cache.publishBranch({
						...repository,
						sourcePath: placementB.sourcePath,
						materializationPath: placementB.targetPath,
						branch,
					}),
				).pipe(Effect.provide(userB.cacheLayer()))

				const materializeA = (input: {
					readonly targetPath: string
					readonly branch: string
					readonly workspaceId?: string
				}) =>
					Effect.flatMap(ManagedRepositoryCache, (cache) =>
						cache.refresh({ ...refresh, sourcePath: placementA.sourcePath }).pipe(
							Effect.andThen(
								cache.materialize({
									...repository,
									...input,
									sourcePath: placementA.sourcePath,
									resolvedCommit: fixture.commit,
								}),
							),
						),
					).pipe(Effect.provide(userA.cacheLayer()))

				const diverged = yield* Effect.flip(
					materializeA({ targetPath: placementA.targetPath, branch, workspaceId }),
				)
				expect(diverged.message).toContain('diverged')
				expect((yield* userA.run(['rev-parse', 'HEAD'], placementA.targetPath)).stdout.trim()).toBe(
					unpublishedA,
				)
				expect(yield* fs.readFileString(path.join(placementA.targetPath, 'README.md'))).toBe('a uncommitted\n')
				expect(yield* fs.exists(path.join(placementA.targetPath, 'b-committed.txt'))).toBe(false)

				const incompleteTarget = path.join(userA.workspaceRoot, 'incomplete')
				yield* userA.run(
					[
						'worktree',
						'add',
						'--no-checkout',
						'-b',
						'workspace-incomplete',
						incompleteTarget,
						fixture.commit,
					],
					placementA.sourcePath,
				)
				const incomplete = yield* Effect.flip(
					materializeA({ targetPath: incompleteTarget, branch: 'workspace-incomplete' }),
				)
				expect(incomplete.message).toContain('incomplete')
				expect(yield* fs.exists(path.join(incompleteTarget, 'README.md'))).toBe(false)

				const primary = yield* Effect.flip(materializeA({ targetPath: placementA.sourcePath, branch: 'main' }))
				expect(primary.message).toContain('primary repository checkout')
				expect((yield* userA.run(['branch', '--show-current'], placementA.sourcePath)).stdout.trim()).toBe(
					'main',
				)
			}).pipe(Effect.scoped, Effect.provide(RealRepositoryTestPlatform)),
		REAL_GIT_TEST_TIMEOUT,
	)
})
