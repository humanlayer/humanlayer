import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { useHermeticGitConfig } from '@humanlayer/git-attribution/testing'
import { describe, expect, test } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'

import { WATCH_RETENTION_MS } from './commit-watcher'
import type { ObservedRepository } from './repository-observer'
import { startRepositoryObserver } from './repository-observer'

useHermeticGitConfig()

// --- Integration harness: the real observer loop over real temp git repos, with fake
// --- DaemonServices recording every report, and fast timings. Skipped cleanly when git
// --- is unavailable.

const execFileAsync = promisify(execFile)

const git = (dir: string, args: string[]) => execFileAsync('git', args, { cwd: dir })

// Resolved via top-level await so describe.skipIf gets a plain boolean without any
// sync child_process call (no *Sync APIs anywhere, tests included).
const gitAvailable = await execFileAsync('git', ['--version']).then(
	() => true,
	() => false,
)

const TIMINGS = { reconcileIntervalMs: 100, observeDebounceMs: 5 }

const ORIGIN_URL = 'https://github.com/owner/repo.git'

/** Poll until `fn` is truthy; throws with `label` on timeout so failures name the condition. */
async function until(fn: () => boolean | Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await fn()) return
		await new Promise((r) => setTimeout(r, 25))
	}
	throw new Error(`timed out waiting for: ${label}`)
}

/** A settle window: several reconcile cycles pass with no new reports. */
const settle = () => new Promise((r) => setTimeout(r, TIMINGS.reconcileIntervalMs * 4))

type FakeSession = {
	id: string
	working_directory: string
	task_id: string | null
	host_id: string
	status: string
	updated_at: bigint
}

type Report = { sessionId: string; repositories: ObservedRepository[] }

/** Fake DaemonServices: mutable session list plus a report sink. */
function makeFakeServices() {
	const sessions: FakeSession[] = []
	const reports: Report[] = []

	const services = {
		collections: {
			sessions: {
				get toArray() {
					return sessions
				},
			},
			tasks: { toArray: [], get: () => undefined },
			workspaceSetup: { toArray: [] },
		},
		orpc: {
			sessions: {
				repositories: {
					report: async (input: Report) => {
						reports.push(input)
						return { recorded: input.repositories.length }
					},
				},
			},
		},
	} as unknown as DaemonServices

	return { services, sessions, reports }
}

async function makeRepo(options: { remote?: boolean } = {}): Promise<string> {
	const created = await mkdtemp(join(tmpdir(), 'repository-observer-repo-'))
	// Git canonicalizes macOS's /var symlink to /private/var. Assert against the same path
	// the observer reports (`rev-parse --show-toplevel`).
	const dir = await realpath(created)
	await git(dir, ['init', '-q', '-b', 'main'])
	for (const [k, v] of [
		['user.email', 'dev@example.com'],
		['user.name', 'Dev'],
	] as const) {
		await git(dir, ['config', k, v])
	}
	if (options.remote !== false) await git(dir, ['remote', 'add', 'origin', ORIGIN_URL])
	await writeFile(join(dir, 'work.txt'), 'seed\n')
	await git(dir, ['add', '.'])
	await git(dir, ['commit', '-q', '-m', 'seed'])
	return dir
}

const runningSession = (id: string, dir: string): FakeSession => ({
	id,
	working_directory: dir,
	task_id: null,
	host_id: 'host-1',
	status: 'running',
	updated_at: BigInt(Date.now()),
})

describe.skipIf(!gitAvailable)('startRepositoryObserver (integration)', () => {
	test('reports the repo root, its origin remote and the branch HEAD is on, then stays silent', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '019c0000-0000-7000-8000-000000000001'
		let observer: ReturnType<typeof startRepositoryObserver> | undefined
		try {
			fake.sessions.push(runningSession(sessionId, dir))
			observer = startRepositoryObserver(fake.services, TIMINGS)

			await until(() => fake.reports.length >= 1, 'first observation reported')
			expect(fake.reports[0]).toEqual({
				sessionId,
				repositories: [{ localPath: dir, remoteUrl: ORIGIN_URL, branch: 'main' }],
			})

			// Change-only reporting: the poll keeps probing, but an unchanged snapshot says nothing.
			await settle()
			expect(fake.reports).toHaveLength(1)
		} finally {
			observer?.stop()
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a branch the session creates mid-run is reported as a new snapshot', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '019c0000-0000-7000-8000-000000000002'
		let observer: ReturnType<typeof startRepositoryObserver> | undefined
		try {
			fake.sessions.push(runningSession(sessionId, dir))
			observer = startRepositoryObserver(fake.services, TIMINGS)
			await until(() => fake.reports.length >= 1, 'first observation reported')

			await git(dir, ['checkout', '-q', '-b', 'agent-created'])

			await until(() => fake.reports.length >= 2, 'new branch reported')
			expect(fake.reports[1]).toEqual({
				sessionId,
				repositories: [{ localPath: dir, remoteUrl: ORIGIN_URL, branch: 'agent-created' }],
			})
		} finally {
			observer?.stop()
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a detached HEAD is reported as a repository with no branch', async () => {
		const dir = await makeRepo({ remote: false })
		const fake = makeFakeServices()
		const sessionId = '019c0000-0000-7000-8000-000000000003'
		let observer: ReturnType<typeof startRepositoryObserver> | undefined
		try {
			fake.sessions.push(runningSession(sessionId, dir))
			observer = startRepositoryObserver(fake.services, TIMINGS)
			await until(() => fake.reports.length >= 1, 'first observation reported')

			const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
			await git(dir, ['checkout', '-q', '--detach', head])

			await until(() => fake.reports.length >= 2, 'detached HEAD reported')
			// A repo with no remote reports no remoteUrl either — both absences are real states,
			// never guesses.
			expect(fake.reports[1]).toEqual({ sessionId, repositories: [{ localPath: dir }] })
		} finally {
			observer?.stop()
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a session that leaves the live set is forgotten and reports again when it returns', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '019c0000-0000-7000-8000-000000000004'
		let observer: ReturnType<typeof startRepositoryObserver> | undefined
		try {
			const session = runningSession(sessionId, dir)
			fake.sessions.push(session)
			observer = startRepositoryObserver(fake.services, TIMINGS)
			await until(() => fake.reports.length >= 1, 'first observation reported')

			// Resting status, updated beyond the retention window: no longer watch-relevant.
			session.status = 'ready_for_input'
			session.updated_at = BigInt(Date.now() - WATCH_RETENTION_MS - 60_000)
			await settle()
			expect(fake.reports).toHaveLength(1)

			// Back in the live set: the forgotten signature means the snapshot is reported again,
			// which is what re-establishes the link after a daemon-side gap.
			session.status = 'running'
			session.updated_at = BigInt(Date.now())
			await until(() => fake.reports.length >= 2, 'returning session reported again')
			expect(fake.reports[1]).toEqual(fake.reports[0])
		} finally {
			observer?.stop()
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('observeSession reports without waiting for the next reconcile', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '019c0000-0000-7000-8000-000000000005'
		let observer: ReturnType<typeof startRepositoryObserver> | undefined
		try {
			// A reconcile interval far beyond the test: only observeSession can produce a report.
			observer = startRepositoryObserver(fake.services, {
				reconcileIntervalMs: 600_000,
				observeDebounceMs: 5,
			})
			await settle()
			expect(fake.reports).toHaveLength(0)

			fake.sessions.push(runningSession(sessionId, dir))
			await observer.observeSession(sessionId)

			expect(fake.reports).toEqual([
				{ sessionId, repositories: [{ localPath: dir, remoteUrl: ORIGIN_URL, branch: 'main' }] },
			])

			// Coalescing: concurrent calls collapse into one probe, and an unchanged snapshot is
			// still not reported twice.
			await Promise.all([observer.observeSession(sessionId), observer.observeSession(sessionId)])
			expect(fake.reports).toHaveLength(1)
		} finally {
			observer?.stop()
			await rm(dir, { recursive: true, force: true })
		}
	})
})
