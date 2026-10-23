import { Effect, FileSystem } from 'effect'

import { ManagedRepositoryCacheError, type ManagedRepositoryInput } from './managed-repository-cache.service'
import {
	assertRepositoryCheckoutComplete,
	repositoryCheckoutIsDirty,
	repositoryCommonDirectory,
	repositoryGitDirectory,
	repositoryRegisteredWorktreePaths,
	runRepositoryGit,
	selectedRepositoryRemote,
	validateRepositoryRoot,
} from './repository-source-git'

export interface InspectExistingWorktreeInput extends ManagedRepositoryInput {
	readonly sourcePath: string
	readonly targetPath: string
	readonly branch: string
	readonly selectedCommit: string
}

/**
 * How the existing worktree's HEAD relates to the commit this placement selected:
 * `same` is identical, `ahead` carries this owner's unpublished commits on top of
 * it, and `behind` is an ancestor that can be fast-forwarded.
 */
export type ExistingWorktreeHeadRelation = 'same' | 'ahead' | 'behind'

export interface ReusableWorktree {
	readonly head: string
	readonly dirty: boolean
	readonly relation: ExistingWorktreeHeadRelation
}

/**
 * Decides whether a directory already at the target path is this daemon's own
 * worktree for the workspace branch, in this order:
 *
 * 1. path: it is a repository root and a linked worktree, not a primary checkout;
 * 2. common Git directory: it shares the source checkout's common directory and is
 *    registered there under this exact path;
 * 3. identity: its remotes resolve to the workspace repository identity;
 * 4. branch: the portable workspace branch is checked out and the checkout finished;
 * 5. history: HEAD equals, descends from, or precedes the selected commit.
 *
 * Every rejection leaves the directory untouched. Another user's checkout has its
 * own common directory, so it can never pass; this is what keeps unpublished
 * commits, uncommitted changes, and local-only files from moving between users.
 * A dirty checkout is the user's work and is reused, not reset.
 */
export const inspectExistingWorktreeForReuse = Effect.fn('repository_source.inspect_existing_worktree')(function* (
	input: InspectExistingWorktreeInput,
) {
	const fs = yield* FileSystem.FileSystem
	const source = { ...input, path: input.sourcePath }
	const target = { ...input, path: input.targetPath }
	const reject = (message: string) =>
		new ManagedRepositoryCacheError({
			message,
			repositoryIdentity: input.repositoryIdentity,
			path: input.targetPath,
		})

	yield* validateRepositoryRoot(target)
	const [targetRealPath, sourceCommonDirectory, targetCommonDirectory, targetGitDirectory] = yield* Effect.all([
		fs.realPath(input.targetPath),
		repositoryCommonDirectory(source),
		repositoryCommonDirectory(target),
		repositoryGitDirectory(target),
	])
	if (targetGitDirectory === targetCommonDirectory)
		return yield* reject(
			'Existing path is a primary repository checkout, not a workspace worktree; no files were changed',
		)
	if (sourceCommonDirectory !== targetCommonDirectory)
		return yield* reject(
			`Existing worktree belongs to a different checkout of ${input.repositoryIdentity} and was not adopted; no files were changed`,
		)
	const registered = yield* repositoryRegisteredWorktreePaths(source)
	if (!registered.includes(targetRealPath))
		return yield* reject('Existing worktree is not registered with the source checkout; no files were changed')
	yield* selectedRepositoryRemote(target)

	const branch = yield* runRepositoryGit({ ...target, argv: ['branch', '--show-current'] })
	const currentBranch = branch.stdout.trim()
	if (currentBranch !== input.branch)
		return yield* reject(
			currentBranch.length === 0
				? `Existing worktree is not on a branch (expected '${input.branch}'); no files were changed`
				: `Existing worktree is on branch '${currentBranch}' instead of '${input.branch}'; no files were changed`,
		)
	yield* assertRepositoryCheckoutComplete(target)

	const head = (yield* runRepositoryGit({ ...target, argv: ['rev-parse', 'HEAD'] })).stdout.trim()
	const relation = yield* existingWorktreeHeadRelation({ ...target, head })
	if (relation === undefined)
		return yield* reject(
			`Existing worktree branch '${input.branch}' has diverged from the selected workspace commit; no files were changed`,
		)
	const dirty = yield* repositoryCheckoutIsDirty(target)
	return { head, dirty, relation } satisfies ReusableWorktree
})

interface ExistingWorktreeHeadRelationInput extends InspectExistingWorktreeInput {
	readonly path: string
	readonly head: string
}

const existingWorktreeHeadRelation = Effect.fn('repository_source.existing_worktree_head_relation')(function* (
	input: ExistingWorktreeHeadRelationInput,
) {
	if (input.head === input.selectedCommit) return 'same' as const
	const selectedIsAncestor = yield* runRepositoryGit({
		...input,
		argv: ['merge-base', '--is-ancestor', input.selectedCommit, input.head],
		options: { okExitCodes: [0, 1] },
	})
	if (selectedIsAncestor.exitCode === 0) return 'ahead' as const
	const headIsAncestor = yield* runRepositoryGit({
		...input,
		argv: ['merge-base', '--is-ancestor', input.head, input.selectedCommit],
		options: { okExitCodes: [0, 1] },
	})
	return headIsAncestor.exitCode === 0 ? ('behind' as const) : undefined
})
