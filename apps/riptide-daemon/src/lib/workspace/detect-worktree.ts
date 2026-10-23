import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * True when `directory` sits inside a linked git worktree.
 *
 * `git rev-parse --git-dir` prints a path under `<main repo>/.git/worktrees/<name>`
 * for a linked worktree, and `.git` (or the absolute repo git dir) for the main
 * checkout. Callers use this to avoid telling the user to set up a worktree they
 * are already working in.
 */
export async function isInGitWorktree(directory: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: directory })
		return stdout.includes('/.git/worktrees/')
	} catch {
		return false
	}
}
