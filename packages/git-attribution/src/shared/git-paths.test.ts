import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { resetWedgedGitBreakerForTesting, resolveGitPaths } from './git-paths'

const sh = promisify(execFile)
const HANG_TIMEOUT_MS = 1_000

const tempDirs: string[] = []
afterEach(async () => {
	resetWedgedGitBreakerForTesting()
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * A fake `git` that logs every invocation and then hangs — the wedged-fsmonitor /
 * dead-network-filesystem shape. POSIX-only plumbing (extensionless sh script on PATH), so the
 * suite skips these on Windows; the breaker logic itself is platform-independent.
 */
async function makeHangingGit(): Promise<{ binDir: string; invocations: () => Promise<number> }> {
	const binDir = await mkdtemp(join(tmpdir(), 'git-paths-hangbin-'))
	tempDirs.push(binDir)
	const countFile = join(binDir, 'invocations')
	await writeFile(countFile, '')
	await writeFile(join(binDir, 'git'), `#!/bin/sh\necho run >> "${countFile}"\n/bin/sleep 30\n`)
	await chmod(join(binDir, 'git'), 0o755)
	return {
		binDir,
		invocations: async () => (await readFile(countFile, 'utf-8')).split('\n').filter(Boolean).length,
	}
}

describe.skipIf(process.platform === 'win32')('wedged-git breaker', () => {
	it('a kill-at-timeout trips the breaker: the next call inside the cooldown spawns NOTHING', async () => {
		const { binDir, invocations } = await makeHangingGit()
		const cwd = await mkdtemp(join(tmpdir(), 'git-paths-cwd-'))
		tempDirs.push(cwd)
		const priorPath = process.env.PATH
		process.env.PATH = binDir
		try {
			const t0 = Date.now()
			expect(await resolveGitPaths(cwd, { timeoutMs: HANG_TIMEOUT_MS })).toBeUndefined()
			expect(Date.now() - t0).toBeGreaterThanOrEqual(750) // paid the timeout once
			expect(await invocations()).toBe(1)

			const t1 = Date.now()
			expect(await resolveGitPaths(cwd, { timeoutMs: HANG_TIMEOUT_MS })).toBeUndefined()
			expect(Date.now() - t1).toBeLessThan(250) // breaker short-circuit, no spawn
			expect(await invocations()).toBe(1)
		} finally {
			process.env.PATH = priorPath
		}
	})

	it('the cooldown expires: a later call probes git again', async () => {
		const { binDir, invocations } = await makeHangingGit()
		const cwd = await mkdtemp(join(tmpdir(), 'git-paths-cwd-'))
		tempDirs.push(cwd)
		const priorPath = process.env.PATH
		process.env.PATH = binDir
		try {
			expect(await resolveGitPaths(cwd, { timeoutMs: HANG_TIMEOUT_MS })).toBeUndefined()
			expect(await invocations()).toBe(1)
			// A "now" past the cooldown re-probes (and re-trips, since git still hangs).
			expect(
				await resolveGitPaths(cwd, { timeoutMs: HANG_TIMEOUT_MS, nowMs: Date.now() + 120_000 }),
			).toBeUndefined()
			expect(await invocations()).toBe(2)
		} finally {
			process.env.PATH = priorPath
		}
	})

	it('fast failures do NOT trip the breaker — recovery is immediate', async () => {
		const emptyBin = await mkdtemp(join(tmpdir(), 'git-paths-emptybin-'))
		tempDirs.push(emptyBin)
		const repo = await mkdtemp(join(tmpdir(), 'git-paths-repo-'))
		tempDirs.push(repo)
		await sh('git', ['init', '-q', repo])
		const priorPath = process.env.PATH
		process.env.PATH = emptyBin
		try {
			expect(await resolveGitPaths(repo)).toBeUndefined() // no git on PATH: fast, uncached
		} finally {
			process.env.PATH = priorPath
		}
		// git is back (PATH restored): resolves right away, no cooldown in the way.
		const paths = await resolveGitPaths(repo)
		expect(paths?.gitDir).toContain(repo)
	})

	it('the breaker is per-cwd: one wedged worktree does not blind the others', async () => {
		const { binDir } = await makeHangingGit()
		const wedgedCwd = await mkdtemp(join(tmpdir(), 'git-paths-wedged-'))
		tempDirs.push(wedgedCwd)
		const priorPath = process.env.PATH
		process.env.PATH = binDir
		try {
			expect(await resolveGitPaths(wedgedCwd, { timeoutMs: HANG_TIMEOUT_MS })).toBeUndefined()
		} finally {
			process.env.PATH = priorPath
		}
		const healthyRepo = await mkdtemp(join(tmpdir(), 'git-paths-healthy-'))
		tempDirs.push(healthyRepo)
		await sh('git', ['init', '-q', healthyRepo])
		await mkdir(join(healthyRepo, 'sub'), { recursive: true })
		expect((await resolveGitPaths(healthyRepo))?.gitDir).toContain(healthyRepo)
	})
})
