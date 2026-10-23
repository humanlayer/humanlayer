import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { useHermeticGitConfig } from '../../git-test-env'
import { armSessionAttribution, armSessionHooks, ATTRIBUTION_HEALTH_FILE } from '../../session-attribution'
import {
	CONFIG_STAMPER_NAME,
	ensureSessionHooksDir,
	ENV_HOOK_MARKER,
	FORWARDED_HOOKS,
	gitConfigHooksEnv,
	resetConfigHooksSupportForTesting,
	sessionHooksDir,
	supportsConfigHooks,
} from './session-hooks-dir'
import {
	commitReportsSession,
	parseSessionFromTrailer,
	SESSION_TRAILER_TOKEN,
	sessionCommitUrl,
} from './session-trailer'

// Isolate every `git` call below from the developer's global/system gitconfig (see the helper).
useHermeticGitConfig()

// The whole write side lives in the state dir now (the hooks dir) — pin it per suite run so
// the suite never touches the developer's real ~/.humanlayer.
let stateDir: string
let priorStateDir: string | undefined
beforeAll(async () => {
	priorStateDir = process.env.RIPTIDE_STATE_DIR
	stateDir = await mkdtemp(join(tmpdir(), 'session-hooks-state-'))
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

const APP_ORIGIN = 'https://app.test'
const SESSION_ID = '018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f'
const OTHER_SESSION_ID = '0190aa11-bb22-7cc3-8dd4-ee55ff667788'

const FAR_FUTURE_EPOCH = 4_000_000_000 // 2096 — far past any test run

const tempDirs: string[] = []

async function makeRepo(): Promise<string> {
	// realpath: Windows tmpdir() hands out the DOS 8.3 short form while git reports long-form
	// paths — path-equality asserts must match git's spelling.
	const dir = await realpath(await mkdtemp(join(tmpdir(), 'session-hooks-repo-')))
	tempDirs.push(dir)
	await git(dir, ['init', '-q'])
	await git(dir, ['config', 'user.email', 'dev@example.com'])
	await git(dir, ['config', 'user.name', 'Dev'])
	await writeFile(join(dir, 'seed.txt'), 'seed\n')
	await git(dir, ['add', '.'])
	await git(dir, ['commit', '-q', '-m', 'seed'])
	return dir
}

/** Arm through the ONE production entry point — env-hosted hooks, env-carried identity. */
async function armFor(cwd: string, sessionId = SESSION_ID) {
	return armSessionAttribution({ cwd, sessionId, codingAgent: 'claude', appOrigin: APP_ORIGIN })
}

/**
 * The env a git invoked from inside an armed session inherits: the session's identity trio
 * (id, trailer URL, expiry) + the env-scoped `core.hooksPath` pointing at our state-dir hooks —
 * exactly what the launchers spread. Computed at call time so it always points at THIS suite's
 * pinned state dir. `expiresEpoch`/`url` are overridable for the expiry and hostile-value tests.
 */
const sessionEnv = (
	sessionId = SESSION_ID,
	overrides?: { readonly expiresEpoch?: number | string; readonly url?: string },
): NodeJS.ProcessEnv => ({
	...process.env,
	...gitConfigHooksEnv(sessionHooksDir(), process.env),
	HUMANLAYER_SESSION_ID: sessionId,
	HUMANLAYER_SESSION_URL: overrides?.url ?? sessionCommitUrl(APP_ORIGIN, sessionId),
	HUMANLAYER_SESSION_EXPIRES: String(overrides?.expiresEpoch ?? FAR_FUTURE_EPOCH),
})

const bodyOf = (repo: string, ref: string) => git(repo, ['show', '-s', '--format=%b', ref])
const subjectOf = (repo: string, ref: string) => git(repo, ['show', '-s', '--format=%s', ref])

async function commit(repo: string, file: string, message: string, env?: NodeJS.ProcessEnv, extra: string[] = []) {
	await writeFile(join(repo, file), `${file} content\n`)
	await git(repo, ['add', '.'], env)
	await git(repo, ['commit', '-q', '-m', message, ...extra], env)
}

/**
 * Write an executable hook that touches a sentinel file so a test can prove it fired.
 * mkdir first: git >= 2.56 `init` no longer creates `.git/hooks` at all.
 */
async function writeSentinelHook(hookPath: string, sentinel: string, exitCode = 0): Promise<void> {
	await mkdir(dirname(hookPath), { recursive: true })
	await writeFile(hookPath, `#!/bin/sh\ntouch "${sentinel}"\nexit ${exitCode}\n`)
	await chmod(hookPath, 0o755)
}

/** Write an executable repo hook with arbitrary sh content (same mkdir caveat as above). */
async function writeRepoHook(hookPath: string, content: string): Promise<void> {
	await mkdir(dirname(hookPath), { recursive: true })
	await writeFile(hookPath, content)
	await chmod(hookPath, 0o755)
}

const sessionTrailerLines = (body: string) =>
	body.split('\n').filter((line) => new RegExp(`^${SESSION_TRAILER_TOKEN}:`, 'i').test(line))

/** Every HumanLayer byte a repo could carry — must never appear under an armed repo's .git. */
async function humanlayerResidue(repo: string): Promise<string[]> {
	const gitEntries = await readdir(join(repo, '.git'))
	const hookEntries = await readdir(join(repo, '.git', 'hooks')).catch(() => [])
	return [
		...gitEntries.filter((e) => e.includes('humanlayer')),
		...hookEntries.filter((e) => e === 'prepare-commit-msg' || e.includes('humanlayer')),
	]
}

describe('env-hosted session hooks', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
	})

	describe('arming', () => {
		it('arms with ZERO files in the repository — hooks live in the state dir, identity in env', async () => {
			const repo = await makeRepo()
			const { env, install } = await armFor(repo)

			expect(install.armed).toBe(true)
			if (!install.armed) return
			expect(install.hooksDir).toBe(join(stateDir, 'git-hooks'))

			// The env is the ENTIRE coupling: identity trio + git config. Its config shape follows
			// the mode the machine's git probed into — a <=2.53 git arms hooks-path, a >=2.54 one
			// arms config-hooks — so assert the matching entry shape rather than pinning one mode.
			expect(env.HUMANLAYER_SESSION_ID).toBe(SESSION_ID)
			expect(env.HUMANLAYER_SESSION_URL).toBe(sessionCommitUrl(APP_ORIGIN, SESSION_ID))
			expect(env.HUMANLAYER_SESSION_EXPIRES).toMatch(/^\d+$/)
			expect(Number(env.HUMANLAYER_SESSION_EXPIRES) * 1000).toBeGreaterThan(Date.now())
			if (install.mode === 'hooks-path') {
				expect(env.GIT_CONFIG_COUNT).toBe('1')
				expect(env.GIT_CONFIG_KEY_0).toBe('core.hooksPath')
			} else {
				expect(env.GIT_CONFIG_COUNT).toBe('2')
				expect(env.GIT_CONFIG_KEY_0).toBe('hook.humanlayer-attribution.event')
				expect(env.GIT_CONFIG_VALUE_0).toBe('prepare-commit-msg')
			}

			// The repo is UNTOUCHED: no hook, no config edit.
			expect(await humanlayerResidue(repo)).toEqual([])
			await expect(git(repo, ['config', '--get', 'core.hooksPath'])).rejects.toThrow()

			// The stamper + a representative trampoline exist and carry the marker/forwarding.
			const stamper = await readFile(join(install.hooksDir, 'prepare-commit-msg'), 'utf-8')
			expect(stamper).toContain(ENV_HOOK_MARKER)
			expect(await fileExists(join(install.hooksDir, 'pre-commit'))).toBe(true)
		})

		it('still stamps a session whose carrier could not resolve an app origin', async () => {
			// A carrier with no origin (a build missing the macro) must degrade to a RELATIVE link,
			// never to a missing trailer: without one the commit drops out of the confirmed tier and
			// attribution falls back to content matching, which is the weak evidence this whole
			// mechanism exists to replace.
			const repo = await makeRepo()
			const { env } = await armSessionAttribution({
				cwd: repo,
				sessionId: SESSION_ID,
				codingAgent: 'claude',
				appOrigin: '',
			})
			expect(env.HUMANLAYER_SESSION_URL).toBe(`/sessions/${SESSION_ID}`)

			const agentEnv = { ...process.env, ...env }
			await writeFile(join(repo, 'agent.txt'), 'agent work\n')
			await git(repo, ['add', '.'], agentEnv)
			await git(repo, ['commit', '-q', '-m', 'agent: did the thing'], agentEnv)

			const body = await git(repo, ['show', '-s', '--format=%b', 'HEAD'], agentEnv)
			expect(commitReportsSession(body, SESSION_ID)).toBe(true)
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
		})

		it('the state-side-only arm installs the same hooks and hands back no env to get wrong', async () => {
			// A process with attribution env set by its parent only needs the state-side half.
			const repo = await makeRepo()
			const install = await armSessionHooks({
				cwd: repo,
				sessionId: SESSION_ID,
				codingAgent: 'claude',
			})

			expect(install.armed).toBe(true)
			if (!install.armed) return
			expect(install.hooksDir).toBe(join(stateDir, 'git-hooks'))
			expect(await fileExists(join(install.hooksDir, 'prepare-commit-msg'))).toBe(true)
			expect(await humanlayerResidue(repo)).toEqual([])
		})

		it('publishes the arm outcome to the health breadcrumb', async () => {
			// "Fail safe" means degrading to silently-off; the breadcrumb is what makes that
			// silence diagnosable from the machine's own state dir.
			const repo = await makeRepo()
			const { install } = await armFor(repo)
			expect(install.armed).toBe(true)
			const health = JSON.parse(await readFile(join(stateDir, ATTRIBUTION_HEALTH_FILE), 'utf-8')) as Record<
				string,
				unknown
			>
			expect(health.armed).toBe(true)
			expect(health.mode).toBe(install.armed ? install.mode : undefined)
			expect(typeof health.at).toBe('string')
		})

		it('arms OUTSIDE a git repo too — env returned, the stamper simply never fires there', async () => {
			// Env-only design: arming needs no repo (the repo contributed only the lease before).
			// A session launched in a non-repo cwd that later cd's into a repo still stamps.
			const dir = await mkdtemp(join(tmpdir(), 'session-hooks-nogit-'))
			tempDirs.push(dir)
			const { env, install } = await armFor(dir)
			expect(install.armed).toBe(true)
			if (!install.armed) return
			expect(install.mode).toBe('hooks-path') // no repo to probe in — the universal mode
			expect(env.HUMANLAYER_SESSION_ID).toBe(SESSION_ID)
			expect(env.HUMANLAYER_SESSION_URL).toBe(sessionCommitUrl(APP_ORIGIN, SESSION_ID))
		})

		it('arms in a BARE repo without writing anything into it', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'session-hooks-bare-'))
			tempDirs.push(dir)
			await git(dir, ['init', '-q', '--bare'])
			const { install } = await armFor(dir)
			expect(install.armed).toBe(true)
			expect(await fileExists(join(dir, 'hooks', 'prepare-commit-msg'))).toBe(false)
		})

		it('ARMS a husky repo (env config shadows core.hooksPath; the v<=5 design had to decline)', async () => {
			const repo = await makeRepo()
			await mkdir(join(repo, '.husky'), { recursive: true })
			const sentinel = join(repo, 'husky-ran')
			await writeSentinelHook(join(repo, '.husky', 'prepare-commit-msg'), sentinel)
			await git(repo, ['config', 'core.hooksPath', '.husky'])

			const { install } = await armFor(repo)
			expect(install.armed).toBe(true)

			await commit(repo, 'h.txt', 'agent in husky repo', sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
			expect(await fileExists(sentinel)).toBe(true) // husky hook forwarded, not shadowed away
			expect(await git(repo, ['status', '--porcelain', '--', '.husky'])).toBe('') // tracked .husky untouched

			// Human in the same repo: husky runs natively, no trailer.
			await rm(sentinel, { force: true })
			await commit(repo, 'h2.txt', 'human in husky repo')
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
			expect(await fileExists(sentinel)).toBe(true)
		})

		it('re-arm is byte-identical; a SECOND session needs no bookkeeping at all', async () => {
			const repo = await makeRepo()
			const first = await armFor(repo)
			expect(first.install.armed).toBe(true)
			if (!first.install.armed) return
			const before = await readFile(join(first.install.hooksDir, 'prepare-commit-msg'), 'utf-8')

			const second = await armFor(repo, OTHER_SESSION_ID)
			expect(second.install.armed).toBe(true)
			expect(await readFile(join(first.install.hooksDir, 'prepare-commit-msg'), 'utf-8')).toBe(before)
			expect(second.env.HUMANLAYER_SESSION_URL).toBe(sessionCommitUrl(APP_ORIGIN, OTHER_SESSION_ID))
		})

		it('APPENDS to pre-existing GIT_CONFIG_* env instead of clobbering it', () => {
			const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '/ci' }
			const entries = gitConfigHooksEnv('/state/git-hooks', base)
			expect(entries.GIT_CONFIG_COUNT).toBe('2')
			expect(entries.GIT_CONFIG_KEY_1).toBe('core.hooksPath')
			expect(entries.GIT_CONFIG_VALUE_1).toBe('/state/git-hooks')
			expect(entries.GIT_CONFIG_KEY_0).toBeUndefined()
		})

		it('config-hooks mode registers the CHAIN-FREE stamper additively, command shell-quoted', () => {
			// git runs configured hook commands via `sh -c '<command> "$@"'` (verified against a
			// 2.54+ build), so a spaced state-dir path MUST arrive quoted or it word-splits.
			const entries = gitConfigHooksEnv('/Users/First Last/.humanlayer/riptide/git-hooks', {}, 'config-hooks')
			expect(entries.GIT_CONFIG_COUNT).toBe('2')
			expect(entries.GIT_CONFIG_KEY_0).toBe('hook.humanlayer-attribution.event')
			expect(entries.GIT_CONFIG_VALUE_0).toBe('prepare-commit-msg')
			expect(entries.GIT_CONFIG_KEY_1).toBe('hook.humanlayer-attribution.command')
			// stamp-commit-msg, NOT prepare-commit-msg: git 2.54+ runs the repo's hookdir hook
			// natively after configured hooks, so the config entry must not chain it itself.
			expect(entries.GIT_CONFIG_VALUE_1).toBe(
				"'/Users/First Last/.humanlayer/riptide/git-hooks/stamp-commit-msg'",
			)
			// no core.hooksPath entry — nothing is shadowed in this mode
			expect(Object.values(entries)).not.toContain('core.hooksPath')
		})

		it('materializes BOTH stamper entries — only the hooks-path one chains the repo hook', async () => {
			const repo = await makeRepo()
			const { install } = await armFor(repo)
			expect(install.armed).toBe(true)
			if (!install.armed) return
			const hooksPathStamper = await readFile(join(install.hooksDir, 'prepare-commit-msg'), 'utf-8')
			const configStamper = await readFile(join(install.hooksDir, CONFIG_STAMPER_NAME), 'utf-8')
			expect(configStamper).toContain(ENV_HOOK_MARKER)
			// hooks-path mode SHADOWS the repo's own prepare-commit-msg, so its stamper must run
			// it manually. In config-hooks mode git runs the repo's hookdir hook natively AFTER
			// configured hooks — a chain step there would run the repo hook twice per commit.
			expect(hooksPathStamper).toContain('"$REAL_HOOKS/prepare-commit-msg" "$@"')
			expect(configStamper).not.toContain('$REAL_HOOKS')
			// Identical stamping contract otherwise: env-only, same trailer plumbing.
			expect(configStamper).toContain('interpret-trailers')
			expect(configStamper).toContain('HUMANLAYER_SESSION_URL')
		})

		it('probes the capability by behavior and arms in hooks-path mode on gits without it', async () => {
			resetConfigHooksSupportForTesting()
			const repo = await makeRepo()
			// This suite runs against whatever git is installed; on a git without `git hook list`
			// the probe must fail CLOSED, and the arm must report hooks-path. On a git WITH the
			// capability both mode outcomes are legitimate — assert consistency instead.
			const supported = await supportsConfigHooks(repo)
			const { env, install } = await armFor(repo)
			expect(install.armed).toBe(true)
			if (!install.armed) return
			expect(install.mode).toBe(supported ? 'config-hooks' : 'hooks-path')
			if (install.mode === 'hooks-path') {
				expect(env.GIT_CONFIG_KEY_0).toBe('core.hooksPath')
			} else {
				expect(env.GIT_CONFIG_KEY_0).toBe('hook.humanlayer-attribution.event')
			}
			// The verdict is published for the launcher (the one carrier that cannot probe git).
			const cache = JSON.parse(await readFile(join(stateDir, 'git-capabilities.json'), 'utf-8'))
			expect(cache.configHooks).toBe(supported)
			resetConfigHooksSupportForTesting()
		})
	})

	describe('stamping', () => {
		it('stamps the trailer on a session commit; author, committer and signing untouched', async () => {
			const repo = await makeRepo()
			await armFor(repo)

			await commit(repo, 'agent.txt', 'agent: did the thing', sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
			expect(sessionTrailerLines(body)).toHaveLength(1)
			expect(await git(repo, ['show', '-s', '--format=%an|%ae|%cn|%ce', 'HEAD'])).toBe(
				'Dev|dev@example.com|Dev|dev@example.com',
			)
		})

		it('does NOT stamp a commit made without the session env (a human in the same worktree)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'human.txt', 'human: unrelated')
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
		})

		it('does NOT stamp when the env lacks the trailer URL (partial env is not identity)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			const env = sessionEnv()
			delete env.HUMANLAYER_SESSION_URL
			await commit(repo, 'nourl.txt', 'id without url', env)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
		})

		it('does NOT stamp past the expiry horizon — a leaked env goes inert on its own', async () => {
			// The whole liveness gate: env frozen into a long-lived process (a tmux server born
			// inside a session) stops stamping at the horizon, with no state and no cleanup hook.
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'leak.txt', 'commit from a leaked env', sessionEnv(SESSION_ID, { expiresEpoch: 1 }))
			expect(await subjectOf(repo, 'HEAD')).toBe('commit from a leaked env') // commit itself fine
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
		})

		it('fails CLOSED on a malformed expiry — a mangled env must not stamp forever', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			for (const expiresEpoch of ['banana', '', '12x34']) {
				await commit(
					repo,
					`mal-${expiresEpoch.length}.txt`,
					'mangled expiry',
					sessionEnv(SESSION_ID, { expiresEpoch }),
				)
				expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
			}
		})

		it('stamps each concurrent session with its OWN trailer (identity rides each env)', async () => {
			const repo = await makeRepo()
			await armFor(repo, SESSION_ID)
			await commit(repo, 'one.txt', 'session one work', sessionEnv(SESSION_ID))
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
			await commit(repo, 'two.txt', 'session two work', sessionEnv(OTHER_SESSION_ID))
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(OTHER_SESSION_ID)
		})

		it('respects the user-set git-config opt-out, in git boolean semantics (false/off/no/0)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			// git's own boolean vocabulary must all read as opted out — a user who writes `off`
			// (git convention) must not be silently kept opted IN.
			for (const value of ['false', 'off', 'no', '0']) {
				await git(repo, ['config', 'humanlayer.attribution', value])
				await commit(repo, `opt-${value}.txt`, `agent with opt-out ${value}`, sessionEnv())
				expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
			}

			// Unsetting it restores stamping — the config is the user's own switch, both ways.
			await git(repo, ['config', '--unset', 'humanlayer.attribution'])
			await commit(repo, 'opt2.txt', 'agent after opting back in', sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('refuses a trailer URL carrying non-printable bytes (env can hold a newline; a message line must not)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(
				repo,
				'evil.txt',
				'hostile url env',
				sessionEnv(SESSION_ID, { url: 'https://a.test/x\ninjected: line' }),
			)
			const body = await bodyOf(repo, 'HEAD')
			expect(body).toBe('')
		})

		it('appends OUR trailer at the END of a trailer block the model already wrote', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			const claudeCoAuthor = 'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>'
			const claudeSession = 'Claude-Session: https://claude.ai/code/session_01WXYZmnpqRSTuvabcdefgh'
			await commit(
				repo,
				'multi.txt',
				`agent work\n\nDoes the thing.\n\n${claudeCoAuthor}\n${claudeSession}`,
				sessionEnv(),
			)
			const body = await bodyOf(repo, 'HEAD')
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
			expect(body).toContain(claudeCoAuthor)
			expect(body).toContain(claudeSession)
			expect(body.trim().split('\n').at(-1)).toBe(
				`${SESSION_TRAILER_TOKEN}: ${sessionCommitUrl(APP_ORIGIN, SESSION_ID)}`,
			)
		})

		it('appends a real trailer BLOCK when the message ends in prose (not a naive append)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await writeFile(join(repo, 'p.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(repo, ['commit', '-q', '-m', 'agent work\n\nprose paragraph, no trailers.'], sessionEnv())
			const body = await bodyOf(repo, 'HEAD')
			const lines = body.trim().split('\n')
			expect(lines.at(-2)).toBe('') // blank line separates the trailer BLOCK from prose
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
		})

		it('stamps despite hostile repo trailer config (separators AND ifmissing pinned)', async () => {
			// Repo trailer.* config can otherwise mangle the value (separators) or drop the stamp
			// entirely (`ifmissing=doNothing` means "never add a trailer that isn't there yet").
			const repo = await makeRepo()
			await git(repo, ['config', 'trailer.separators', '='])
			await git(repo, ['config', 'trailer.ifmissing', 'doNothing'])
			await armFor(repo)
			await commit(repo, 'sep.txt', 'agent', sessionEnv())
			const body = await bodyOf(repo, 'HEAD')
			expect(body).toContain(`${SESSION_TRAILER_TOKEN}: ${APP_ORIGIN}/sessions/${SESSION_ID}`)
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
		})

		it('keeps the repo’s hooks working when the USER ships env-scoped git config', async () => {
			// A container/devcontainer delivers `safe.directory` via GIT_CONFIG_*. Resolving the
			// repo's hooks dir must not strip that env (it did): resolution would fail and EVERY
			// repo hook — vetoes included — would silently stop firing for agent commits only.
			const repo = await makeRepo()
			const sentinel = join(repo, 'user-env-hook-ran')
			await writeSentinelHook(join(repo, '.git', 'hooks', 'pre-commit'), sentinel)
			await armFor(repo)

			const armed = sessionEnv()
			const ourCount = Number(armed.GIT_CONFIG_COUNT)
			const withUserEntry: NodeJS.ProcessEnv = { ...armed, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }
			// Shift our entries up by one and put the user's safe.directory at index 0, exactly as
			// the append contract produces when the base env already carries entries.
			for (let i = ourCount - 1; i >= 0; i--) {
				withUserEntry[`GIT_CONFIG_KEY_${i + 1}`] = armed[`GIT_CONFIG_KEY_${i}`]
				withUserEntry[`GIT_CONFIG_VALUE_${i + 1}`] = armed[`GIT_CONFIG_VALUE_${i}`]
			}
			withUserEntry.GIT_CONFIG_KEY_0 = 'safe.directory'
			withUserEntry.GIT_CONFIG_VALUE_0 = repo
			withUserEntry.GIT_CONFIG_COUNT = String(ourCount + 1)

			await commit(repo, 'ue.txt', 'agent under container env', withUserEntry)
			expect(await fileExists(sentinel)).toBe(true)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})
	})

	describe('sequencer operations (replays are not this session’s authorship)', () => {
		it('cherry-pick of a human commit under the session env stays unstamped', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await git(repo, ['checkout', '-q', '-b', 'side'])
			await commit(repo, 'human.txt', 'human side work')
			const humanSha = await git(repo, ['rev-parse', 'HEAD'])
			await git(repo, ['checkout', '-q', '-'])
			await commit(repo, 'main.txt', 'agent main work', sessionEnv())

			await git(repo, ['cherry-pick', humanSha], sessionEnv())

			expect(await subjectOf(repo, 'HEAD')).toBe('human side work')
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
		})

		for (const backend of ['--merge', '--apply']) {
			it(`rebase ${backend} of a human commit under the session env stays unstamped`, async () => {
				const repo = await makeRepo()
				await armFor(repo)
				await git(repo, ['checkout', '-q', '-b', 'topic'])
				await commit(repo, 'topic.txt', 'human topic work')
				await git(repo, ['checkout', '-q', '-'])
				await commit(repo, 'main.txt', 'agent main work', sessionEnv())
				const mainSha = await git(repo, ['rev-parse', 'HEAD'])

				await git(repo, ['rebase', backend, mainSha, 'topic'], sessionEnv())

				expect(await subjectOf(repo, 'HEAD')).toBe('human topic work')
				expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
			})
		}

		it('revert under the session env STILL stamps (a revert is new work, not a replay)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'r.txt', 'agent work', sessionEnv())
			await git(repo, ['revert', '--no-edit', 'HEAD'], sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('cherry-pick of the session’s OWN commit keeps exactly one trailer (rides the message)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			const seedSha = await git(repo, ['rev-parse', 'HEAD'])
			await commit(repo, 'own.txt', 'agent own work', sessionEnv())
			const ownSha = await git(repo, ['rev-parse', 'HEAD'])
			await git(repo, ['checkout', '-q', '-b', 'elsewhere', seedSha])

			await git(repo, ['cherry-pick', ownSha], sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(sessionTrailerLines(body)).toHaveLength(1)
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
		})

		it('a conflicted merge resolved by the session STILL stamps (MERGE_HEAD is not a sequencer op)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await git(repo, ['checkout', '-q', '-b', 'confl'])
			await commit(repo, 'clash.txt', 'agent confl side', sessionEnv())
			await git(repo, ['checkout', '-q', '-'])
			await writeFile(join(repo, 'clash.txt'), 'different content\n')
			await git(repo, ['add', '.'])
			await git(repo, ['commit', '-q', '-m', 'agent main side'], sessionEnv())

			await git(repo, ['merge', 'confl'], sessionEnv()).catch(() => undefined) // conflicts
			await writeFile(join(repo, 'clash.txt'), 'resolved\n')
			await git(repo, ['add', 'clash.txt'])
			await git(repo, ['commit', '-q', '--no-edit'], sessionEnv())

			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})
	})

	describe('idempotency', () => {
		it('does not duplicate the trailer across --amend', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'a.txt', 'agent work', sessionEnv())
			const firstSha = await git(repo, ['rev-parse', 'HEAD'])

			await writeFile(join(repo, 'a.txt'), 'a changed\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(repo, ['commit', '-q', '--amend', '--no-edit'], sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(await git(repo, ['rev-parse', 'HEAD'])).not.toBe(firstSha)
			expect(commitReportsSession(body, SESSION_ID)).toBe(true)
			expect(sessionTrailerLines(body)).toHaveLength(1)
		})

		it('does not duplicate the trailer when -C replays a stamped message', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'work.txt', 'agent work', sessionEnv())
			const agentSha = await git(repo, ['rev-parse', 'HEAD'])

			await writeFile(join(repo, 'work2.txt'), 'more\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(repo, ['commit', '-q', '-C', agentSha], sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(sessionTrailerLines(body)).toHaveLength(1)
		})

		it('survives a soft-reset squash of two stamped commits', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'one.txt', 'first', sessionEnv())
			await commit(repo, 'two.txt', 'second', sessionEnv())

			await git(repo, ['reset', '-q', '--soft', 'HEAD~2'], sessionEnv())
			await git(repo, ['commit', '-q', '-m', 'squashed both'], sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(commitReportsSession(body, SESSION_ID)).toBe(true)
			expect(sessionTrailerLines(body)).toHaveLength(1)
		})

		it('a hallucinated Co-authored-by line does NOT preempt stamping', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await writeFile(join(repo, 'h.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(
				repo,
				['commit', '-q', '-m', 'agent work', '-m', 'Co-authored-by: Claude <noreply@anthropic.com>'],
				sessionEnv(),
			)
			expect(commitReportsSession(await bodyOf(repo, 'HEAD'), SESSION_ID)).toBe(true)
		})

		it('does not double-stamp when `git commit --trailer` already added the trailer', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await writeFile(join(repo, 'both.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(
				repo,
				[
					'commit',
					'-q',
					'-m',
					'agent',
					'--trailer',
					`${SESSION_TRAILER_TOKEN}: ${APP_ORIGIN}/sessions/${SESSION_ID}`,
				],
				sessionEnv(),
			)
			const body = await bodyOf(repo, 'HEAD')
			expect(sessionTrailerLines(body)).toHaveLength(1)
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
		})
	})

	describe('forwarding the repo’s own hooks', () => {
		it('runs an existing repo prepare-commit-msg first, then still stamps', async () => {
			const repo = await makeRepo()
			const sentinel = join(repo, 'existing-hook-ran')
			await writeSentinelHook(join(repo, '.git', 'hooks', 'prepare-commit-msg'), sentinel)
			await armFor(repo)

			await commit(repo, 'x.txt', 'agent', sessionEnv())

			expect(await fileExists(sentinel)).toBe(true)
			expect(commitReportsSession(await bodyOf(repo, 'HEAD'), SESSION_ID)).toBe(true)
			// The repo hook file is exactly as the user left it — no chaining copy, no rewrite.
			expect(await readFile(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf-8')).toContain('touch')
		})

		it('propagates a repo hook that rejects the commit (never swallows its veto)', async () => {
			const repo = await makeRepo()
			await writeSentinelHook(join(repo, '.git', 'hooks', 'prepare-commit-msg'), join(repo, 'rejector-ran'), 1)
			await armFor(repo)

			await writeFile(join(repo, 'y.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await expect(git(repo, ['commit', '-q', '-m', 'agent'], sessionEnv())).rejects.toThrow()
			expect(await fileExists(join(repo, 'rejector-ran'))).toBe(true)
		})

		it("forwards the repo's OTHER hooks too — pre-commit still fires", async () => {
			const repo = await makeRepo()
			const sentinel = join(repo, 'precommit-ran')
			await writeSentinelHook(join(repo, '.git', 'hooks', 'pre-commit'), sentinel)
			await armFor(repo)

			await commit(repo, 'p.txt', 'agent', sessionEnv())

			expect(await fileExists(sentinel)).toBe(true)
			expect(commitReportsSession(await bodyOf(repo, 'HEAD'), SESSION_ID)).toBe(true)
		})

		// POSIX-only premise: NTFS has no execute bit; on Windows git itself runs such a hook.
		it.skipIf(process.platform === 'win32')(
			'does not resurrect a chmod-x-disabled repo hook (git was ignoring it; so do we)',
			async () => {
				const repo = await makeRepo()
				const sentinel = join(repo, 'disabled-ran')
				const hookPath = join(repo, '.git', 'hooks', 'prepare-commit-msg')
				await mkdir(dirname(hookPath), { recursive: true })
				await writeFile(hookPath, `#!/bin/sh\ntouch "${sentinel}"\nexit 1\n`)
				await chmod(hookPath, 0o644)
				await armFor(repo)

				await commit(repo, 'd.txt', 'agent past disabled hook', sessionEnv())
				expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
				expect(await fileExists(sentinel)).toBe(false)
			},
		)
	})

	describe('worktrees', () => {
		it('stamps inside a linked worktree — identity travels with each env, no per-worktree state', async () => {
			const repo = await makeRepo()
			const worktree = join(repo, '..', `wt-${process.pid}-b`)
			await git(repo, ['worktree', 'add', '-q', worktree, '-b', 'feature2'])
			tempDirs.push(worktree)

			await armFor(repo, SESSION_ID)

			await commit(worktree, 'wt.txt', 'worktree work', sessionEnv(OTHER_SESSION_ID))
			await commit(repo, 'main.txt', 'main work', sessionEnv(SESSION_ID))

			expect(parseSessionFromTrailer(await bodyOf(worktree, 'HEAD'))).toBe(OTHER_SESSION_ID)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})
	})

	describe('degrading instead of failing the commit', () => {
		it('stamps with NO HumanLayer binary anywhere — the stamper is self-contained sh', async () => {
			const repo = await makeRepo()
			const { install } = await armFor(repo)
			if (!install.armed) return

			const stamper = await readFile(join(install.hooksDir, 'prepare-commit-msg'), 'utf-8')
			expect(stamper).not.toContain('bun') // no runtime path baked — nothing to go stale

			await commit(repo, 'self.txt', 'self-contained stamp', sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('leaves no temp files behind — and the repo carries no HumanLayer bytes at all', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 't.txt', 'agent', sessionEnv())

			expect(await humanlayerResidue(repo)).toEqual([])
			const gitEntries = await readdir(join(repo, '.git'))
			expect(gitEntries.filter((e) => e.startsWith('COMMIT_EDITMSG.humanlayer'))).toEqual([])
		})
	})

	describe('trampoline completeness', () => {
		it('self-heals: a repo hook name OUTSIDE the static floor gets a trampoline at arm time', async () => {
			// Simulates git shipping a hook newer than FORWARDED_HOOKS: the repo has a file named
			// after it, and arming must cover it — completeness comes from looking at the repo,
			// not only from the audited list.
			const repo = await makeRepo()
			await writeSentinelHook(join(repo, '.git', 'hooks', 'post-quantum-sync'), join(repo, 'never-run'))

			await armFor(repo)

			const trampoline = await readFile(join(sessionHooksDir(), 'post-quantum-sync'), 'utf-8')
			expect(trampoline).toContain('REAL_HOOKS')
			// Trampolines are byte-identical — each derives its hook from its own basename.
			expect(trampoline).toContain('basename')
			expect(trampoline).toBe(await readFile(join(sessionHooksDir(), 'pre-commit'), 'utf-8'))
			// Hostile names from a repo listing must never become files in our dir.
			expect(await fileExists(join(sessionHooksDir(), 'pre-commit.sample'))).toBe(false)
		})

		// core.hooksPath is exclusive, so FORWARDED_HOOKS must name every hook git can run — a
		// missing name is a repo hook that SILENTLY stops firing for agent commits. There is no
		// plumbing command that lists hook names, so this canary parses the INSTALLED git's own
		// githooks(5) man page: the moment any dev/CI machine gets a git that documents a hook we
		// don't forward, this fails loudly instead of the coverage rotting in silence.
		it('forwards every hook the installed git documents (githooks(5) canary)', async (ctx) => {
			const manOutput = await sh('sh', ['-c', 'MANWIDTH=200 man 5 githooks 2>/dev/null | col -b']).then(
				(r) => r.stdout,
				() => '',
			)
			const documented = new Set(
				manOutput
					.split('\n')
					.map((line) => line.match(/^\s{2,6}([a-z][a-z0-9-]*(?:-[a-z0-9]+)*)$/)?.[1])
					.filter((name): name is string => name !== undefined),
			)
			// No man page (Windows runners, minimal containers) or an unparseable format: skip —
			// the canary only needs to fire SOMEWHERE, and linux dev machines + CI qualify.
			if (documented.size < 20) return ctx.skip()

			const forwarded = new Set<string>([...FORWARDED_HOOKS, 'prepare-commit-msg'])
			const missing = [...documented].filter((name) => !forwarded.has(name))
			expect(missing, `git ${await git('.', ['version'])} documents hooks we do not forward`).toEqual([])
		})
	})

	describe('message sources and commit shapes', () => {
		it('stamps a --no-verify commit (-n skips pre-commit/commit-msg, NOT prepare-commit-msg)', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'nv.txt', 'agent -n commit', sessionEnv(), ['--no-verify'])
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('stamps a -F message-file commit', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			const msgPath = join(repo, 'COMMIT_SOURCE_MSG')
			await writeFile(msgPath, 'agent -F commit\n\nbody prose.\n')
			await writeFile(join(repo, 'ff.txt'), 'x\n')
			await git(repo, ['add', 'ff.txt'], sessionEnv())
			await git(repo, ['commit', '-q', '-F', msgPath], sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it("preserves git's abort-on-empty and unedited-template safeties (interactive sources are not stamped)", async () => {
			// The stamp runs BEFORE the editor. Touching an interactive commit's buffer would make
			// an abort-by-empty-message impossible (the trailer is content), and would defeat the
			// "did not edit the template" check — native git refuses both; armed git must too.
			const repo = await makeRepo()
			await armFor(repo)
			const seedSha = await git(repo, ['rev-parse', 'HEAD'])

			await writeFile(join(repo, 'ia.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await expect(git(repo, ['commit', '-q'], { ...sessionEnv(), GIT_EDITOR: 'true' })).rejects.toThrow()

			const tmplPath = join(repo, 'MSG_TEMPLATE')
			await writeFile(tmplPath, 'templated subject\n')
			await expect(
				git(repo, ['commit', '-q', '-t', tmplPath], { ...sessionEnv(), GIT_EDITOR: 'true' }),
			).rejects.toThrow()
			expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(seedSha) // nothing was committed
		})

		it('keeps the trailer in the FINAL block when the body contains an exact --- line', async () => {
			// interpret-trailers reads `---` as a patch divider by default and would insert the
			// trailer MID-message above it; --no-divider pins the append to the true end.
			const repo = await makeRepo()
			await armFor(repo)
			await writeFile(join(repo, 'dv.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await git(repo, ['commit', '-q', '-m', 'agent work\n\nbody before\n---\nbody after'], sessionEnv())
			const body = await bodyOf(repo, 'HEAD')
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
			expect(body.trim().split('\n').at(-1)).toBe(
				`${SESSION_TRAILER_TOKEN}: ${sessionCommitUrl(APP_ORIGIN, SESSION_ID)}`,
			)
		})

		it('stamps a clean --no-ff merge commit', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await git(repo, ['checkout', '-q', '-b', 'feature'])
			await commit(repo, 'feat.txt', 'agent feature work', sessionEnv())
			await git(repo, ['checkout', '-q', '-'])
			await git(repo, ['merge', '--no-ff', '-q', '-m', 'merge feature', 'feature'], sessionEnv())
			expect((await git(repo, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ')).toHaveLength(3)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('stamps a commit driven from OUTSIDE the worktree via GIT_DIR/GIT_WORK_TREE env', async () => {
			// The alternate repo-discovery path: cwd is unrelated, the env names the repo.
			const repo = await makeRepo()
			await armFor(repo)
			const outside = await mkdtemp(join(tmpdir(), 'session-hooks-outside-'))
			tempDirs.push(outside)
			await writeFile(join(repo, 'env-driven.txt'), 'x\n')
			const env = { ...sessionEnv(), GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo }
			await git(outside, ['add', '-A'], env)
			await git(outside, ['commit', '-q', '-m', 'agent via env discovery'], env)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		})

		it('stamps in a sha256 object-format repo', async () => {
			const dir = await realpath(await mkdtemp(join(tmpdir(), 'session-hooks-s256-')))
			tempDirs.push(dir)
			await git(dir, ['init', '-q', '--object-format=sha256'])
			await git(dir, ['config', 'user.email', 'dev@example.com'])
			await git(dir, ['config', 'user.name', 'Dev'])
			await writeFile(join(dir, 'seed.txt'), 'seed\n')
			await git(dir, ['add', '.'])
			await git(dir, ['commit', '-q', '-m', 'seed'])

			const { install } = await armFor(dir)
			expect(install.armed).toBe(true)

			await commit(dir, 's.txt', 'agent in sha256 repo', sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(dir, 'HEAD'))).toBe(SESSION_ID)
		})

		it('stamps EVERY commit of a multi-commit revert (the sequencer todo names the operation)', async () => {
			// `git revert A B` runs under the sequencer with no REVERT_HEAD at hook time — the
			// suppression the sequencer dir usually means. Reverts are new session-authored work,
			// so the stamper reads the todo's operation instead of treating the dir as a verdict.
			const repo = await makeRepo()
			await commit(repo, 'r1.txt', 'human r1')
			await commit(repo, 'r2.txt', 'human r2')
			await armFor(repo)
			await git(repo, ['revert', '--no-edit', 'HEAD', 'HEAD~1'], sessionEnv())
			expect(await subjectOf(repo, 'HEAD')).toContain('Revert')
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD~1'))).toBe(SESSION_ID)
		})

		it('stamps inside a SUBMODULE of an armed superproject (identity travels the whole tree)', async (ctx) => {
			// Env-only design: the submodule needs no per-worktree state, so agent work inside it
			// attributes like any other commit — an improvement over the lease design, which had
			// no lease under the submodule's own git dir and silently skipped these.
			const sub = await makeRepo()
			const superRepo = await makeRepo()
			const added = await git(superRepo, [
				'-c',
				'protocol.file.allow=always',
				'submodule',
				'add',
				sub,
				'vendor/sub',
			]).then(
				() => true,
				(error) => {
					// Minimal from-source builds (NO_PERL) ship no `git submodule` — skip, not fail.
					if (/not a git command/.test(String(error))) return false
					throw error
				},
			)
			if (!added) return ctx.skip()
			await git(superRepo, ['commit', '-q', '-m', 'add submodule'])
			await armFor(superRepo)

			const subDir = join(superRepo, 'vendor', 'sub')
			await git(subDir, ['config', 'user.email', 'dev@example.com'])
			await git(subDir, ['config', 'user.name', 'Dev'])
			await writeFile(join(subDir, 's.txt'), 'x\n')
			await git(subDir, ['add', '.'], sessionEnv())
			await git(subDir, ['commit', '-q', '-m', 'agent inside submodule'], sessionEnv())
			expect(parseSessionFromTrailer(await bodyOf(subDir, 'HEAD'))).toBe(SESSION_ID)
		})
	})

	describe('trampoline fidelity', () => {
		it('a commit-msg repo hook veto propagates through the trampoline', async () => {
			// The existing veto test exercises the CHAINED prepare path; this one goes through a
			// pure trampoline (commit-msg is only reachable by forwarding).
			const repo = await makeRepo()
			const sentinel = join(repo, 'cm-ran')
			await writeSentinelHook(join(repo, '.git', 'hooks', 'commit-msg'), sentinel, 1)
			await armFor(repo)

			await writeFile(join(repo, 'v.txt'), 'x\n')
			await git(repo, ['add', '.'], sessionEnv())
			await expect(git(repo, ['commit', '-q', '-m', 'agent vetoed'], sessionEnv())).rejects.toThrow()
			expect(await fileExists(sentinel)).toBe(true)
			expect(await subjectOf(repo, 'HEAD')).toBe('seed')
		})

		it('pre-push receives its ref-update stdin through the trampoline', async () => {
			// The trampoline execs rather than `git hook run` precisely to keep stdin attached —
			// this is the test for that rationale.
			const repo = await makeRepo()
			const bare = await realpath(await mkdtemp(join(tmpdir(), 'session-hooks-bare-')))
			tempDirs.push(bare)
			await git(bare, ['init', '-q', '--bare'])
			await git(repo, ['remote', 'add', 'origin', bare])

			const captured = join(repo, 'pre-push-stdin')
			await writeRepoHook(join(repo, '.git', 'hooks', 'pre-push'), `#!/bin/sh\ncat > "${captured}"\n`)
			await armFor(repo)

			await git(repo, ['push', '-q', 'origin', 'HEAD'], sessionEnv())
			const stdinContent = await readFile(captured, 'utf-8')
			expect(stdinContent).toMatch(/refs\//)
		})
	})

	describe('arming under adversity', () => {
		it('concurrent arms in ONE process converge on a fresh state dir (tmp-name uniqueness)', async () => {
			// Regression: pid-only tmp names made same-process concurrent first arms collide on
			// rename and ALL reject — a fresh machine's first sessions silently lost their env.
			const freshState = await mkdtemp(join(tmpdir(), 'session-hooks-conc-'))
			tempDirs.push(freshState)
			const prior = process.env.RIPTIDE_STATE_DIR
			process.env.RIPTIDE_STATE_DIR = freshState
			try {
				const dirs = await Promise.all(Array.from({ length: 6 }, () => ensureSessionHooksDir()))
				expect(new Set(dirs).size).toBe(1)
				expect(await readFile(join(dirs[0]!, 'prepare-commit-msg'), 'utf-8')).toContain(ENV_HOOK_MARKER)
			} finally {
				process.env.RIPTIDE_STATE_DIR = prior
			}
		})

		it('self-heals repo hook names even when the arm itself runs inside the armed env', async () => {
			// With our env-scoped core.hooksPath already in place, a naive `--git-path hooks`
			// answers with OUR dir and the self-healing listing would only ever see trampolines.
			// resolveGitPaths strips the env
			// the way the trampoline does.
			const repo = await makeRepo()
			await writeSentinelHook(join(repo, '.git', 'hooks', 'post-quantum-sync-armed'), join(repo, 'never-run'))
			const prior = {
				count: process.env.GIT_CONFIG_COUNT,
				key: process.env.GIT_CONFIG_KEY_0,
				value: process.env.GIT_CONFIG_VALUE_0,
			}
			process.env.GIT_CONFIG_COUNT = '1'
			process.env.GIT_CONFIG_KEY_0 = 'core.hooksPath'
			process.env.GIT_CONFIG_VALUE_0 = sessionHooksDir()
			try {
				await armFor(repo)
			} finally {
				if (prior.count === undefined) delete process.env.GIT_CONFIG_COUNT
				else process.env.GIT_CONFIG_COUNT = prior.count
				if (prior.key === undefined) delete process.env.GIT_CONFIG_KEY_0
				else process.env.GIT_CONFIG_KEY_0 = prior.key
				if (prior.value === undefined) delete process.env.GIT_CONFIG_VALUE_0
				else process.env.GIT_CONFIG_VALUE_0 = prior.value
			}
			expect(await fileExists(join(sessionHooksDir(), 'post-quantum-sync-armed'))).toBe(true)
		})
	})

	describe('config-hooks hosting mode (capable git only)', () => {
		// Every test arms first and skips below git 2.54 (the arm PROBES; there is no version
		// sniffing anywhere). On a capable git — Windows CI's stock git today, everything once
		// 2.54 reaches dev machines — the whole block runs for real. This block absorbed
		// tools/validate-config-hooks-mode.sh: the semantics canaries live here now, next to the
		// code that depends on them, and fire the day a git changes any of them.
		async function configModeOrSkip(ctx: { skip: () => void }, repo: string): Promise<boolean> {
			const { install } = await armFor(repo)
			expect(install.armed).toBe(true)
			if (!install.armed || install.mode !== 'config-hooks') {
				ctx.skip()
				return false
			}
			return true
		}

		/** The env the launchers build in config-hooks mode, pointed at the CURRENT state dir. */
		const cfgSessionEnv = (): NodeJS.ProcessEnv => ({
			...process.env,
			...gitConfigHooksEnv(sessionHooksDir(), process.env, 'config-hooks'),
			HUMANLAYER_SESSION_ID: SESSION_ID,
			HUMANLAYER_SESSION_URL: sessionCommitUrl(APP_ORIGIN, SESSION_ID),
			HUMANLAYER_SESSION_EXPIRES: String(FAR_FUTURE_EPOCH),
		})

		it('stamps additively — the repo prepare-commit-msg runs natively exactly once', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return

			await writeRepoHook(
				join(repo, '.git', 'hooks', 'prepare-commit-msg'),
				'#!/bin/sh\nprintf "\\nX-Repo-PCM: ran\\n" >> "$1"\n',
			)

			await commit(repo, 'cfg.txt', 'agent config-hooks commit', cfgSessionEnv())
			const body = await bodyOf(repo, 'HEAD')
			expect(sessionTrailerLines(body)).toHaveLength(1)
			expect(body.match(/X-Repo-PCM: ran/g)).toHaveLength(1)
			// Ordering canary: configured hooks run BEFORE the hookdir hook (hook.c appends
			// configured, then default) — the reason the stamp can precede an appending repo hook.
			expect(body.indexOf(SESSION_TRAILER_TOKEN)).toBeLessThan(body.indexOf('X-Repo-PCM: ran'))
		})

		it('the env guard holds — a commit without the session id is untouched', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return
			const env = { ...process.env, ...gitConfigHooksEnv(sessionHooksDir(), process.env, 'config-hooks') }
			delete env.HUMANLAYER_SESSION_ID
			await commit(repo, 'guard.txt', 'no session id', env)
			expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
		})

		it('vetoes hold on both sides: a failing configured hook and a repo hookdir veto each abort', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return
			// Configured side, synthetic failing command: the production stamper never fails past
			// the env guard — this canary pins the git semantics that contract exists to satisfy.
			const failing = {
				...process.env,
				GIT_CONFIG_COUNT: '2',
				GIT_CONFIG_KEY_0: 'hook.humanlayer-attribution.event',
				GIT_CONFIG_VALUE_0: 'prepare-commit-msg',
				GIT_CONFIG_KEY_1: 'hook.humanlayer-attribution.command',
				GIT_CONFIG_VALUE_1: 'false',
			}
			await writeFile(join(repo, 'v.txt'), 'x\n')
			await git(repo, ['add', '.'])
			await expect(git(repo, ['commit', '-q', '-m', 'vetoed by configured hook'], failing)).rejects.toThrow()
			// Hookdir side under the production env: nothing is shadowed, so the repo's own
			// pre-commit veto must still block the commit.
			await writeSentinelHook(join(repo, '.git', 'hooks', 'pre-commit'), join(repo, 'pc-ran'), 1)
			await expect(git(repo, ['commit', '-q', '-m', 'vetoed by repo hook'], cfgSessionEnv())).rejects.toThrow()
			expect(await subjectOf(repo, 'HEAD')).toBe('seed')
		})

		it('stamps from a SPACED state dir; the unquoted command it protects against hard-fails', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return
			// git runs configured hooks via `sh -c '<command> "$@"'` — a spaced path word-splits
			// raw, which is why the entry builder shell-quotes the command value.
			const spaced = await mkdtemp(join(tmpdir(), 'session hooks state '))
			tempDirs.push(spaced)
			const prior = process.env.RIPTIDE_STATE_DIR
			process.env.RIPTIDE_STATE_DIR = spaced
			try {
				const { install } = await armFor(repo)
				expect(install.armed).toBe(true)
				await commit(repo, 'sp.txt', 'agent from spaced state dir', cfgSessionEnv())
				expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)

				// The raw (unquoted) command is not merely a no-op: sh word-splits it, the command
				// exits 127, and the configured-hook failure ABORTS the commit.
				const raw = {
					...process.env,
					GIT_CONFIG_COUNT: '2',
					GIT_CONFIG_KEY_0: 'hook.humanlayer-attribution.event',
					GIT_CONFIG_VALUE_0: 'prepare-commit-msg',
					GIT_CONFIG_KEY_1: 'hook.humanlayer-attribution.command',
					GIT_CONFIG_VALUE_1: join(sessionHooksDir(), CONFIG_STAMPER_NAME),
					HUMANLAYER_SESSION_ID: SESSION_ID,
				}
				await writeFile(join(repo, 'sp2.txt'), 'x\n')
				await git(repo, ['add', '.'], raw)
				await expect(git(repo, ['commit', '-q', '-m', 'raw spaced command'], raw)).rejects.toThrow()
			} finally {
				if (prior === undefined) delete process.env.RIPTIDE_STATE_DIR
				else process.env.RIPTIDE_STATE_DIR = prior
			}
		})

		it('leaves a husky repo fully intact — config registration shadows NOTHING', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return
			await mkdir(join(repo, '.husky'), { recursive: true })
			await writeFile(
				join(repo, '.husky', 'prepare-commit-msg'),
				'#!/bin/sh\nprintf "\\nX-Husky: ran\\n" >> "$1"\n',
			)
			await chmod(join(repo, '.husky', 'prepare-commit-msg'), 0o755)
			await git(repo, ['config', 'core.hooksPath', '.husky'])

			await commit(repo, 'hk.txt', 'agent in husky repo, config mode', cfgSessionEnv())
			const body = await bodyOf(repo, 'HEAD')
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
			expect(body.match(/X-Husky: ran/g)).toHaveLength(1)
		})

		it('the positive probe verdict lands in the capability cache as config-hooks', async (ctx) => {
			const repo = await makeRepo()
			if (!(await configModeOrSkip(ctx, repo))) return
			const cache = JSON.parse(await readFile(join(stateDir, 'git-capabilities.json'), 'utf-8')) as {
				configHooks?: unknown
			}
			expect(cache.configHooks).toBe(true)
		})
	})

	describe('read-side integration', () => {
		it('produces a trailer the daemon capture path parses back to the session id', async () => {
			const repo = await makeRepo()
			await armFor(repo)
			await commit(repo, 'r.txt', 'agent', sessionEnv())

			const body = await bodyOf(repo, 'HEAD')
			expect(parseSessionFromTrailer(body)).toBe(SESSION_ID)
			expect(commitReportsSession(body, SESSION_ID)).toBe(true)
		})
	})
})

describe('hostile paths', () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
	})

	it('survives a repo path containing an apostrophe and $& — repo hook forwarded, stamper runs', async () => {
		const base = await realpath(await mkdtemp(join(tmpdir(), 'session-hooks-quote-')))
		tempDirs.push(base)
		const repo = join(base, "it's $& repo")
		await mkdir(repo, { recursive: true })
		await git(repo, ['init', '-q'])
		await git(repo, ['config', 'user.email', 'dev@example.com'])
		await git(repo, ['config', 'user.name', 'Dev'])
		await writeFile(join(repo, 'seed.txt'), 'seed\n')
		await git(repo, ['add', '.'])
		await git(repo, ['commit', '-q', '-m', 'seed'])

		const sentinel = join(repo, 'repo-hook-ran')
		await writeSentinelHook(join(repo, '.git', 'hooks', 'prepare-commit-msg'), sentinel)

		const { install } = await armFor(repo)
		expect(install.armed).toBe(true)

		await commit(repo, 'q.txt', 'agent in hostile path', sessionEnv())
		expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBe(SESSION_ID)
		expect(await fileExists(sentinel)).toBe(true)

		await commit(repo, 'h.txt', 'human in hostile path')
		expect(await subjectOf(repo, 'HEAD')).toBe('human in hostile path')
		expect(parseSessionFromTrailer(await bodyOf(repo, 'HEAD'))).toBeUndefined()
	})
})
