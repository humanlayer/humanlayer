import {
	normalizeRepositoryIdentity,
	type WorkspaceRepositoryActorSnapshot,
} from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { Context, Data, Effect, FileSystem, Layer, Path, Predicate } from 'effect'

import { GitCommandFailedError } from '../task-diff/errors'
import { GitCommandRunner, type GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import { resolveWorkspacePath } from '../workspace-path-resolver/resolve-workspace-path'
import { WorkspaceRepositoryLocalOperationError } from './workspace-repository-local-operation-error'

type RepositorySourceCandidate = WorkspaceRepositoryActorSnapshot['sourceCandidates'][number]

export type RepositorySourceRejection = Data.TaggedEnum<{
	PathNotAbsolute: { readonly message: string }
	MissingPath: { readonly message: string }
	NotDirectory: { readonly message: string }
	NotGit: { readonly message: string }
	NotRepositoryRoot: { readonly message: string }
	RemoteMismatch: { readonly message: string }
}>
export const RepositorySourceRejection = Data.taggedEnum<RepositorySourceRejection>()

export type ReusableRepositorySourceResult = Data.TaggedEnum<{
	Reusable: { readonly source: RepositorySourceCandidate }
	Rejected: { readonly reason: RepositorySourceRejection }
	NoCandidate: {}
}>
export const ReusableRepositorySourceResult = Data.taggedEnum<ReusableRepositorySourceResult>()

export interface FindReusableRepositorySourceInput {
	readonly repositoryIdentity: string
	readonly sourceCandidates: ReadonlyArray<RepositorySourceCandidate>
}

class RepositorySourceInvalid extends Data.TaggedError('RepositorySourceInvalid')<{
	readonly reason: RepositorySourceRejection
}> {}

interface InspectRepositorySourceInput {
	readonly repositoryIdentity: string
	readonly candidate: RepositorySourceCandidate
}

const inspectCandidate = Effect.fn('repository_source.inspect_candidate')(function* (
	input: InspectRepositorySourceInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const git = yield* GitCommandRunner
	const configuredPath = input.candidate.sourcePath
	if (!path.isAbsolute(configuredPath) && configuredPath !== '~' && !configuredPath.startsWith('~/')) {
		return yield* new RepositorySourceInvalid({
			reason: RepositorySourceRejection.PathNotAbsolute({ message: 'Source path is not absolute' }),
		})
	}
	const sourcePath = yield* resolveWorkspacePath({ path: configuredPath })
	const gitOptions = { cwd: sourcePath, env: { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } }
	const stat = yield* fs.stat(sourcePath)
	if (stat.type !== 'Directory')
		return yield* new RepositorySourceInvalid({
			reason: RepositorySourceRejection.NotDirectory({ message: 'Source is not a directory' }),
		})
	const argv = ['rev-parse', '--show-toplevel']
	const topLevel = yield* git.run(argv, { ...gitOptions, okExitCodes: [0, 128] })
	if (topLevel.exitCode === 128) {
		if (/not a git repository|must be run in a work tree/i.test(topLevel.stderr))
			return yield* new RepositorySourceInvalid({
				reason: RepositorySourceRejection.NotGit({ message: 'Source is not a Git worktree' }),
			})
		return yield* new GitCommandFailedError({
			message: `Git command exited ${topLevel.exitCode}`,
			argv,
			exitCode: topLevel.exitCode,
			stderr: topLevel.stderr,
		})
	}
	const [sourceRoot, gitRoot] = yield* Effect.all([fs.realPath(sourcePath), fs.realPath(topLevel.stdout.trim())])
	if (sourceRoot !== gitRoot)
		return yield* new RepositorySourceInvalid({
			reason: RepositorySourceRejection.NotRepositoryRoot({ message: 'Source is not a repository root' }),
		})
	const remotes = yield* git.run(['remote'], gitOptions)
	for (const remote of remotes.stdout
		.trim()
		.split('\n')
		.filter((name) => name.length > 0)) {
		const urls = yield* git.run(['config', '--get-all', `remote.${remote}.url`], {
			...gitOptions,
			okExitCodes: [0, 1],
		})
		if (urls.stdout.split('\n').some((url) => normalizeRepositoryIdentity(url) === input.repositoryIdentity)) {
			return { ...input.candidate, sourcePath }
		}
	}
	return yield* new RepositorySourceInvalid({
		reason: RepositorySourceRejection.RemoteMismatch({ message: 'Source remote identity does not match' }),
	})
})

const findReusableSource = Effect.fn('repository_source.find_reusable_source')(function* (
	input: FindReusableRepositorySourceInput,
) {
	// The API supplies one configured source, followed by the deterministic managed fallback.
	let lastRejection: RepositorySourceRejection | undefined
	for (const candidate of input.sourceCandidates) {
		const source = yield* inspectCandidate({ repositoryIdentity: input.repositoryIdentity, candidate }).pipe(
			Effect.map((source) => ReusableRepositorySourceResult.Reusable({ source })),
			Effect.catchTag('PlatformError', (error) =>
				Effect.fail(error.reason).pipe(
					Effect.catchTags({
						NotFound: () =>
							Effect.logWarning('Repository source path no longer exists', error).pipe(
								Effect.as(
									ReusableRepositorySourceResult.Rejected({
										reason: RepositorySourceRejection.MissingPath({
											message: 'Source path does not exist',
										}),
									}),
								),
							),
						BadResource: () =>
							Effect.logWarning('Repository source path is not a directory', error).pipe(
								Effect.as(
									ReusableRepositorySourceResult.Rejected({
										reason: RepositorySourceRejection.NotDirectory({
											message: 'Source is not a directory',
										}),
									}),
								),
							),
					}),
					Effect.mapError(() => error),
				),
			),
			Effect.catchTag('RepositorySourceInvalid', (error) =>
				Effect.logWarning('Repository source candidate rejected', error).pipe(
					Effect.as(ReusableRepositorySourceResult.Rejected({ reason: error.reason })),
				),
			),
			Effect.tapError((error) =>
				Effect.logError('Repository source inspection failed', error).pipe(
					Effect.annotateLogs({ repository_identity: input.repositoryIdentity }),
					Effect.andThen(
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: {
									operation: 'repository_source.inspect_candidate',
									repository_identity: input.repositoryIdentity,
								},
							}),
						),
					),
				),
			),
			Effect.catchTag('PlatformError', (error) =>
				Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			),
			Effect.catchTag('GitCommandFailedError', (error) =>
				error.exitCode === 128 && /not a git repository|must be run in a work tree/i.test(error.stderr)
					? Effect.succeed(
							ReusableRepositorySourceResult.Rejected({
								reason: RepositorySourceRejection.NotGit({ message: 'Source is not a Git worktree' }),
							}),
						)
					: Effect.fail(
							new WorkspaceRepositoryLocalOperationError({
								message: error.message,
								command: error.argv.join(' '),
								exitCode: error.exitCode,
								stderr: error.stderr,
							}),
						),
			),
			Effect.catchTags({
				GitCommandIoError: (error) =>
					Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
				GitOutputLimitExceededError: (error) =>
					Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
				GitBinaryMissingError: (error) =>
					Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
				GitTimeoutError: (error) =>
					Effect.fail(
						new WorkspaceRepositoryLocalOperationError({
							message: error.message,
							command: error.argv.join(' '),
						}),
					),
				ConfigError: (error) =>
					Effect.fail(new WorkspaceRepositoryLocalOperationError({ message: error.message })),
			}),
		)
		if (Predicate.isTagged(source, 'Reusable')) return source
		lastRejection = source.reason
	}
	return lastRejection === undefined
		? ReusableRepositorySourceResult.NoCandidate()
		: ReusableRepositorySourceResult.Rejected({ reason: lastRejection })
})

export class RepositorySourceResolver extends Context.Service<
	RepositorySourceResolver,
	{
		readonly findReusableSource: (
			input: FindReusableRepositorySourceInput,
		) => Effect.Effect<
			ReusableRepositorySourceResult,
			WorkspaceRepositoryLocalOperationError,
			FileSystem.FileSystem | Path.Path | GitCommandRunner | GitCommandRunnerRequirements
		>
	}
>()('RepositorySourceResolver') {}

export const RepositorySourceResolverLive = Layer.succeed(RepositorySourceResolver, { findReusableSource })
