import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

/**
 * Git path resolution for the arm path (../session-attribution and the hooks-dir installer).
 * LEAF-ish module: node builtins only, and the only TS in this package that shells out to `git`
 * (the commit-time stamper is self-contained sh inside the hook).
 */

const sh = promisify(execFile)

export type GitPaths = {
	/** Worktree-PRIVATE git dir: `<repo>/.git` or `<repo>/.git/worktrees/<name>`. */
	readonly gitDir: string
	/**
	 * The repo's OWN hooks dir — its `core.hooksPath` from file config (husky) or
	 * `<git-dir>/hooks`. Deliberately not the EFFECTIVE dir: inside an armed session that would
	 * be our own state dir (see resolveGitPaths).
	 */
	readonly hooksDir: string
}

/**
 * The repo's git dir and its OWN hooks dir. Returns undefined when `cwd` is not inside a git
 * work tree (or git is not installed). Spawns are bounded: this runs on the arm path, and a hung
 * git (wedged fsmonitor, dead network filesystem) must never stall a session start.
 *
 * WEDGED-GIT BREAKER: a spawn that had to be KILLED at the timeout (hung fsmonitor, dead network
 * filesystem) marks the cwd wedged for {@link WEDGED_COOLDOWN_MS} and every call inside the
 * window returns undefined instantly. Without it, renewal — which runs per TOOL CALL — pays the
 * full timeout each time on a machine whose git is stuck: bounded and async, but a 10s zombie
 * process per tool call. Only kill-at-timeout trips it; fast failures (no git, not a repo) stay
 * uncached so recovery is immediate.
 */
const WEDGED_COOLDOWN_MS = 60_000
const wedgedUntilMs = new Map<string, number>()

/** Test seam: forget wedged-cwd cooldowns. */
export function resetWedgedGitBreakerForTesting(): void {
	wedgedUntilMs.clear()
}

export async function resolveGitPaths(
	cwd: string,
	options?: { readonly timeoutMs?: number; readonly nowMs?: number },
): Promise<GitPaths | undefined> {
	const nowMs = options?.nowMs ?? Date.now()
	const wedgedUntil = wedgedUntilMs.get(cwd)
	if (wedgedUntil !== undefined) {
		if (nowMs < wedgedUntil) return undefined
		wedgedUntilMs.delete(cwd)
	}
	try {
		// The caller may itself be running inside an ARMED session (the terminal carrier's arm runs
		// in the launcher-armed PTY), so `--git-path hooks` would answer with OUR OWN state hooks
		// dir and the self-healing repo listing would only ever see trampolines. Resolve the
		// repo's own hooksPath by SCOPE instead (`--show-scope` labels env entries `command`) —
		// the same trick the trampoline uses, and for the same reason it beats stripping the env:
		// a container's `safe.directory` arrives that way too, and stripping it breaks resolution
		// entirely.
		const { stdout } = await sh('git', ['rev-parse', '--is-inside-work-tree', '--absolute-git-dir'], {
			cwd,
			timeout: options?.timeoutMs ?? 10_000,
		})
		const [insideWorkTree, gitDir] = stdout.trim().split('\n')
		// `--absolute-git-dir` succeeds in a BARE repo too, where there is nothing to attribute.
		// Work-tree membership is the actual contract.
		if (insideWorkTree !== 'true' || !gitDir) return undefined
		const scoped = await sh('git', ['config', '--show-scope', '--get-all', 'core.hooksPath'], {
			cwd,
			timeout: options?.timeoutMs ?? 10_000,
		}).then(
			(r) => r.stdout,
			() => '',
		)
		const ownHooksPath = scoped
			.split('\n')
			.filter((line) => line.trim() !== '' && !line.startsWith('command'))
			.map((line) => line.slice(line.indexOf('\t') + 1))
			.at(-1)
		const hooksDir = ownHooksPath ? resolve(cwd, ownHooksPath) : resolve(gitDir, 'hooks')
		return { gitDir: resolve(gitDir), hooksDir }
	} catch (error) {
		if ((error as { killed?: boolean }).killed) {
			for (const [key, until] of wedgedUntilMs) {
				if (nowMs >= until) wedgedUntilMs.delete(key)
			}
			wedgedUntilMs.set(cwd, nowMs + WEDGED_COOLDOWN_MS)
		}
		return undefined
	}
}
