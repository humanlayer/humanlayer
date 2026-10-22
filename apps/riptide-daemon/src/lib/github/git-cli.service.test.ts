import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { useHermeticGitConfig } from '@humanlayer/git-attribution/testing'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { GitCli, GitCliLive, type GitCliService, parseGithubRemote } from './git-cli.service'

const execFileAsync = promisify(execFile)

useHermeticGitConfig()

describe('parseGithubRemote', () => {
	test('parses an https remote, with or without a trailing .git', () => {
		expect(parseGithubRemote('https://github.com/humanlayer/syncopate.git')).toEqual({
			owner: 'humanlayer',
			repo: 'syncopate',
		})
		expect(parseGithubRemote('https://github.com/humanlayer/syncopate')).toEqual({
			owner: 'humanlayer',
			repo: 'syncopate',
		})
	})

	test('parses an https remote carrying a userinfo prefix (token-in-url)', () => {
		expect(parseGithubRemote('https://x-access-token:ghs_abc@github.com/owner/repo.git')).toEqual({
			owner: 'owner',
			repo: 'repo',
		})
	})

	test('parses scp-style and ssh:// remotes', () => {
		expect(parseGithubRemote('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
		expect(parseGithubRemote('ssh://git@github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
	})

	test('tolerates a trailing newline from git stdout', () => {
		expect(parseGithubRemote('https://github.com/owner/repo.git\n')).toEqual({ owner: 'owner', repo: 'repo' })
	})

	test('rejects non-github.com hosts (v1 is github.com-scoped)', () => {
		expect(parseGithubRemote('https://gitlab.com/owner/repo.git')).toBeUndefined()
		expect(parseGithubRemote('git@github.example.com:owner/repo.git')).toBeUndefined()
		expect(parseGithubRemote('https://github.example.com/owner/repo.git')).toBeUndefined()
		expect(parseGithubRemote('not a url')).toBeUndefined()
	})
})

describe('GitCliLive (real git repos)', () => {
	let baseDir: string
	let repoDir: string
	let plainDir: string
	let gitflowDir: string
	let noHeadDir: string

	const git = (cwd: string, args: string[]) => execFileAsync('git', args, { cwd, encoding: 'utf8' })

	const run = <A>(f: (gitCli: GitCliService) => Effect.Effect<A>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const gitCli = yield* GitCli
				return yield* f(gitCli)
			}).pipe(Effect.provide(GitCliLive)),
		)

	beforeAll(async () => {
		baseDir = await mkdtemp(join(tmpdir(), 'git-cli-service-'))
		repoDir = join(baseDir, 'repo')
		plainDir = join(baseDir, 'plain')
		gitflowDir = join(baseDir, 'gitflow')
		noHeadDir = join(baseDir, 'nohead')
		await execFileAsync('mkdir', ['-p', repoDir, plainDir, gitflowDir, noHeadDir])

		await git(repoDir, ['init', '-b', 'feature'])
		await git(repoDir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'])
		await git(repoDir, ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'])
		// Simulate a fetched origin/HEAD -> origin/trunk (a default branch that is NOT
		// main/master, proving we don't rely on a hardcoded name list).
		await git(repoDir, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
		await git(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])

		// Git-flow-style default with a slash in the name (origin/HEAD -> origin/release/main).
		await git(gitflowDir, ['init', '-b', 'feature/x'])
		await git(gitflowDir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'])
		await git(gitflowDir, ['update-ref', 'refs/remotes/origin/release/main', 'HEAD'])
		await git(gitflowDir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release/main'])

		// A repo with a remote but no origin/HEAD set (common: never cloned / set-head).
		await git(noHeadDir, ['init', '-b', 'main'])
		await git(noHeadDir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'])
		await git(noHeadDir, ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'])
	}, 30_000)

	afterAll(async () => {
		await rm(baseDir, { recursive: true, force: true })
	})

	test('isGitRepo distinguishes a repo from a plain directory', async () => {
		expect(await run((g) => g.isGitRepo({ dir: repoDir }))).toBe(true)
		expect(await run((g) => g.isGitRepo({ dir: plainDir }))).toBe(false)
	})

	test('currentBranch returns the checked-out branch, undefined for a plain dir', async () => {
		expect(await run((g) => g.currentBranch({ dir: repoDir }))).toBe('feature')
		expect(await run((g) => g.currentBranch({ dir: plainDir }))).toBeUndefined()
	})

	test('isDefaultBranch resolves the real default from origin/HEAD, name-agnostic', async () => {
		// The default here is `trunk`, not main/master: only the actual default matches.
		expect(await run((g) => g.isDefaultBranch({ dir: repoDir, branch: 'trunk' }))).toBe(true)
		expect(await run((g) => g.isDefaultBranch({ dir: repoDir, branch: 'main' }))).toBe(false)
		expect(await run((g) => g.isDefaultBranch({ dir: repoDir, branch: 'feature' }))).toBe(false)
	})

	test('isDefaultBranch handles a git-flow default with a slash (release/main)', async () => {
		expect(await run((g) => g.isDefaultBranch({ dir: gitflowDir, branch: 'release/main' }))).toBe(true)
		// A release/* branch that is NOT the default is a real PR head — must not be skipped.
		expect(await run((g) => g.isDefaultBranch({ dir: gitflowDir, branch: 'release/1.2' }))).toBe(false)
		expect(await run((g) => g.isDefaultBranch({ dir: gitflowDir, branch: 'main' }))).toBe(false)
	})

	test('isDefaultBranch returns false when origin/HEAD is unset (never skip, just scan)', async () => {
		// No static guess: even `main` is scanned, so a real PR from a main-named head
		// is never silently dropped. gh returns no-PR for the trunk harmlessly.
		expect(await run((g) => g.isDefaultBranch({ dir: noHeadDir, branch: 'main' }))).toBe(false)
	})

	test('originOwnerRepo parses the github.com origin remote', async () => {
		expect(await run((g) => g.originOwnerRepo({ dir: repoDir }))).toEqual({ owner: 'owner', repo: 'repo' })
		expect(await run((g) => g.originOwnerRepo({ dir: plainDir }))).toBeUndefined()
	})
})
