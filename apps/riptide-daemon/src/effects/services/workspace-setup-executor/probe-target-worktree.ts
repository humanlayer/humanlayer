import { Effect, FileSystem } from 'effect'

import { runCapturedWorkspaceProcessObserved } from './workspace-process-runner'
import type { WorkspaceRepoOperationInput } from './workspace-setup-executor.types'

export type TargetWorktreeProbeInput = {
	readonly workspace: WorkspaceRepoOperationInput
	readonly stage: 'preflight' | 'worktree'
	readonly sourceDirectory: string
	readonly targetDirectory: string
}

export type TargetWorktreeProbeResult =
	| { readonly match: true; readonly head: string }
	| { readonly match: false; readonly reason: string }

/**
 * Decides whether an existing target directory is the task's own worktree: a Git
 * worktree of the same repository with the task's branch checked out. Git allows a
 * branch to be checked out in at most one worktree, so a full match cannot select
 * a directory that belongs to another task or repository.
 */
export const probeTargetWorktree = (input: TargetWorktreeProbeInput) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem
		const { sourceDirectory, targetDirectory } = input
		const expectedBranch = input.workspace.repo.branch
		const runGit = (args: readonly string[], workingDirectory: string) =>
			runCapturedWorkspaceProcessObserved({
				workspace: input.workspace,
				stage: input.stage,
				command: 'git',
				args,
				workingDirectory,
			})
		const nonMatch = (reason: string): TargetWorktreeProbeResult => ({ match: false, reason })

		const insideWorktree = yield* runGit(['rev-parse', '--is-inside-work-tree'], targetDirectory)
		if (insideWorktree.exitCode !== 0 || insideWorktree.stdout.trim() !== 'true')
			return nonMatch(`Target worktree path already exists and is not a git worktree: ${targetDirectory}`)

		const [targetCommonDir, sourceCommonDir] = yield* Effect.all([
			runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], targetDirectory),
			runGit(['rev-parse', '--path-format=absolute', '--git-common-dir'], sourceDirectory),
		])
		if (targetCommonDir.exitCode !== 0 || sourceCommonDir.exitCode !== 0)
			return nonMatch(
				`Target worktree path already exists but belongs to a different repository: ${targetDirectory}`,
			)
		// realPath both sides so symlinked mounts (e.g. macOS /var -> /private/var) compare equal
		const canonical = (value: string) => fileSystem.realPath(value).pipe(Effect.orElseSucceed(() => value))
		const [targetRepo, sourceRepo] = yield* Effect.all([
			canonical(targetCommonDir.stdout.trim()),
			canonical(sourceCommonDir.stdout.trim()),
		])
		if (targetRepo !== sourceRepo)
			return nonMatch(
				`Target worktree path already exists but belongs to a different repository: ${targetDirectory}`,
			)

		const currentBranch = yield* runGit(['branch', '--show-current'], targetDirectory)
		const branchName = currentBranch.stdout.trim()
		if (currentBranch.exitCode !== 0 || branchName !== expectedBranch)
			return nonMatch(
				branchName.length === 0
					? `Target worktree path already exists but is not on a branch (expected '${expectedBranch}'): ${targetDirectory}`
					: `Target worktree path already exists but is on branch '${branchName}' instead of '${expectedBranch}': ${targetDirectory}`,
			)

		const head = yield* runGit(['rev-parse', 'HEAD'], targetDirectory)
		const headCommit = head.stdout.trim()
		if (head.exitCode !== 0 || headCommit.length === 0)
			return nonMatch(
				`Target worktree path already exists but its commit could not be resolved: ${targetDirectory}`,
			)
		return { match: true, head: headCommit } satisfies TargetWorktreeProbeResult
	})
