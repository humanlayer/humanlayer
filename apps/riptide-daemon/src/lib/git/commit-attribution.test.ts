import { execFile } from 'node:child_process'
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
	commitReportsSession,
	parseSessionFromTrailer,
	sessionCommitUrl,
	useHermeticGitConfig,
} from '@humanlayer/git-attribution/testing'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { orgTelemetryCache } from '@/lib/org-telemetry-settings'

import { commitAttributionEnv, isCommitAttributionEnabled } from './commit-attribution'

// Isolate every `git` call below from the developer's global/system gitconfig (see the helper).
useHermeticGitConfig()

// The write side lives in the state dir (the env-hosted hooks dir) — pin it per suite run so
// arming never touches the developer's real ~/.humanlayer.
let stateDir: string
let priorStateDir: string | undefined
beforeAll(async () => {
	priorStateDir = process.env.RIPTIDE_STATE_DIR
	stateDir = await mkdtemp(join(tmpdir(), 'commit-attribution-state-'))
	process.env.RIPTIDE_STATE_DIR = stateDir
})
afterAll(async () => {
	if (priorStateDir === undefined) delete process.env.RIPTIDE_STATE_DIR
	else process.env.RIPTIDE_STATE_DIR = priorStateDir
	await rm(stateDir, { recursive: true, force: true })
})

const sh = promisify(execFile)
const fileExists = (path: string) =>
	access(path).then(
		() => true,
		() => false,
	)
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) =>
	sh('git', args, { cwd, env: env ?? process.env }).then((r) => r.stdout.trim())

// Both origins are pinned in vitest.config.ts, so the assertions below hold whatever the
// developer's env carries — and the two stay distinguishable.
const APP_ORIGIN = 'https://app.vitest.test'
const CLOUD_ORIGIN = 'https://cloud.vitest.test'
const SESSION_ID = '018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f'

const tempDirs: string[] = []

async function makeRepo(): Promise<string> {
	// realpath: Windows tmpdir() hands out the DOS 8.3 short form while git reports long-form paths.
	const dir = await realpath(await mkdtemp(join(tmpdir(), 'commit-attribution-repo-')))
	tempDirs.push(dir)
	await git(dir, ['init', '-q'])
	await git(dir, ['config', 'user.email', 'dev@example.com'])
	await git(dir, ['config', 'user.name', 'Dev'])
	await writeFile(join(dir, 'seed.txt'), 'seed\n')
	await git(dir, ['add', '.'])
	await git(dir, ['commit', '-q', '-m', 'seed'])
	return dir
}

/** Full commit message body for a ref (the trailer block lives here). */
const bodyOf = (repo: string, ref: string, env?: NodeJS.ProcessEnv) =>
	git(repo, ['show', '-s', '--format=%b', ref], env)

describe('daemon commit attribution (env-hosted hooks)', () => {
	beforeEach(() => {
		orgTelemetryCache.set({ commitTrackingEnabled: true, prTrackingEnabled: false })
	})

	afterEach(async () => {
		orgTelemetryCache.reset()
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
	})

	it('is OFF with the org opt-in unset: no env, no hook', async () => {
		orgTelemetryCache.reset()
		const repo = await makeRepo()

		expect(isCommitAttributionEnabled()).toBe(false)
		expect(await commitAttributionEnv(SESSION_ID, { cwd: repo })).toEqual({})
		expect(await fileExists(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(false)
		expect(await fileExists(join(repo, '.git', 'humanlayer-session'))).toBe(false)
	})

	it('the org opt-in is the whole gate', () => {
		orgTelemetryCache.set({ commitTrackingEnabled: true, prTrackingEnabled: false })
		expect(isCommitAttributionEnabled()).toBe(true)
		orgTelemetryCache.set({ commitTrackingEnabled: false, prTrackingEnabled: false })
		expect(isCommitAttributionEnabled()).toBe(false)
	})

	it('arms with session env + env-scoped git config; the repo itself is untouched', async () => {
		const repo = await makeRepo()

		const attrEnv = await commitAttributionEnv(SESSION_ID, { cwd: repo })

		expect(attrEnv.HUMANLAYER_SESSION_ID).toBe(SESSION_ID)
		// The trailer deep-links into riptide-ui, the only host where /sessions/<id> resolves.
		expect(attrEnv.HUMANLAYER_SESSION_URL).toBe(sessionCommitUrl(APP_ORIGIN, SESSION_ID))
		expect(attrEnv.HUMANLAYER_SESSION_URL).not.toContain(CLOUD_ORIGIN)
		// The stamper is env-hosted: git config entries reference OUR state dir (mode depends on
		// the installed git's capability — hooksPath shadowing or additive config hooks).
		expect(attrEnv.GIT_CONFIG_COUNT).toBeDefined()
		expect(attrEnv.GIT_CONFIG_KEY_0).toMatch(/^(core\.hooksPath|hook\.humanlayer-attribution\.event)$/)
		// The PATH-shim era is over, and NOTHING is written into the user's repository.
		expect(attrEnv.PATH).toBeUndefined()
		expect(await fileExists(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(false)
		// The identity trio is complete: the stamper needs nothing beyond this env.
		expect(attrEnv.HUMANLAYER_SESSION_EXPIRES).toMatch(/^\d+$/)
		expect(Number(attrEnv.HUMANLAYER_SESSION_EXPIRES) * 1000).toBeGreaterThan(Date.now())
	})

	it('stamps the trailer on the agent commit only; author, committer, and signing all untouched', async () => {
		const repo = await makeRepo()
		const attrEnv = await commitAttributionEnv(SESSION_ID, { cwd: repo })
		const agentEnv = { ...process.env, ...attrEnv }

		// (1) HUMAN commit — plain git, none of the attribution env => no trailer.
		await writeFile(join(repo, 'human.txt'), 'human work\n')
		await git(repo, ['add', '.'])
		await git(repo, ['commit', '-q', '-m', 'human: unrelated'])
		const humanSha = await git(repo, ['rev-parse', 'HEAD'])

		// (2) AGENT commit — the process env carries the session identity => stamped.
		await writeFile(join(repo, 'agent.txt'), 'agent work\n')
		await git(repo, ['add', '.'], agentEnv)
		await git(repo, ['commit', '-q', '-m', 'agent: did the thing'], agentEnv)
		const agentSha = await git(repo, ['rev-parse', 'HEAD'], agentEnv)

		expect(commitReportsSession(await bodyOf(repo, agentSha, agentEnv), SESSION_ID)).toBe(true)
		expect(commitReportsSession(await bodyOf(repo, humanSha), SESSION_ID)).toBe(false)
		expect(parseSessionFromTrailer(await bodyOf(repo, agentSha, agentEnv))).toBe(SESSION_ID)

		// The human stays BOTH author and committer on the agent commit — only the trailer marks it.
		const idents = await git(repo, ['show', '-s', '--format=%an|%ae|%cn|%ce', agentSha], agentEnv)
		expect(idents).toBe('Dev|dev@example.com|Dev|dev@example.com')
	})

	it('covers commits the old PATH shim could not: a merge commit made by porcelain', async () => {
		const repo = await makeRepo()
		const attrEnv = await commitAttributionEnv(SESSION_ID, { cwd: repo })
		const agentEnv = { ...process.env, ...attrEnv }

		// Build a divergence so the merge is a REAL merge commit (--no-ff on a side branch).
		await git(repo, ['checkout', '-q', '-b', 'feature'], agentEnv)
		await writeFile(join(repo, 'feature.txt'), 'feature\n')
		await git(repo, ['add', '.'], agentEnv)
		await git(repo, ['commit', '-q', '-m', 'feature work'], agentEnv)
		await git(repo, ['checkout', '-q', '-'], agentEnv)
		await git(repo, ['merge', '--no-ff', '-q', '-m', 'merge feature', 'feature'], agentEnv)

		// `git merge` never runs `git commit` (the argv the shim keyed on), but it DOES run the
		// prepare-commit-msg hook — this is the 5-of-24 ground-truth coverage hole, closed.
		const body = await bodyOf(repo, 'HEAD', agentEnv)
		expect(commitReportsSession(body, SESSION_ID)).toBe(true)
	})

	it('is idempotent across amend: the session trailer is not duplicated', async () => {
		const repo = await makeRepo()
		const attrEnv = await commitAttributionEnv(SESSION_ID, { cwd: repo })
		const agentEnv = { ...process.env, ...attrEnv }

		await writeFile(join(repo, 'a.txt'), 'a\n')
		await git(repo, ['add', '.'], agentEnv)
		await git(repo, ['commit', '-q', '-m', 'agent work'], agentEnv)
		const firstSha = await git(repo, ['rev-parse', 'HEAD'], agentEnv)

		await writeFile(join(repo, 'a.txt'), 'a changed\n')
		await git(repo, ['add', '.'], agentEnv)
		await git(repo, ['commit', '-q', '--amend', '--no-edit'], agentEnv)
		const amendedSha = await git(repo, ['rev-parse', 'HEAD'], agentEnv)

		expect(amendedSha).not.toBe(firstSha)
		const body = await bodyOf(repo, amendedSha, agentEnv)
		const trailerLines = body.split('\n').filter((line) => /^HumanLayer-Session:/i.test(line))
		expect(trailerLines).toHaveLength(1)
	})

	it('arms husky repos too (env config shadows core.hooksPath) without touching the tracked dir', async () => {
		const repo = await makeRepo()
		await git(repo, ['config', 'core.hooksPath', '.husky'])

		const attrEnv = await commitAttributionEnv(SESSION_ID, { cwd: repo })

		expect(attrEnv.HUMANLAYER_SESSION_ID).toBe(SESSION_ID)
		expect(attrEnv.GIT_CONFIG_COUNT).toBeDefined()
		expect(await fileExists(join(repo, '.husky', 'prepare-commit-msg'))).toBe(false)
	})
})
