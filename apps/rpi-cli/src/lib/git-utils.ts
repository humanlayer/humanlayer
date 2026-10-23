// @ts-nocheck - git-client types are incomplete, but the runtime API works as demonstrated
import { join } from 'node:path'

import git from 'git-client'

/**
 * Helper to create git options that properly isolate to a specific repo.
 * Uses both $gitDir and $workTree to fully isolate from parent repos.
 */
export function gitOpts(repoPath: string) {
	return {
		$gitDir: join(repoPath, '.git'),
		$workTree: repoPath,
	}
}

/**
 * Check if repo has uncommitted changes.
 * Replaces: execSync('git status --porcelain', { cwd: repoPath })
 */
export async function hasChanges(repoPath: string): Promise<boolean> {
	const status = await git.status({ porcelain: true, ...gitOpts(repoPath) })
	return status.trim().length > 0
}

/**
 * Get remote URL for origin.
 * Returns null if no remote configured.
 * Replaces: execSync('git remote get-url origin', { cwd: repoPath })
 */
export async function getRemoteUrl(repoPath: string): Promise<string | null> {
	const result = await git.remote('get-url', 'origin', {
		...gitOpts(repoPath),
		$nullOnError: true,
	})
	return result ? result.trim() : null
}

/**
 * Check if upstream tracking is configured.
 * Returns null if no upstream set.
 * Replaces: execSync('git rev-parse --abbrev-ref @{upstream}', { cwd: repoPath })
 */
export async function getUpstreamBranch(repoPath: string): Promise<string | null> {
	const result = await git('rev-parse', '--abbrev-ref', '@{upstream}', {
		...gitOpts(repoPath),
		$nullOnError: true,
	})
	return result ? result.trim() : null
}

/**
 * Stage all changes.
 * Replaces: execSync('git add -A', { cwd: repoPath })
 */
export async function stageAll(repoPath: string): Promise<void> {
	await git.add({ A: true, ...gitOpts(repoPath) })
}

/**
 * Create a commit with the given message.
 * Replaces: execFileSync('git', ['commit', '-m', message], { cwd: repoPath })
 */
export async function commit(repoPath: string, message: string): Promise<string> {
	return await git.commit({ m: message, ...gitOpts(repoPath) })
}

/**
 * Pull with rebase.
 * Returns true on success, throws on conflict.
 * Replaces: execSync('git pull --rebase', { cwd: repoPath })
 */
export async function pullRebase(repoPath: string): Promise<string> {
	try {
		return await git.pull({ rebase: true, ...gitOpts(repoPath) })
	} catch (error: unknown) {
		const errorStr = String(error)
		if (
			errorStr.includes('CONFLICT (') ||
			errorStr.includes('Automatic merge failed') ||
			errorStr.includes('Patch failed at')
		) {
			throw new Error('Merge conflict detected during rebase')
		}
		throw error
	}
}

/**
 * Push to remote with upstream tracking.
 * Replaces: execSync('git push -u origin main', { cwd: repoPath })
 */
export async function pushWithUpstream(repoPath: string, remote = 'origin', branch = 'main'): Promise<string> {
	return await git.push({ u: true, ...gitOpts(repoPath) }, remote, branch)
}

/**
 * Get list of staged files that match a directory prefix pattern.
 * Uses `git diff --cached --name-only` to get files staged for commit.
 * Replaces: execSync('git diff --cached --name-only', { cwd: repoPath })
 *
 * @param repoPath - Path to the git repository
 * @param tasksDirPrefix - Prefix to filter for task files (e.g., "tasks/")
 * @returns Array of staged file paths matching the prefix
 */
export async function getStagedTaskFiles(repoPath: string, tasksDirPrefix = ''): Promise<string[]> {
	try {
		const output = await git.diff({
			cached: true,
			'name-only': true,
			...gitOpts(repoPath),
		})

		const files = output
			.split('\n')
			.map((line: string) => line.trim())
			.filter((line: string) => line.length > 0)

		// Filter to only files in tasks directories
		// Pattern: {prefix}tasks/{issue-id}-.../
		// e.g., tasks/core-215-something/file.md
		const taskPattern = tasksDirPrefix
			? new RegExp(`^${tasksDirPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
			: /^tasks\//

		return files.filter((file: string) => taskPattern.test(file))
	} catch {
		return []
	}
}

/**
 * Get current git branch name.
 * Replaces: execSync('git branch --show-current', { cwd: repoPath })
 */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
	const result = await git.branch({
		'show-current': true,
		...gitOpts(repoPath),
		$nullOnError: true,
	})
	return result ? result.trim() : null
}

/**
 * Get the default branch for origin remote.
 * Uses fallback chain: symbolic-ref → show-ref main → show-ref master → 'main'
 * Returns string (never null) since there's always a fallback.
 */
export async function getRemoteDefaultBranch(repoPath: string): Promise<string> {
	// Try 1: Check symbolic-ref for origin/HEAD
	const symbolicRef = await git('symbolic-ref', 'refs/remotes/origin/HEAD', {
		...gitOpts(repoPath),
		$nullOnError: true,
	})

	if (symbolicRef) {
		// Parse "refs/remotes/origin/main" -> "main"
		const match = symbolicRef.trim().match(/refs\/remotes\/origin\/(.+)/)
		if (match) return match[1]
	}

	// Try 2: Check if origin/main exists
	const mainExists = await git('show-ref', '--verify', '--quiet', 'refs/remotes/origin/main', {
		...gitOpts(repoPath),
		$nullOnError: true,
	})
	if (mainExists !== null) return 'main'

	// Try 3: Check if origin/master exists
	const masterExists = await git('show-ref', '--verify', '--quiet', 'refs/remotes/origin/master', {
		...gitOpts(repoPath),
		$nullOnError: true,
	})
	if (masterExists !== null) return 'master'

	// Final fallback
	return 'main'
}
