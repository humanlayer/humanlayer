import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { Effect, FileSystem, Path } from 'effect'

import { GitCommandRunner, type GitCommandOptions } from '../task-diff/git-command-runner.service'
import { ManagedRepositoryCacheError, type ManagedRepositoryInput } from './managed-repository-cache.service'
import { assertSafeRepositoryRemote } from './safe-repository-remote'

export interface RepositoryCheckoutInput extends ManagedRepositoryInput {
	readonly path: string
}

interface RepositoryGitCommandInput extends RepositoryCheckoutInput {
	readonly argv: ReadonlyArray<string>
	readonly options?: Omit<GitCommandOptions, 'cwd'>
}

export const observeRepositorySourceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.tapError((error) =>
			Effect.logError('Repository source operation failed', error).pipe(
				Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
			),
		),
	)

export const runRepositoryGit = Effect.fn('repository_source.run_git')(function* (input: RepositoryGitCommandInput) {
	const git = yield* GitCommandRunner
	return yield* git.run(input.argv, { ...input.options, cwd: input.path }).pipe(
		observeRepositorySourceFailure,
		Effect.catchTags({
			GitCommandIoError: (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
					}),
				),
			GitOutputLimitExceededError: (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
					}),
				),
			GitCommandFailedError: (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
						command: `git ${input.argv[0]}`,
						exitCode: error.exitCode,
						stderr: error.stderr,
					}),
				),
			GitTimeoutError: (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
						command: `git ${input.argv[0]}`,
					}),
				),
			GitBinaryMissingError: (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
						command: `git ${input.argv[0]}`,
					}),
				),
		}),
	)
})

export const selectedRepositoryRemote = Effect.fn('repository_source.selected_remote')(function* (
	input: RepositoryCheckoutInput,
) {
	yield* assertSafeRepositoryRemote(input).pipe(
		Effect.catchTag('RepositoryRemoteCredentialsRejected', (error) =>
			Effect.fail(
				new ManagedRepositoryCacheError({
					message: error.message,
					repositoryIdentity: input.repositoryIdentity,
					path: input.path,
				}),
			),
		),
	)
	if (normalizeRepositoryIdentity(input.remoteUrl) !== input.repositoryIdentity)
		return yield* new ManagedRepositoryCacheError({
			message: 'Project remote URL does not match repository identity',
			repositoryIdentity: input.repositoryIdentity,
			path: input.path,
		})
	const remotes = yield* runRepositoryGit({ ...input, argv: ['remote'] })
	let equivalent: string | undefined
	for (const remote of remotes.stdout
		.trim()
		.split('\n')
		.filter((name) => name.length > 0)) {
		const configured = yield* runRepositoryGit({
			...input,
			argv: ['config', '--get-all', `remote.${remote}.url`],
			options: { okExitCodes: [0, 1] },
		})
		const urls = configured.stdout.trim().split('\n')
		if (urls.includes(input.remoteUrl)) return remote
		if (
			equivalent === undefined &&
			urls.some((url) => normalizeRepositoryIdentity(url) === input.repositoryIdentity)
		)
			equivalent = remote
	}
	if (equivalent !== undefined) return equivalent
	return yield* new ManagedRepositoryCacheError({
		message: `Source checkout does not have the selected remote for ${input.repositoryIdentity}`,
		repositoryIdentity: input.repositoryIdentity,
		path: input.path,
	})
})

export const validateRepositoryRoot = Effect.fn('repository_source.validate_root')(function* (
	input: RepositoryCheckoutInput,
) {
	const fs = yield* FileSystem.FileSystem
	const topLevel = yield* runRepositoryGit({ ...input, argv: ['rev-parse', '--show-toplevel'] })
	const [sourceRoot, gitRoot] = yield* Effect.all([fs.realPath(input.path), fs.realPath(topLevel.stdout.trim())])
	if (sourceRoot !== gitRoot)
		return yield* new ManagedRepositoryCacheError({
			message: 'Source is not the repository root',
			repositoryIdentity: input.repositoryIdentity,
			path: input.path,
		})
	return input.path
})

export const validateRepositoryCheckout = Effect.fn('repository_source.validate_checkout')(function* (
	input: RepositoryCheckoutInput,
) {
	yield* validateRepositoryRoot(input)
	yield* selectedRepositoryRemote(input)
	return input.path
})

export const repositoryCheckoutIsDirty = Effect.fn('repository_source.checkout_is_dirty')(function* (
	input: RepositoryCheckoutInput,
) {
	const status = yield* runRepositoryGit({ ...input, argv: ['status', '--porcelain=v1', '--untracked-files=all'] })
	return status.stdout.length > 0
})

export const assertRepositoryCheckoutClean = Effect.fn('repository_source.assert_clean_checkout')(function* (
	input: RepositoryCheckoutInput,
) {
	if (yield* repositoryCheckoutIsDirty(input))
		return yield* new ManagedRepositoryCacheError({
			message: 'Existing worktree is dirty or incomplete; no files were changed',
			repositoryIdentity: input.repositoryIdentity,
			path: input.path,
		})
})

/**
 * A worktree whose index is empty while HEAD has tracked files never finished its
 * checkout (for example `git worktree add --no-checkout` or an interrupted add).
 * That is distinct from a dirty checkout, which is a user's work and is preserved.
 */
export const assertRepositoryCheckoutComplete = Effect.fn('repository_source.assert_complete_checkout')(function* (
	input: RepositoryCheckoutInput,
) {
	const indexed = yield* runRepositoryGit({ ...input, argv: ['ls-files', '-z'] })
	if (indexed.stdout.length > 0) return
	const tracked = yield* runRepositoryGit({ ...input, argv: ['ls-tree', '-r', '-z', '--name-only', 'HEAD'] })
	if (tracked.stdout.length === 0) return
	return yield* new ManagedRepositoryCacheError({
		message: 'Existing worktree is incomplete: its checkout never finished; no files were changed',
		repositoryIdentity: input.repositoryIdentity,
		path: input.path,
	})
})

interface RepositoryCommitInput extends RepositoryCheckoutInput {
	readonly commit: string
}

/**
 * Pinned commits only exist in this checkout when they were published to the
 * remote (or created here). Another user's or host's unpublished commits never
 * arrive, so the failure says so instead of surfacing a raw Git error.
 */
export const assertRepositoryCommitAvailable = Effect.fn('repository_source.assert_commit_available')(function* (
	input: RepositoryCommitInput,
) {
	const verified = yield* runRepositoryGit({
		...input,
		argv: ['rev-parse', '--verify', '--quiet', `${input.commit}^{commit}`],
		options: { okExitCodes: [0, 1] },
	})
	if (verified.exitCode === 0) return
	return yield* new ManagedRepositoryCacheError({
		message: `Pinned commit ${input.commit} is not available in this source checkout; commits that were never published to the remote are not transferred between users or hosts`,
		repositoryIdentity: input.repositoryIdentity,
		path: input.path,
	})
})

export const repositoryCommonDirectory = Effect.fn('repository_source.common_directory')(function* (
	input: RepositoryCheckoutInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* runRepositoryGit({ ...input, argv: ['rev-parse', '--git-common-dir'] })
	return yield* fs.realPath(path.resolve(input.path, directory.stdout.trim()))
})

export const repositoryGitDirectory = Effect.fn('repository_source.git_directory')(function* (
	input: RepositoryCheckoutInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const directory = yield* runRepositoryGit({ ...input, argv: ['rev-parse', '--git-dir'] })
	return yield* fs.realPath(path.resolve(input.path, directory.stdout.trim()))
})

/** Canonical paths of every worktree registered with the checkout's common Git directory. */
export const repositoryRegisteredWorktreePaths = Effect.fn('repository_source.registered_worktree_paths')(function* (
	input: RepositoryCheckoutInput,
) {
	const fs = yield* FileSystem.FileSystem
	const listed = yield* runRepositoryGit({ ...input, argv: ['worktree', 'list', '--porcelain'] })
	const registered = listed.stdout
		.split('\n')
		.filter((line) => line.startsWith('worktree '))
		.map((line) => line.slice('worktree '.length).trim())
	return yield* Effect.forEach(registered, (worktree) =>
		fs.realPath(worktree).pipe(Effect.orElseSucceed(() => worktree)),
	)
})
