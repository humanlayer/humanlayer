import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Context, Effect, Layer } from 'effect'

import type { GithubRepoRef } from './github.types'

// node's execFile is the natively-ASYNC callback API (the child runs off-thread
// and completion is event-loop driven); promisify only converts callback→Promise.
// The blocking sibling, execFileSync, is never used here.
const execFileAsync = promisify(execFile)

/** Best-effort git probe timeout — a stuck repo must not stall the daemon. */
const GIT_COMMAND_TIMEOUT_MS = 10_000

/**
 * Parse `owner`/`repo` from a github.com remote URL — https (optionally with a
 * userinfo prefix) or ssh (`git@github.com:owner/repo`). Tolerates a trailing
 * `.git` and slash. Returns undefined for any non-github.com host, keeping the
 * token backend scoped to github.com exactly like the gh backend's URL parsing.
 */
export function parseGithubRemote(remoteUrl: string): GithubRepoRef | undefined {
	const url = remoteUrl.trim()
	const httpsMatch = url.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
	const sshMatch = url.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
	const match = httpsMatch ?? sshMatch
	if (!match) return undefined
	const [, owner, repo] = match
	if (!owner || !repo) return undefined
	return { owner, repo }
}

export interface GitCliService {
	/** Whether `dir` is inside a git worktree (best-effort; false on any failure). */
	isGitRepo: (args: { dir: string }) => Effect.Effect<boolean>
	/** Current branch, or undefined for a detached HEAD or on any failure. */
	currentBranch: (args: { dir: string }) => Effect.Effect<string | undefined>
	/**
	 * True when `branch` is the repo's default branch (resolved from the remote's own
	 * `origin/HEAD`) and thus never a PR head. Name-agnostic, so git-flow trunks
	 * (`develop`, `release/main`) are handled exactly like `main`/`master`. Purely an
	 * optimization — a repo whose default can't be resolved (no `origin/HEAD`) is
	 * treated as not-default and scanned anyway (`gh pr view` returns no PR harmlessly).
	 */
	isDefaultBranch: (args: { dir: string; branch: string }) => Effect.Effect<boolean>
	/**
	 * `owner`/`repo` from the repo's `origin` remote (github.com only); undefined on
	 * any git failure or a non-github.com remote. The gh backend gets this for free
	 * from gh's own remote resolution; the token backend needs it to address GraphQL.
	 */
	originOwnerRepo: (args: { dir: string }) => Effect.Effect<GithubRepoRef | undefined>
}

/**
 * Read-only git probes shared by the GitHub capture paths. Every operation is
 * best-effort with a `never` error channel — a broken/slow repo yields
 * false/undefined rather than failing the caller's scan.
 */
export class GitCli extends Context.Service<GitCli, GitCliService>()('GitCli') {}

/** Run a git subprocess and return stdout; undefined on non-zero exit / timeout / spawn failure. */
const git = (dir: string, args: string[]): Effect.Effect<string | undefined> =>
	Effect.promise(() =>
		execFileAsync('git', args, {
			cwd: dir,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			encoding: 'utf8',
		}).then(
			({ stdout }) => stdout,
			() => undefined,
		),
	).pipe(Effect.withSpan('git_cli.exec', { attributes: { 'git.args': args.join(' ') } }))

/**
 * The repo's default branch, from the remote's own `origin/HEAD` symbolic ref —
 * NOT a hardcoded name list. Name-agnostic: resolves `develop`, `release/main`,
 * or any default just as well as `main`/`master`. Best-effort: undefined when
 * `origin/HEAD` is not set locally (never cloned / `git remote set-head` never
 * run), so the caller does not skip. Strips the remote name
 * (`origin/release/main` → `release/main`).
 */
const defaultBranchShortName = (dir: string): Effect.Effect<string | undefined> =>
	git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).pipe(
		Effect.map((stdout) => {
			const ref = stdout?.trim()
			if (!ref) return undefined
			const slash = ref.indexOf('/')
			return slash >= 0 ? ref.slice(slash + 1) : undefined
		}),
	)

export const GitCliLive = Layer.succeed(GitCli, {
	isGitRepo: ({ dir }) => git(dir, ['rev-parse', '--git-dir']).pipe(Effect.map((out) => out !== undefined)),

	currentBranch: ({ dir }) =>
		git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).pipe(
			Effect.map((stdout) => {
				const branch = stdout?.trim()
				return branch && branch !== 'HEAD' ? branch : undefined
			}),
		),

	isDefaultBranch: ({ dir, branch }) =>
		defaultBranchShortName(dir).pipe(
			Effect.map((def) => def !== undefined && def.toLowerCase() === branch.toLowerCase()),
		),

	originOwnerRepo: ({ dir }) =>
		git(dir, ['remote', 'get-url', 'origin']).pipe(
			Effect.map((stdout) => (stdout !== undefined ? parseGithubRemote(stdout) : undefined)),
		),
})
