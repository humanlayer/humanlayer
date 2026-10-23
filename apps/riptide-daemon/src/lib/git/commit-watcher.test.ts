import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { codingTools } from '@humanlayer/fold-agent'
import { readAuthorshipJournal, removeAuthorshipJournal } from '@humanlayer/git-attribution'
import {
	authorshipJournalPath,
	recordAgentEditToJournal,
	useHermeticGitConfig,
} from '@humanlayer/git-attribution/testing'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { commitAttributionEnv } from '@/lib/git/commit-attribution'
import { orgTelemetryCache } from '@/lib/org-telemetry-settings'

import { runFoldTool } from '../../../test/helpers/run-fold-tool'
import { isWatchRelevant, startCommitWatcher, WATCH_RETENTION_MS } from './commit-watcher'

useHermeticGitConfig()

// The authorship journal is on-disk state shared daemon<->CLI; pin it to a temp dir so the
// suite never touches (or depends on) the developer's real ~/.humanlayer/riptide.
let priorStateDir: string | undefined
beforeAll(async () => {
	priorStateDir = process.env.RIPTIDE_STATE_DIR
	process.env.RIPTIDE_STATE_DIR = await mkdtemp(join(tmpdir(), 'commit-watcher-state-'))
})
afterAll(async () => {
	const dir = process.env.RIPTIDE_STATE_DIR
	if (priorStateDir === undefined) delete process.env.RIPTIDE_STATE_DIR
	else process.env.RIPTIDE_STATE_DIR = priorStateDir
	if (dir) await rm(dir, { recursive: true, force: true })
})

const NOW = 1_783_700_000_000

describe('isWatchRelevant', () => {
	test('active statuses are watched regardless of age', () => {
		for (const status of ['launching', 'running', 'needs_approval', 'interrupt_requested', 'resuming']) {
			expect(isWatchRelevant({ status, updated_at: 0n }, NOW)).toBe(true)
		}
	})

	test('resting statuses are watched only within the retention window', () => {
		for (const status of ['ready_for_input', 'failed', 'interrupted', 'draft']) {
			// Exactly at the boundary counts as inside; one ms past it does not.
			expect(isWatchRelevant({ status, updated_at: BigInt(NOW - WATCH_RETENTION_MS) }, NOW)).toBe(true)
			expect(isWatchRelevant({ status, updated_at: BigInt(NOW - WATCH_RETENTION_MS - 1) }, NOW)).toBe(false)
		}
	})

	test('a missing updated_at on a resting session is treated as ancient (not watched)', () => {
		expect(isWatchRelevant({ status: 'ready_for_input', updated_at: null }, NOW)).toBe(false)
	})

	test('a future updated_at (clock skew) stays watched', () => {
		expect(isWatchRelevant({ status: 'ready_for_input', updated_at: BigInt(NOW + 60_000) }, NOW)).toBe(true)
	})
})

// --- Integration harness: the real watcher loop over a real git repo, with fake
// --- DaemonServices (in-memory watermark store + (org, sha)-deduping record sink)
// --- and fast timings. Skipped cleanly when git is unavailable.

const execFileAsync = promisify(execFile)

const git = (dir: string, args: string[]) => execFileAsync('git', args, { cwd: dir })

// Resolved via top-level await so describe.skipIf gets a plain boolean without any
// sync child_process call (no *Sync APIs anywhere, tests included).
const gitAvailable = await execFileAsync('git', ['--version']).then(
	() => true,
	() => false,
)

const TIMINGS = { reconcileIntervalMs: 100, scanDebounceMs: 40 }

/** Poll until `fn` is truthy; throws with `label` on timeout so failures name the condition. */
async function until(fn: () => boolean | Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await fn()) return
		await new Promise((r) => setTimeout(r, 25))
	}
	throw new Error(`timed out waiting for: ${label}`)
}

/** A settle window: several reconcile cycles pass with no new records/watermark writes. */
const settle = () => new Promise((r) => setTimeout(r, TIMINGS.reconcileIntervalMs * 4))

type FakeSession = {
	id: string
	working_directory: string
	task_id: string | null
	status: string
	updated_at: bigint
}

type ObservedRecord = { sha: string; attributionMethod: string; attributedSessionId?: string; subject: string }

/** Fake DaemonServices: mutable session list, in-memory watermarks, deduping record sink. */
function makeFakeServices() {
	const sessions: FakeSession[] = []
	const watermarks = new Map<string, string>()
	const recordedShas = new Set<string>()
	const observed: ObservedRecord[] = []
	const watermarkWrites: string[] = []

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
			commits: {
				watermark: {
					get: async ({ repoDirectories }: { repoDirectories: string[] }) => ({
						watermarks: repoDirectories.map((repoDirectory) => ({
							repoDirectory,
							lastSeenSha: watermarks.get(repoDirectory) ?? null,
						})),
					}),
					set: async ({ repoDirectory, lastSeenSha }: { repoDirectory: string; lastSeenSha: string }) => {
						watermarks.set(repoDirectory, lastSeenSha)
						watermarkWrites.push(lastSeenSha)
						return { ok: true }
					},
				},
				recordObserved: async ({ commits }: { commits: ObservedRecord[] }) => {
					let recorded = 0
					for (const commit of commits) {
						observed.push(commit)
						if (!recordedShas.has(commit.sha)) {
							recordedShas.add(commit.sha)
							recorded++
						}
					}
					return { recorded }
				},
			},
		},
	} as unknown as DaemonServices

	return { services, sessions, watermarks, recordedShas, observed, watermarkWrites }
}

async function makeRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'commit-watcher-repo-'))
	await git(dir, ['init', '-q'])
	for (const [k, v] of [
		['user.email', 'dev@example.com'],
		['user.name', 'Dev'],
	] as const) {
		await git(dir, ['config', k, v])
	}
	// Git canonicalizes macOS's /var symlink to /private/var. Use the same path for
	// fake watermark keys so assertions observe the watcher's resolved repo root.
	return realpath(dir)
}

async function commit(dir: string, subject: string, opts: { file?: string; content?: string; body?: string } = {}) {
	await writeFile(join(dir, opts.file ?? 'work.txt'), opts.content ?? `${subject}\n`)
	await git(dir, ['add', '.'])
	const args = ['commit', '-q', '-m', subject, ...(opts.body ? ['-m', opts.body] : [])]
	await git(dir, args)
	return (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
}

const runningSession = (id: string, dir: string): FakeSession => ({
	id,
	working_directory: dir,
	task_id: null,
	status: 'running',
	updated_at: BigInt(Date.now()),
})

describe.skipIf(!gitAvailable)('startCommitWatcher (integration)', () => {
	// The watcher is gated on the org opt-in (isCommitAttributionEnabled), re-checked every
	// reconcile. The opt-in defaults OFF, and without it every test here would sit inert
	// forever. Open the gate per test; the gate-flip test below drives the flag itself (it
	// starts from reset), and beforeEach re-opens it for the rest.
	beforeEach(() => {
		orgTelemetryCache.set({ commitTrackingEnabled: true, prTrackingEnabled: false })
	})
	afterAll(() => {
		orgTelemetryCache.reset()
	})

	test('first scan records the bounded recent window, then new commits — confirmed via trailer, human without', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			const preexisting = await commit(dir, 'pre-history')
			fake.sessions.push(runningSession(sessionId, dir))

			watcher = startCommitWatcher(fake.services, TIMINGS)

			// First scan: watermark initialized to HEAD AND the recent pre-existing commit is
			// recorded (the old record-nothing init permanently lost every commit made before
			// the repo entered the watch set — systematic with worktree-per-task, where the
			// task's first commits land before the session row makes the repo watched).
			await until(() => fake.watermarks.get(dir) === preexisting, 'watermark init at pre-existing HEAD')
			await until(() => fake.recordedShas.has(preexisting), 'recent pre-watch commit backfilled')
			expect(fake.observed.find((c) => c.sha === preexisting)?.attributionMethod).toBe('human')

			// New commits: one trailer-stamped (agent), one plain (human), one with a MALFORMED
			// trailer — the wedge class: a garbage segment must flow through as human with NO
			// attributedSessionId (a non-UUID reaching the contract's z.uuid() would reject the
			// whole batch and freeze this repo's watermark forever).
			const agentSha = await commit(dir, 'agent work', {
				body: `HumanLayer-Session: https://app.test/sessions/${sessionId}`,
			})
			const humanSha = await commit(dir, 'human work', { file: 'other.txt' })
			const malformedSha = await commit(dir, 'malformed trailer', {
				file: 'third.txt',
				body: 'HumanLayer-Session: https://app.test/sessions/oops-not-a-uuid',
			})

			await until(() => fake.watermarks.get(dir) === malformedSha, 'watermark advanced to new HEAD')
			await until(
				() =>
					fake.recordedShas.has(agentSha) &&
					fake.recordedShas.has(humanSha) &&
					fake.recordedShas.has(malformedSha),
				'all three commits recorded',
			)

			const agent = fake.observed.find((c) => c.sha === agentSha)
			expect(agent?.attributionMethod).toBe('confirmed')
			expect(agent?.attributedSessionId).toBe(sessionId)
			const human = fake.observed.find((c) => c.sha === humanSha)
			expect(human?.attributionMethod).toBe('human')
			expect(human?.attributedSessionId).toBeUndefined()
			const malformed = fake.observed.find((c) => c.sha === malformedSha)
			expect(malformed?.attributionMethod).toBe('human')
			expect(malformed?.attributedSessionId).toBeUndefined()

			// Idle: watermark writes stop (write-only-on-change) and nothing is re-recorded.
			const writesAtConvergence = fake.watermarkWrites.length
			const recordedAtConvergence = fake.recordedShas.size
			await settle()
			expect(fake.watermarkWrites.length).toBe(writesAtConvergence)
			expect(fake.recordedShas.size).toBe(recordedAtConvergence)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('attributes commits created by a Fold Bash subprocess through the shared watcher', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000010'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, TIMINGS)
			await until(() => fake.watermarks.has(dir), 'watermark init')

			const processEnvironment = await commitAttributionEnv(sessionId, { cwd: dir, codingAgent: 'fold' })
			const bash = codingTools({ cwd: dir, processEnvironment }).find((tool) => tool.name === 'bash')
			if (bash === undefined) throw new Error('Fold coding tools did not include Bash')
			const result = await Effect.runPromise(
				runFoldTool({
					tool: bash,
					parameters: {
						command:
							"printf 'created by Fold\\n' > fold.txt && git add fold.txt && git commit -m 'Fold attributed commit'",
					},
				}),
			)
			expect(result).toMatchObject({ _tag: 'text', text: expect.stringContaining('Fold attributed commit') })

			const foldCommitSha = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
			await until(() => fake.recordedShas.has(foldCommitSha), 'Fold commit recorded')
			const observed = fake.observed.find((candidate) => candidate.sha === foldCommitSha)
			expect(observed?.attributionMethod).toBe('confirmed')
			expect(observed?.attributedSessionId).toBe(sessionId)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('infers attribution from in-memory authorship when a human commits the agent’s lines', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '019b049c-950d-7baa-b9a8-b9364599319b'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, TIMINGS)
			await until(() => fake.watermarks.has(dir), 'watermark init')

			// The agent "writes" content during the session; a human commits that content
			// with no trailer — the line-hash overlap must yield INFERRED, not human. Three
			// distinct lines: the v2 gate requires a substantial overlap (>= 3 matched lines at
			// >= 0.25 fraction), exactly so a single boilerplate collision can no longer infer.
			const agentContent = 'const inferred_line = 42\nconst other_line = 43\nconst third_line = 44'
			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: agentContent })
			const sha = await commit(dir, 'human commits agent work', {
				file: 'agent.ts',
				content: `${agentContent}\n`,
			})

			await until(() => fake.recordedShas.has(sha), 'inferred commit recorded')
			const row = fake.observed.find((c) => c.sha === sha)
			expect(row?.attributionMethod).toBe('inferred')
			expect(row?.attributedSessionId).toBe(sessionId)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('a repo with no commits yet is polled until born, then its first burst is recorded', async () => {
		// Unborn repo: scans return null (skip) and the reflog doesn't exist to fs-watch —
		// the reconcile poll must keep retrying (and re-arm the watcher) instead of erroring
		// out or spinning. Once the repo is born, the watermark initializes and the birth
		// commit itself is recorded (it is inside the first-scan lookback window — losing the
		// FIRST commit was exactly the worktree-per-task hole).
		const dir = await makeRepo() // git init, NO commits
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000002'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, TIMINGS)

			// Several reconcile cycles on the unborn repo: no watermark, no records, no crash.
			await settle()
			expect(fake.watermarks.has(dir)).toBe(false)
			expect(fake.observed).toHaveLength(0)

			// Repo is born: the poll initializes the watermark at the first HEAD and records it.
			const first = await commit(dir, 'first commit')
			await until(() => fake.watermarks.get(dir) === first, 'watermark initialized once born')
			await until(() => fake.recordedShas.has(first), 'birth commit recorded')

			// And the loop is fully live from there (fs.watch re-armed or poll — either path).
			const second = await commit(dir, 'second commit', { file: 'two.txt' })
			await until(() => fake.recordedShas.has(second), 'post-birth commit recorded')
			expect(fake.watermarks.get(dir)).toBe(second)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('every human-tier commit is redacted to counting fields — clean, co-authored, and mangled-trailer alike', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000005'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, TIMINGS)
			await until(() => fake.watermarks.has(dir), 'watermark init')

			// (1) A clean human commit: HumanLayer had nothing to do with it. The row must stay
			// COUNTABLE (sha, aggregate numstat, timestamps) but carry no content — no message,
			// no author identity, no per-file paths, no branch. Redacted daemon-side, so the
			// sensitive fields are never even sent.
			const humanSha = await commit(dir, 'internal: secret incident details', { file: 'secret-system.ts' })
			await until(() => fake.recordedShas.has(humanSha), 'human commit recorded')
			const human = fake.observed.find((c) => c.sha === humanSha) as unknown as Record<string, unknown>
			expect(human.attributionMethod).toBe('human')
			expect(human.subject).toBe('')
			expect(human.body).toBeUndefined()
			expect(human.authorName).toBeUndefined()
			expect(human.authorEmail).toBeUndefined()
			expect(human.fileStats).toBeUndefined()
			expect(human.branch).toBeUndefined()
			expect(human.additions).toBeGreaterThan(0) // aggregate counts survive
			expect(human.committedAt).toBeTypeOf('number')

			// (2) A commit whose only agent signal is a Co-Authored-By line: some agent tool made
			// it (Claude Code standalone, Codex, Cursor) — but not provably through HumanLayer, so
			// its content is none of our business either. Redacted like any bystander commit; the
			// coAuthoredByAgent boolean is a counting field, so the trend still reaches the ledger.
			const coauthoredSha = await commit(dir, 'agent-assisted elsewhere', {
				file: 'assisted.ts',
				body: 'Co-Authored-By: Claude <noreply@anthropic.com>',
			})
			await until(() => fake.recordedShas.has(coauthoredSha), 'co-authored commit recorded')
			const coauthored = fake.observed.find((c) => c.sha === coauthoredSha) as unknown as Record<string, unknown>
			expect(coauthored.attributionMethod).toBe('human')
			expect(coauthored.subject).toBe('')
			expect(coauthored.body).toBeUndefined()
			expect(coauthored.authorName).toBeUndefined()
			expect(coauthored.coAuthoredByAgent).toBe(true) // the counting field survives redaction

			// (3) An UNPARSEABLE session trailer (non-UUID): our own stamp gone wrong, but there is
			// no kept-but-unclaimed middle class — it heaps with the human commits and is redacted
			// the same way.
			const malformedSha = await commit(dir, 'trailer that failed to parse', {
				file: 'malformed.ts',
				body: 'HumanLayer-Session: https://app.test/sessions/not-a-uuid',
			})
			await until(() => fake.recordedShas.has(malformedSha), 'malformed-trailer commit recorded')
			const malformed = fake.observed.find((c) => c.sha === malformedSha) as unknown as Record<string, unknown>
			expect(malformed.attributionMethod).toBe('human')
			expect(malformed.subject).toBe('')
			expect(malformed.body).toBeUndefined()
			expect(malformed.authorName).toBeUndefined()
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('gate flips take effect WITHOUT a restart: inert while off, adopts repos when the org opts in', async () => {
		// The shipped bug: the gate was evaluated once at daemon boot, so an org flipping
		// commit_tracking_enabled mid-run got trailers (per-session settings refresh) but an
		// empty ledger until the daemon restarted. The watcher must re-check every reconcile.
		orgTelemetryCache.reset()
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000004'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, TIMINGS)

			// Gate OFF: fully inert — no watermark reads/writes, nothing recorded.
			await settle()
			expect(fake.watermarks.has(dir)).toBe(false)
			expect(fake.observed).toHaveLength(0)

			// The org opts in (a session-launch settings fetch populates the cache). No restart.
			orgTelemetryCache.set({ commitTrackingEnabled: true, prTrackingEnabled: false })
			await until(() => fake.watermarks.has(dir), 'watcher adopted the repo after the flip')

			const sha = await commit(dir, 'after the flip', { file: 'flip.txt' })
			await until(() => fake.recordedShas.has(sha), 'commit recorded after the flip')

			// And back OFF: the watcher goes quiet again (no new records), evidence preserved.
			orgTelemetryCache.reset()
			await settle()
			const recordedAtOff = fake.recordedShas.size
			await commit(dir, 'while off', { file: 'off.txt' })
			await settle()
			expect(fake.recordedShas.size).toBe(recordedAtOff)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			orgTelemetryCache.reset()
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('an fs.watch error event does not crash the daemon: watcher closes, poll carries on, re-arm happens', async () => {
		// An unhandled 'error' EVENT on an FSWatcher kills the process — the one fail-hard
		// path this module ever had. Synthesize one through the watchFn seam and prove the
		// loop survives it, keeps scanning via the poll, and re-arms a fresh watcher.
		const { EventEmitter } = await import('node:events')
		class FakeFSWatcher extends EventEmitter {
			closed = false
			close() {
				this.closed = true
			}
		}
		const created: FakeFSWatcher[] = []
		const watchFn = ((_path: string) => {
			const w = new FakeFSWatcher()
			created.push(w)
			return w
		}) as unknown as typeof import('node:fs').watch

		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000003'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			fake.sessions.push(runningSession(sessionId, dir))
			watcher = startCommitWatcher(fake.services, { ...TIMINGS, watchFn })
			await until(() => fake.watermarks.has(dir), 'watermark init')
			await until(() => created.length >= 1, 'first fs watcher armed')

			// The watcher dies. Handled => no crash; it closes; the next reconcile re-arms.
			const createdBeforeError = created.length
			const activeWatcher = created.at(-1)!
			activeWatcher.emit('error', new Error('synthetic inotify failure'))
			expect(activeWatcher.closed).toBe(true)
			await until(() => created.length > createdBeforeError, 'watcher re-armed by reconcile')

			// The loop never stopped observing: a commit made after the death is recorded
			// (the fake watchers emit no change events, so this also proves the poll path).
			const sha = await commit(dir, 'after watcher death', { file: 'after.txt' })
			await until(() => fake.recordedShas.has(sha), 'commit recorded after watcher death')
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})

	test('filtering a session out unwatches its repo and drops its authorship; stop() halts everything', async () => {
		const dir = await makeRepo()
		const fake = makeFakeServices()
		const sessionId = '01900000-0000-7000-8000-000000000001'
		let watcher: ReturnType<typeof startCommitWatcher> | undefined
		try {
			await commit(dir, 'seed')
			const session = runningSession(sessionId, dir)
			fake.sessions.push(session)
			watcher = startCommitWatcher(fake.services, TIMINGS)
			await until(() => fake.watermarks.has(dir), 'watermark init')
			await recordAgentEditToJournal(sessionId, 'Edit', { new_string: 'soon to be cleared' })

			// Session leaves the watch-relevant set: resting status, updated beyond retention —
			// AND the journal mtime aged past retention too (a fresh journal is a liveness signal
			// that deliberately keeps a session watched; see isWatchRelevant's third input).
			session.status = 'ready_for_input'
			session.updated_at = BigInt(Date.now() - WATCH_RETENTION_MS - 60_000)
			const aged = new Date(Date.now() - WATCH_RETENTION_MS - 60_000)
			await utimes(authorshipJournalPath(sessionId)!, aged, aged)

			// The reconcile drops the repo AND deletes the session's journal (the leak fix).
			await until(
				async () => (await readAuthorshipJournal(sessionId)).size === 0,
				'journal removed on filter-out',
			)

			// Commits made after the drop are not observed.
			const orphanSha = await commit(dir, 'after unwatch', { file: 'late.txt' })
			await settle()
			expect(fake.recordedShas.has(orphanSha)).toBe(false)
			expect(fake.watermarks.get(dir)).not.toBe(orphanSha)
		} finally {
			watcher?.stop()
			await removeAuthorshipJournal(sessionId)
			await rm(dir, { recursive: true, force: true })
		}
	})
})
