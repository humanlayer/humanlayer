import { Effect, FileSystem, Path } from 'effect'

import { WorkspacePathResolver } from '../workspace-path-resolver/workspace-path-resolver.service'
import { probeTargetWorktree } from './probe-target-worktree'
import { selectWorkspaceBranchRemote, workspaceRemoteTrackingRef, workspaceUpstreamRef } from './workspace-git-remote'
import {
	renderWorkspaceCommand,
	runCapturedWorkspaceProcessObserved,
	type CapturedWorkspaceProcessResult,
} from './workspace-process-runner'
import { WorkspaceWorktreeError, type WorkspaceSetupExecutorErrorFields } from './workspace-setup-executor.errors'
import {
	observeWorkspaceSetupExecutorFailure,
	workspaceSetupOperationAttributes,
} from './workspace-setup-executor.observability'
import type { WorkspaceWorktreeFacts, WorkspaceWorktreeOperationInput } from './workspace-setup-executor.types'

type Mutable<T> = {
	-readonly [Key in keyof T]: T[Key]
}

const stderrExcerpt = (stderr: string): string | undefined => {
	const trimmed = stderr.trim()
	return trimmed.length === 0 ? undefined : trimmed.slice(-4_000)
}

export const createOrAdoptWorkspaceWorktree = (input: WorkspaceWorktreeOperationInput) => {
	const attributes = workspaceSetupOperationAttributes(input, 'worktree')
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const workspacePathResolver = yield* WorkspacePathResolver
		const sourceDirectory = yield* workspacePathResolver.resolveSourceDirectory({
			directory: input.directory,
			localPath: input.repo.localPath,
			singleRepositoryName: input.singleRepositoryName,
		})
		const targetDirectory = yield* workspacePathResolver.resolveTargetDirectory({
			targetPath: input.repo.targetPath,
		})
		const runGit = (args: readonly string[], workingDirectory = sourceDirectory) =>
			runCapturedWorkspaceProcessObserved({
				workspace: input,
				stage: 'worktree',
				command: 'git',
				args,
				workingDirectory,
				env: {
					GIT_TERMINAL_PROMPT: '0',
					GCM_INTERACTIVE: 'Never',
					SSH_ASKPASS_REQUIRE: 'never',
				},
				timeout: '5 minutes',
			})
		const failCommand = (
			message: string,
			args: readonly string[],
			result: CapturedWorkspaceProcessResult,
			workingDirectory = sourceDirectory,
		) => {
			const error: Mutable<WorkspaceSetupExecutorErrorFields> = {
				...input,
				localPath: input.repo.localPath,
				stage: 'worktree',
				message,
				command: renderWorkspaceCommand('git', args),
				workingDirectory,
				exitCode: result.exitCode,
			}
			const excerpt = stderrExcerpt(result.stderr)
			if (excerpt !== undefined) error.stderr = excerpt
			return Effect.fail(new WorkspaceWorktreeError(error))
		}

		const configuredRemotes = yield* runGit(['remote'])
		if (configuredRemotes.exitCode !== 0) {
			return yield* failCommand('Unable to list configured Git remotes', ['remote'], configuredRemotes)
		}
		const remotes = configuredRemotes.stdout
			.split('\n')
			.map((remote) => remote.trim())
			.filter((remote) => remote.length > 0)
		const upstream = yield* runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
		const branchRemote =
			input.branchRemote ??
			selectWorkspaceBranchRemote({
				configuredBranchRemote: input.repo.branchRemote,
				sourceRef: input.repo.sourceRef,
				upstreamRef: upstream.exitCode === 0 ? upstream.stdout.trim() : undefined,
				remotes,
			})
		if (branchRemote !== undefined && !remotes.includes(branchRemote)) {
			return yield* Effect.fail(
				new WorkspaceWorktreeError({
					...input,
					localPath: input.repo.localPath,
					stage: 'worktree',
					message: `Configured branch remote does not exist: ${branchRemote}`,
					command: 'git remote',
					workingDirectory: sourceDirectory,
				}),
			)
		}

		let remoteTrackingRef: string | undefined
		let remoteBranchExists = false
		if (branchRemote !== undefined) {
			const fetchArgs = ['fetch', '--prune', branchRemote]
			const fetched = yield* runGit(fetchArgs)
			if (fetched.exitCode !== 0) {
				return yield* failCommand(`Failed to fetch Git remote: ${branchRemote}`, fetchArgs, fetched)
			}
			remoteTrackingRef = workspaceRemoteTrackingRef(branchRemote, input.repo.branch)
			const remoteBranch = yield* runGit(['show-ref', '--verify', '--quiet', remoteTrackingRef])
			remoteBranchExists = remoteBranch.exitCode === 0
			if (remoteBranchExists) {
				const sourceBase = input.repo.sourceCommit ?? input.resolvedSourceCommit
				const ancestryArgs = ['merge-base', '--is-ancestor', sourceBase, remoteTrackingRef]
				const sourceIsAncestor = yield* runGit(ancestryArgs)
				if (sourceIsAncestor.exitCode !== 0) {
					return yield* failCommand(
						`Remote task branch does not contain the task source commit: ${workspaceUpstreamRef(branchRemote, input.repo.branch)}`,
						ancestryArgs,
						sourceIsAncestor,
					)
				}
			}
		}

		let adopted = false
		const targetExists = yield* fileSystem.exists(targetDirectory).pipe(
			Effect.mapError(
				(cause) =>
					new WorkspaceWorktreeError({
						...input,
						localPath: input.repo.localPath,
						stage: 'worktree',
						message: 'Failed to inspect target worktree path',
						workingDirectory: targetDirectory,
						cause,
					}),
			),
		)
		if (targetExists) {
			const probe = yield* probeTargetWorktree({
				workspace: input,
				stage: 'worktree',
				sourceDirectory,
				targetDirectory,
			})
			if (!probe.match) {
				return yield* Effect.fail(
					new WorkspaceWorktreeError({
						...input,
						localPath: input.repo.localPath,
						stage: 'worktree',
						message: probe.reason,
						workingDirectory: targetDirectory,
					}),
				)
			}
			adopted = true
		} else {
			yield* fileSystem.makeDirectory(pathService.dirname(targetDirectory), { recursive: true }).pipe(
				Effect.mapError(
					(cause) =>
						new WorkspaceWorktreeError({
							...input,
							localPath: input.repo.localPath,
							stage: 'worktree',
							message: 'Failed to create worktree parent directory',
							workingDirectory: targetDirectory,
							cause,
						}),
				),
			)
			const existingBranch = yield* runGit(['show-ref', '--verify', '--quiet', `refs/heads/${input.repo.branch}`])
			if (existingBranch.exitCode === 0) {
				yield* runGit(['worktree', 'prune'])
			}
			const args =
				existingBranch.exitCode === 0
					? ['worktree', 'add', targetDirectory, input.repo.branch]
					: remoteBranchExists && remoteTrackingRef !== undefined
						? ['worktree', 'add', '--track', '-b', input.repo.branch, targetDirectory, remoteTrackingRef]
						: ['worktree', 'add', '-b', input.repo.branch, targetDirectory, input.resolvedSourceCommit]
			const created = yield* runGit(args)
			if (created.exitCode !== 0) {
				return yield* failCommand('Failed to create Git worktree', args, created)
			}
		}

		let upstreamRef: string | undefined
		if (branchRemote !== undefined) {
			upstreamRef = workspaceUpstreamRef(branchRemote, input.repo.branch)
			if (remoteBranchExists && remoteTrackingRef !== undefined) {
				const localIsAncestor = yield* runGit(
					['merge-base', '--is-ancestor', `refs/heads/${input.repo.branch}`, remoteTrackingRef],
					targetDirectory,
				)
				const remoteIsAncestor = yield* runGit(
					['merge-base', '--is-ancestor', remoteTrackingRef, `refs/heads/${input.repo.branch}`],
					targetDirectory,
				)
				if (localIsAncestor.exitCode === 0 && remoteIsAncestor.exitCode !== 0) {
					const mergeArgs = ['merge', '--ff-only', remoteTrackingRef]
					const merged = yield* runGit(mergeArgs, targetDirectory)
					if (merged.exitCode !== 0) {
						return yield* failCommand(
							'Failed to fast-forward local task branch',
							mergeArgs,
							merged,
							targetDirectory,
						)
					}
				} else if (localIsAncestor.exitCode !== 0 && remoteIsAncestor.exitCode !== 0) {
					return yield* Effect.fail(
						new WorkspaceWorktreeError({
							...input,
							localPath: input.repo.localPath,
							stage: 'worktree',
							message: `Local and remote task branches have diverged: ${upstreamRef}`,
							workingDirectory: targetDirectory,
						}),
					)
				}
			}
		}

		const facts: Mutable<WorkspaceWorktreeFacts> = {
			targetPath: targetDirectory,
			adopted,
		}
		if (branchRemote !== undefined) {
			facts.remoteName = branchRemote
			const remote = yield* runGit(['remote', 'get-url', branchRemote])
			const remoteUrl = remote.stdout.trim()
			if (remote.exitCode === 0 && remoteUrl.length > 0) facts.remoteUrl = remoteUrl
		}
		if (upstreamRef !== undefined) facts.upstreamRef = upstreamRef
		return facts
	}).pipe(
		Effect.catchTag('WorkspaceProcessError', (error) =>
			Effect.fail(
				new WorkspaceWorktreeError({
					taskId: error.taskId,
					hostId: error.hostId,
					localPath: error.localPath,
					stage: 'worktree',
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
		Effect.withSpan('workspace_setup_executor.create_or_adopt_worktree', { attributes }),
	)
}
