import { Effect, FileSystem, Path, Predicate } from 'effect'

import { inspectExistingWorktreeForReuse } from './existing-worktree-reuse'
import {
	ManagedRepositoryCacheError,
	type MaterializeManagedRepositoryInput,
	type PublishManagedRepositoryBranchInput,
	type RefreshManagedRepositoryInput,
} from './managed-repository-cache.service'
import { RepositorySourceContext, workspaceRepositoryRefs } from './repository-source-context'
import {
	assertRepositoryCheckoutClean,
	assertRepositoryCommitAvailable,
	runRepositoryGit,
	selectedRepositoryRemote,
	validateRepositoryCheckout,
	validateRepositoryRoot,
} from './repository-source-git'

export const refreshRepositorySource = Effect.fn('repository_source.refresh')(function* (
	input: RefreshManagedRepositoryInput,
) {
	if (
		!Predicate.isString(input.workspaceId) ||
		input.workspaceId.trim().length === 0 ||
		input.workspaceId === 'undefined'
	)
		return yield* new ManagedRepositoryCacheError({
			message: 'Repository refresh requires a workspace ID',
			repositoryIdentity: input.repositoryIdentity,
			path: input.sourcePath,
		})
	const { gitEnvironment } = yield* RepositorySourceContext
	const source = { ...input, path: input.sourcePath }
	yield* validateRepositoryCheckout(source)
	const remote = yield* selectedRepositoryRemote(source)
	const refs = workspaceRepositoryRefs(input)
	const options = { env: gitEnvironment, nonInteractive: true }
	yield* runRepositoryGit({
		...source,
		argv: ['fetch', '--prune', '--no-tags', remote, `+refs/heads/${input.defaultBranch}:${refs.base}`],
		options,
	})
	const workspaceBranch = yield* runRepositoryGit({
		...source,
		argv: ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${input.workspaceBranch}`],
		options: { ...options, okExitCodes: [0, 2] },
	})
	if (workspaceBranch.exitCode === 0) {
		yield* runRepositoryGit({
			...source,
			argv: ['fetch', '--no-tags', remote, `+refs/heads/${input.workspaceBranch}:${refs.workspace}`],
			options,
		})
	} else {
		yield* runRepositoryGit({ ...source, argv: ['update-ref', '-d', refs.workspace] })
	}
	return input.sourcePath
})

export const materializeRepositorySource = Effect.fn('repository_source.materialize')(function* (
	input: MaterializeManagedRepositoryInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const source = { ...input, path: input.sourcePath }
	const target = { ...input, path: input.targetPath }
	yield* validateRepositoryCheckout(source)
	let selectedCommit = input.resolvedCommit
	if (input.workspaceId !== undefined) {
		const refs = workspaceRepositoryRefs({ workspaceId: input.workspaceId })
		const remoteBranch = yield* runRepositoryGit({
			...source,
			argv: ['show-ref', '--verify', '--quiet', refs.workspace],
			options: { okExitCodes: [0, 1] },
		})
		if (remoteBranch.exitCode === 0) {
			const containsBase = yield* runRepositoryGit({
				...source,
				argv: ['merge-base', '--is-ancestor', input.resolvedCommit, refs.workspace],
				options: { okExitCodes: [0, 1] },
			})
			if (containsBase.exitCode !== 0)
				return yield* new ManagedRepositoryCacheError({
					message: 'Remote workspace branch does not contain the pinned base commit',
					repositoryIdentity: input.repositoryIdentity,
					path: input.sourcePath,
				})
			const resolved = yield* runRepositoryGit({
				...source,
				argv: ['rev-parse', '--verify', `${refs.workspace}^{commit}`],
			})
			selectedCommit = resolved.stdout.trim()
		}
	}
	yield* assertRepositoryCommitAvailable({ ...source, commit: selectedCommit })
	if (yield* fs.exists(input.targetPath)) {
		const existing = yield* inspectExistingWorktreeForReuse({ ...input, selectedCommit })
		const annotations = {
			repository_identity: input.repositoryIdentity,
			target_path: input.targetPath,
			head: existing.head,
			selected_commit: selectedCommit,
		}
		if (existing.relation === 'behind' && !existing.dirty) {
			// Same fast-forward legacy recovery performs; only published history moves the branch.
			yield* runRepositoryGit({ ...target, argv: ['merge', '--ff-only', selectedCommit] })
		} else if (existing.relation === 'behind') {
			yield* Effect.logWarning(
				'Existing worktree is behind the selected workspace commit but has uncommitted changes; reused without fast-forward',
			).pipe(Effect.annotateLogs(annotations))
		} else if (existing.relation === 'ahead' || existing.dirty) {
			yield* Effect.logInfo('Reusing existing worktree with this owner’s unpublished work').pipe(
				Effect.annotateLogs({ ...annotations, dirty: existing.dirty, relation: existing.relation }),
			)
		}
	} else {
		yield* fs.makeDirectory(path.dirname(input.targetPath), { recursive: true })
		if (input.sourceKind !== 'filesystem') yield* runRepositoryGit({ ...source, argv: ['worktree', 'prune'] })
		const branchExists = yield* runRepositoryGit({
			...source,
			argv: ['show-ref', '--verify', '--quiet', `refs/heads/${input.branch}`],
			options: { okExitCodes: [0, 1] },
		})
		if (branchExists.exitCode === 0) {
			const local = yield* runRepositoryGit({
				...source,
				argv: ['rev-parse', '--verify', `refs/heads/${input.branch}^{commit}`],
			})
			if (local.stdout.trim() !== selectedCommit) {
				const fastForward = yield* runRepositoryGit({
					...source,
					argv: ['merge-base', '--is-ancestor', local.stdout.trim(), selectedCommit],
					options: { okExitCodes: [0, 1] },
				})
				if (fastForward.exitCode !== 0)
					return yield* new ManagedRepositoryCacheError({
						message: 'Local workspace branch cannot be fast-forwarded to the selected remote',
						repositoryIdentity: input.repositoryIdentity,
						path: input.sourcePath,
					})
				// Git refuses branch -f when checked out in any linked worktree; never reset a user's checkout.
				yield* runRepositoryGit({ ...source, argv: ['branch', '-f', input.branch, selectedCommit] })
			}
			yield* runRepositoryGit({ ...source, argv: ['worktree', 'add', input.targetPath, input.branch] })
		} else {
			yield* runRepositoryGit({
				...source,
				argv: ['worktree', 'add', '-b', input.branch, input.targetPath, selectedCommit],
			})
		}
		yield* validateRepositoryRoot(target)
		yield* assertRepositoryCheckoutClean(target)
	}
	return { kind: 'worktree', path: input.targetPath, branch: input.branch } as const
})

export const publishRepositoryBranch = Effect.fn('repository_source.publish_branch')(function* (
	input: PublishManagedRepositoryBranchInput,
) {
	const { gitEnvironment } = yield* RepositorySourceContext
	const remote = yield* selectedRepositoryRemote({ ...input, path: input.sourcePath ?? input.materializationPath })
	yield* runRepositoryGit({
		...input,
		path: input.materializationPath,
		argv: ['push', '--set-upstream', remote, `HEAD:refs/heads/${input.branch}`],
		options: { env: gitEnvironment, nonInteractive: true },
	})
})
