import { Effect, FileSystem } from 'effect'

import { WorkspacePathResolver } from '../workspace-path-resolver/workspace-path-resolver.service'
import { probeTargetWorktree } from './probe-target-worktree'
import { selectWorkspaceBranchRemote, workspaceRemoteFromRef } from './workspace-git-remote'
import { runCapturedWorkspaceProcessObserved } from './workspace-process-runner'
import { WorkspacePreflightError, type WorkspaceSetupExecutorErrorFields } from './workspace-setup-executor.errors'
import {
	observeWorkspaceSetupExecutorFailure,
	workspaceSetupOperationAttributes,
} from './workspace-setup-executor.observability'
import type { WorkspaceRepoOperationInput } from './workspace-setup-executor.types'

type MutableWorkspaceSetupExecutorErrorFields = {
	-readonly [Key in keyof WorkspaceSetupExecutorErrorFields]: WorkspaceSetupExecutorErrorFields[Key]
}

const stderrExcerpt = (stderr: string): string | undefined => {
	const trimmed = stderr.trim()
	return trimmed.length === 0 ? undefined : trimmed.slice(-4_000)
}

export const preflightWorkspaceRepository = (input: WorkspaceRepoOperationInput) => {
	const attributes = workspaceSetupOperationAttributes(input, 'preflight')
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const workspacePathResolver = yield* WorkspacePathResolver
		const sourceDirectory = yield* workspacePathResolver.resolveSourceDirectory({
			directory: input.directory,
			localPath: input.repo.localPath,
			singleRepositoryName: input.singleRepositoryName,
		})
		const targetDirectory = yield* workspacePathResolver.resolveTargetDirectory({
			targetPath: input.repo.targetPath,
		})
		const sourceExists = yield* fileSystem.exists(sourceDirectory).pipe(
			Effect.mapError(
				(cause) =>
					new WorkspacePreflightError({
						...input,
						localPath: input.repo.localPath,
						stage: 'preflight',
						message: 'Failed to inspect source repository',
						workingDirectory: sourceDirectory,
						cause,
					}),
			),
		)
		if (!sourceExists)
			return yield* Effect.fail(
				new WorkspacePreflightError({
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: `Source repository does not exist: ${sourceDirectory}`,
					workingDirectory: sourceDirectory,
				}),
			)

		const insideWorktree = yield* runCapturedWorkspaceProcessObserved({
			workspace: input,
			stage: 'preflight',
			command: 'git',
			args: ['rev-parse', '--is-inside-work-tree'],
			workingDirectory: sourceDirectory,
		})
		if (insideWorktree.exitCode !== 0 || insideWorktree.stdout.trim() !== 'true') {
			const error: MutableWorkspaceSetupExecutorErrorFields = {
				...input,
				localPath: input.repo.localPath,
				stage: 'preflight',
				message: 'Source directory is not a Git worktree',
				command: 'git rev-parse --is-inside-work-tree',
				workingDirectory: sourceDirectory,
				exitCode: insideWorktree.exitCode,
			}
			const excerpt = stderrExcerpt(insideWorktree.stderr)
			if (excerpt !== undefined) error.stderr = excerpt
			return yield* Effect.fail(new WorkspacePreflightError(error))
		}

		const configuredRemotes = yield* runCapturedWorkspaceProcessObserved({
			workspace: input,
			stage: 'preflight',
			command: 'git',
			args: ['remote'],
			workingDirectory: sourceDirectory,
		})
		if (configuredRemotes.exitCode !== 0) {
			return yield* Effect.fail(
				new WorkspacePreflightError({
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: 'Unable to list configured Git remotes',
					command: 'git remote',
					workingDirectory: sourceDirectory,
					exitCode: configuredRemotes.exitCode,
					stderr: stderrExcerpt(configuredRemotes.stderr),
				}),
			)
		}
		const remotes = configuredRemotes.stdout
			.split('\n')
			.map((remote) => remote.trim())
			.filter((remote) => remote.length > 0)
		const upstream = yield* runCapturedWorkspaceProcessObserved({
			workspace: input,
			stage: 'preflight',
			command: 'git',
			args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
			workingDirectory: sourceDirectory,
		})
		const branchRemote = selectWorkspaceBranchRemote({
			configuredBranchRemote: input.repo.branchRemote,
			sourceRef: input.repo.sourceRef,
			upstreamRef: upstream.exitCode === 0 ? upstream.stdout.trim() : undefined,
			remotes,
		})
		if (input.repo.branchRemote !== undefined && branchRemote === undefined) {
			return yield* Effect.fail(
				new WorkspacePreflightError({
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: `Configured branch remote does not exist: ${input.repo.branchRemote}`,
					command: 'git remote',
					workingDirectory: sourceDirectory,
				}),
			)
		}
		const sourceRemote = workspaceRemoteFromRef(input.repo.sourceRef, remotes)
		const remotesToFetch = [...new Set([sourceRemote, branchRemote].filter((remote) => remote !== undefined))]
		for (const remote of remotesToFetch) {
			const fetched = yield* runCapturedWorkspaceProcessObserved({
				workspace: input,
				stage: 'preflight',
				command: 'git',
				args: ['fetch', '--prune', remote],
				workingDirectory: sourceDirectory,
			})
			if (fetched.exitCode !== 0) {
				const error: MutableWorkspaceSetupExecutorErrorFields = {
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: `Failed to fetch Git remote: ${remote}`,
					command: `git fetch --prune ${remote}`,
					workingDirectory: sourceDirectory,
					exitCode: fetched.exitCode,
				}
				const excerpt = stderrExcerpt(fetched.stderr)
				if (excerpt !== undefined) error.stderr = excerpt
				return yield* Effect.fail(new WorkspacePreflightError(error))
			}
		}

		const targetExists = yield* fileSystem.exists(targetDirectory).pipe(
			Effect.mapError(
				(cause) =>
					new WorkspacePreflightError({
						...input,
						localPath: input.repo.localPath,
						stage: 'preflight',
						message: 'Failed to inspect target worktree path',
						workingDirectory: targetDirectory,
						cause,
					}),
			),
		)
		if (targetExists) {
			const probe = yield* probeTargetWorktree({
				workspace: input,
				stage: 'preflight',
				sourceDirectory,
				targetDirectory,
			})
			if (probe.match) {
				return branchRemote === undefined
					? { resolvedSourceCommit: probe.head }
					: { resolvedSourceCommit: probe.head, branchRemote }
			}
			return yield* Effect.fail(
				new WorkspacePreflightError({
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: probe.reason,
					workingDirectory: targetDirectory,
				}),
			)
		}

		const existingBranch = yield* runCapturedWorkspaceProcessObserved({
			workspace: input,
			stage: 'preflight',
			command: 'git',
			args: ['show-ref', '--verify', '--quiet', `refs/heads/${input.repo.branch}`],
			workingDirectory: sourceDirectory,
		})
		if (existingBranch.exitCode === 0) {
			const branchTip = yield* runCapturedWorkspaceProcessObserved({
				workspace: input,
				stage: 'preflight',
				command: 'git',
				args: ['rev-parse', '--verify', `refs/heads/${input.repo.branch}^{commit}`],
				workingDirectory: sourceDirectory,
			})
			if (branchTip.exitCode !== 0 || branchTip.stdout.trim().length === 0) {
				const error: MutableWorkspaceSetupExecutorErrorFields = {
					...input,
					localPath: input.repo.localPath,
					stage: 'preflight',
					message: `Unable to resolve existing branch: ${input.repo.branch}`,
					command: `git rev-parse --verify refs/heads/${input.repo.branch}^{commit}`,
					workingDirectory: sourceDirectory,
					exitCode: branchTip.exitCode,
				}
				const excerpt = stderrExcerpt(branchTip.stderr)
				if (excerpt !== undefined) error.stderr = excerpt
				return yield* Effect.fail(new WorkspacePreflightError(error))
			}
			return branchRemote === undefined
				? { resolvedSourceCommit: branchTip.stdout.trim() }
				: { resolvedSourceCommit: branchTip.stdout.trim(), branchRemote }
		}

		const sourceIdentity = input.repo.sourceCommit ?? input.repo.sourceRef
		const resolved = yield* runCapturedWorkspaceProcessObserved({
			workspace: input,
			stage: 'preflight',
			command: 'git',
			args: ['rev-parse', '--verify', `${sourceIdentity}^{commit}`],
			workingDirectory: sourceDirectory,
		})
		if (resolved.exitCode !== 0 || resolved.stdout.trim().length === 0) {
			const error: MutableWorkspaceSetupExecutorErrorFields = {
				...input,
				localPath: input.repo.localPath,
				stage: 'preflight',
				message:
					input.repo.sourceCommit === undefined
						? `Unable to resolve source ref: ${input.repo.sourceRef}`
						: `Unable to resolve recorded source commit: ${input.repo.sourceCommit}`,
				command: `git rev-parse --verify ${sourceIdentity}^{commit}`,
				workingDirectory: sourceDirectory,
				exitCode: resolved.exitCode,
			}
			const excerpt = stderrExcerpt(resolved.stderr)
			if (excerpt !== undefined) error.stderr = excerpt
			return yield* Effect.fail(new WorkspacePreflightError(error))
		}
		return branchRemote === undefined
			? { resolvedSourceCommit: resolved.stdout.trim() }
			: { resolvedSourceCommit: resolved.stdout.trim(), branchRemote }
	}).pipe(
		Effect.catchTag('WorkspaceProcessError', (error) =>
			Effect.fail(
				new WorkspacePreflightError({
					taskId: error.taskId,
					hostId: error.hostId,
					localPath: error.localPath,
					stage: 'preflight',
					message: error.message,
					command: error.command,
					workingDirectory: error.workingDirectory,
					exitCode: error.exitCode,
					stderr: error.stderr,
					stdoutLogPath: error.stdoutLogPath,
					stderrLogPath: error.stderrLogPath,
					cause: error.cause,
				}),
			),
		),
		Effect.tapError(observeWorkspaceSetupExecutorFailure),
		Effect.annotateLogs(attributes),
		Effect.withSpan('workspace_setup_executor.preflight_repo', { attributes }),
	)
}
