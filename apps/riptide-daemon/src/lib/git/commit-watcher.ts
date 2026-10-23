import { execFile } from 'node:child_process'
import { type FSWatcher, watch } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

import {
	ATTRIBUTION_ALGORITHM_VERSION,
	type AttributionResult,
	attributeCommit,
	JOURNAL_MAX_AGE_MS,
	listAuthorshipJournals,
	readAuthorshipJournal,
	redactCleanHumanCommit,
	removeAuthorshipJournal,
	sweepAuthorshipJournals,
} from '@humanlayer/git-attribution'
import {
	COMMIT_BATCH_LIMIT,
	COMMIT_COUNTING_FIELDS,
} from '@humanlayer/riptide-api-contract/daemon/sessions/commits/record'

import type { DaemonServices } from '@/agents/claudecode/types'
import { Sentry } from '@/instrument'
import { isCommitAttributionEnabled } from '@/lib/git/commit-attribution'
import { type CollectedCommit, collectCommitsForWatch, getAddedLines } from '@/lib/git/commit-tracker'
import { sessionRepoDirs } from '@/lib/git/session-repo-dirs'
import logger from '@/logger'

const execFileAsync = promisify(execFile)

/** fs-watch → scan debounce. Git bursts many `logs/HEAD` writes per operation (Cursor uses 5s). */
const SCAN_DEBOUNCE_MS = 5_000
/** Periodic reconcile: re-derives the watched-repo set from live sessions AND polls each repo (fs.watch fallback + downtime catch-up). */
const RECONCILE_INTERVAL_MS = 30_000
/** How often the reconcile sweeps orphaned authorship journals off disk (see ./authorship-journal). */
const JOURNAL_SWEEP_INTERVAL_MS = 30 * 60 * 1000
const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 16 * 1024 * 1024

// The daemon's sessions collection holds EVERY session ever run on this host (the Electric
// shape filters by org + host only, not status), so the watcher must bound its own view or
// its per-session state (sessionRoots, authorship sets, fs watchers, the 30s poll fan-out)
// grows for the daemon's whole lifetime — the 2026-07-10 memory leak. A session is
// watch-relevant while work is in flight, plus a recency window after its last update so
// the "human commits the agent's work right after the run ends" flow still gets INFERRED
// attribution (finished sessions rest at ready_for_input forever; status alone can't bound this).
const ACTIVE_STATUSES = new Set([
	'launching',
	'running',
	'waiting_for_usage_limit',
	'needs_approval',
	'interrupt_requested',
	'resuming',
])
/**
 * EQUAL BY CONSTRUCTION to the authorship journal's retention: as long as a session's
 * authored-line evidence exists, a human committing that work must still attribute as inferred.
 * The old 60-minute retention silently booked exactly those "review it after lunch, then commit"
 * flows as human. Cost of the longer window is bounded: it only keeps fs.watch handles on repos
 * of recently-active sessions.
 */
export const WATCH_RETENTION_MS = JOURNAL_MAX_AGE_MS

/**
 * Watch-relevant: work in flight, or updated recently enough that a follow-up human commit of the
 * session's work should still attribute. Exported for tests.
 *
 * `lastAgentEditAtMs` is a third signal independent of the session row's status/activity updates.
 * The authorship journal's mtime is direct evidence of a recent agent edit (see
 * `listAuthorshipJournals`), so retained authorship can keep a repository watched for a later commit.
 */
export function isWatchRelevant(
	session: { status: string; updated_at: bigint | number | null },
	nowMs: number,
	lastAgentEditAtMs?: number,
): boolean {
	if (ACTIVE_STATUSES.has(session.status)) return true
	if (lastAgentEditAtMs !== undefined && nowMs - lastAgentEditAtMs <= WATCH_RETENTION_MS) return true
	return nowMs - Number(session.updated_at ?? 0) <= WATCH_RETENTION_MS
}

/** Best-effort git probe; returns trimmed stdout or null on any failure. */
async function git(cwd: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: GIT_MAX_BUFFER,
			encoding: 'utf8',
		})
		return stdout.trim()
	} catch {
		return null
	}
}

export interface CommitWatcher {
	stop(): void
}

/** Seams for tests ONLY — production callers use the defaults. */
export interface CommitWatcherOptions {
	reconcileIntervalMs?: number
	scanDebounceMs?: number
	/** Swap fs.watch to synthesize watcher lifecycles (e.g. 'error' events) in tests. */
	watchFn?: typeof watch
}

interface WatchedRepo {
	fsWatcher?: FSWatcher
	debounce?: ReturnType<typeof setTimeout>
}

/**
 * The daemon HEAD-watch — the sensor that fills the commit ledger. For every repo a
 * live session touches, it watches `.git/logs/HEAD` (the reflog, appended on every
 * HEAD move) debounced; on a move it collects the commits since a Postgres watermark,
 * attributes each daemon-side (trailer → confirmed / agent line-match → inferred /
 * else human — the raw diff never leaves the machine), records them host-scoped, and
 * advances the watermark ONLY after a successful record. A periodic reconcile re-derives
 * the repo set from sessions and doubles as an fs.watch poll fallback + restart catch-up.
 * No local state — Postgres holds the watermark, git is the durable source, records are
 * idempotent on (org, sha).
 */
export function startCommitWatcher(services: DaemonServices, options: CommitWatcherOptions = {}): CommitWatcher {
	const reconcileIntervalMs = options.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS
	const scanDebounceMs = options.scanDebounceMs ?? SCAN_DEBOUNCE_MS
	const watchFn = options.watchFn ?? watch
	const watched = new Map<string, WatchedRepo>()
	const dirRootCache = new Map<string, string>() // resolved roots only — nulls are re-probed
	const sessionRoots = new Map<string, Set<string>>() // sessionId -> repo roots it works in
	let knownSessionIds = new Set<string>()
	const scanning = new Set<string>()
	const pending = new Set<string>()
	let stopped = false
	// 0 => the first reconcile sweeps, which is exactly when daemon-downtime orphans are cleared.
	let lastJournalSweepAt = 0

	async function resolveRoot(dir: string): Promise<string | null> {
		const cached = dirRootCache.get(dir)
		if (cached !== undefined) return cached
		const root = await git(dir, ['rev-parse', '--show-toplevel'])
		// Cache HITS only. A null cached until the dir left the watch set was a shipped trap: a
		// `launching` session observed before its worktree materialized would never get its repo
		// watched (and the first-scan backfill never fired). Re-probing an unresolvable dir costs
		// one git spawn per reconcile — cheap insurance against permanently losing a repo.
		if (!root) return null
		dirRootCache.set(dir, root)
		return root
	}

	/** Tear down one repo's watch state (debounce + fs watcher + map entry). */
	function unwatch(root: string): void {
		const entry = watched.get(root)
		if (!entry) return
		if (entry.debounce) clearTimeout(entry.debounce)
		entry.fsWatcher?.close()
		watched.delete(root)
	}

	/**
	 * Candidate sessions for the INFERRED tier: those working in this repo that carry agent
	 * authorship. Every producer — the daemon's SDK event stream, the codelayer postToolUse hook,
	 * and the terminal CLI's PostToolUse hook process — writes the SAME on-disk journal
	 * (@humanlayer/git-attribution authorship-journal), so the tier behaves identically no matter
	 * how the session was launched, and the evidence survives a daemon restart.
	 */
	async function candidatesFor(root: string): Promise<Array<{ sessionId: string; authorship: Set<string> }>> {
		const out: Array<{ sessionId: string; authorship: Set<string> }> = []
		for (const [sessionId, roots] of sessionRoots) {
			if (!roots.has(root)) continue
			const authorship = await readAuthorshipJournal(sessionId)
			if (authorship.size > 0) out.push({ sessionId, authorship })
		}
		return out
	}

	async function scanRepo(root: string): Promise<void> {
		// The gate can flip off between a scan being scheduled (debounce, `pending` coalescing)
		// and running — re-check here so an opted-out org never gets one more recordObserved.
		if (stopped || !isCommitAttributionEnabled()) return
		if (scanning.has(root)) {
			pending.add(root) // a scan is running; coalesce one more pass after it finishes
			return
		}
		scanning.add(root)
		try {
			const { watermarks } = await services.orpc.commits.watermark.get({ repoDirectories: [root] })
			const since = watermarks[0]?.lastSeenSha ?? null
			const scan = await collectCommitsForWatch(root, since)
			if (scan === null) return // HEAD unresolvable (unborn repo / transient failure): retry next poll
			const { commits } = scan

			// A drop means one pathological merge exceeded the absolute per-scan ceiling and the
			// watermark is advancing past uncollected commits — rare and deliberate, never silent.
			if (scan.dropped > 0) {
				logger.warn(
					{ repo: root, dropped: scan.dropped, watermark: scan.watermark },
					'HEAD-watch advanced past commits beyond the forced-closure ceiling',
				)
				Sentry.captureMessage('HEAD-watch dropped commits beyond forced-closure ceiling', {
					tags: { error_type: 'commit_watch_forced_drop' },
				})
			}
			// A hold means every `git show` in the window failed at the exec level (systemic:
			// load/OOM) — the watermark stays put and the next scan retries the window.
			if (scan.held) {
				logger.warn(
					{ repo: root, watermark: scan.watermark },
					'HEAD-watch held watermark: git show failed for the entire window; retrying next scan',
				)
				Sentry.captureMessage('HEAD-watch held watermark on systemic git failure', {
					tags: { error_type: 'commit_watch_window_held' },
				})
			}
			// A skip means a listed commit failed `git show`/parse and the watermark moved past
			// it. Best-effort per commit is right (one weird commit must not stall the repo),
			// but silently absorbing it is not.
			if (scan.skipped > 0) {
				logger.warn(
					{ repo: root, skipped: scan.skipped, watermark: scan.watermark },
					'HEAD-watch skipped unparseable commits',
				)
				Sentry.captureMessage('HEAD-watch skipped unparseable commits', {
					tags: { error_type: 'commit_watch_parse_skip' },
				})
			}

			let recorded = 0
			if (commits.length > 0) {
				const candidates = await candidatesFor(root)
				const observed: Array<
					CollectedCommit & {
						attributionMethod: AttributionResult['tier']
						attributedSessionId?: string
						aiConfidence: number
						aiAttributedLines: number
						attributionAlgorithmVersion: number
					}
				> = []
				for (const c of commits) {
					// Added-line content stays local — only the attribution verdict + counts are sent.
					const addedLines = await getAddedLines(root, c.sha)
					const result = attributeCommit({
						body: c.body,
						addedLines,
						candidates,
					})
					// The tier IS the privacy verdict: `human` ships counting fields only — the
					// contract owns WHICH fields those are, next to CommitSchema itself.
					const record = result.tier === 'human' ? redactCleanHumanCommit(c, COMMIT_COUNTING_FIELDS) : c
					observed.push({
						...record,
						attributionMethod: result.tier,
						attributedSessionId: result.sessionId,
						aiConfidence: result.confidence,
						aiAttributedLines: result.aiAttributedLines,
						attributionAlgorithmVersion: ATTRIBUTION_ALGORITHM_VERSION,
					})
				}

				for (let i = 0; i < observed.length; i += COMMIT_BATCH_LIMIT) {
					const batch = observed.slice(i, i + COMMIT_BATCH_LIMIT)
					const result = await services.orpc.commits.recordObserved({ commits: batch })
					recorded += result.recorded
				}
			}

			// Advance the watermark ONLY after a successful record. The watermark is an ancestry
			// cut computed by collectCommitsForWatch — every recorded commit is an ancestor of it,
			// so the next window can never re-list them (see its doc for why "last collected sha"
			// wedges on merge-heavy histories). It also moves on empty scans (first scan of a repo
			// initializes to HEAD). A crash before this leaves the watermark behind → the next
			// scan re-derives, and the record is idempotent on (org, sha), so nothing double-counts.
			if (scan.watermark !== since) {
				await services.orpc.commits.watermark.set({ repoDirectory: root, lastSeenSha: scan.watermark })
			}
			if (commits.length > 0) {
				logger.info({ repo: root, observed: commits.length, recorded }, 'Recorded HEAD-watch commits')
			}
		} catch (error) {
			logger.error({ repo: root, error }, 'Commit HEAD-watch scan failed')
			Sentry.captureException(error, { tags: { error_type: 'commit_watch_scan' } })
		} finally {
			scanning.delete(root)
			if (pending.has(root)) {
				pending.delete(root)
				void scanRepo(root)
			}
		}
	}

	function scheduleScan(root: string): void {
		const entry = watched.get(root)
		if (!entry) return
		if (entry.debounce) clearTimeout(entry.debounce)
		entry.debounce = setTimeout(() => void scanRepo(root), scanDebounceMs)
	}

	async function ensureWatcher(root: string): Promise<void> {
		// Re-arm when the entry exists but its watcher is gone (reflog absent at first
		// attempt, or the watcher died and was dropped by its error handler below) — the
		// poll covers the gap in between.
		const existing = watched.get(root)
		if (existing?.fsWatcher) return
		const entry: WatchedRepo = existing ?? {}
		if (!existing) watched.set(root, entry)
		// Watch the reflog: one append-only file that moves on every HEAD change. It may
		// not exist until the first commit — the periodic reconcile re-attempts and polls.
		//
		// Plain fs.watch (not chokidar): chokidar earns its keep for recursive/glob watching
		// and cross-platform event normalization, but this is a single known file where the
		// event is only a debounced "something happened" trigger — misses, duplicate events,
		// and dead watchers are all absorbed by the 30s reconcile poll above, which rescans
		// every watched repo regardless. The watch is a latency optimization, not the source
		// of truth, so the dependency wouldn't buy correctness here.
		const reflogRel = await git(root, ['rev-parse', '--git-path', 'logs/HEAD'])
		if (reflogRel) {
			const reflogPath = isAbsolute(reflogRel) ? reflogRel : join(root, reflogRel)
			try {
				const watcher = watchFn(reflogPath, () => scheduleScan(root))
				// fs.watch surfaces ASYNC failures (reflog rotated away, inotify pressure,
				// network filesystems) as 'error' EVENTS — unhandled, they crash the whole
				// daemon. Fail soft instead: drop the watcher and fall back to the reconcile
				// poll, whose next pass re-arms via the fsWatcher-missing check above.
				watcher.on('error', (error) => {
					logger.warn({ repo: root, error }, 'Commit HEAD-watch fs watcher died; polling until re-armed')
					try {
						watcher.close()
					} catch {
						// already closed/broken — nothing to release
					}
					if (watched.get(root) === entry) entry.fsWatcher = undefined
				})
				entry.fsWatcher = watcher
			} catch {
				// reflog missing / unwatchable on this fs — the reconcile poll is the fallback
			}
		}
	}

	async function reconcile(): Promise<void> {
		if (stopped) return
		try {
			// The journal sweep runs REGARDLESS of the gate below: journals written while
			// attribution was on (or by a CLI whose launcher had it on) must still age out on a machine
			// where the gate is now off, or the authorship dir grows forever exactly where nothing
			// consumes it. Time-gated to one readdir per JOURNAL_SWEEP_INTERVAL_MS.
			const sweepNow = Date.now()
			if (sweepNow - lastJournalSweepAt >= JOURNAL_SWEEP_INTERVAL_MS) {
				lastJournalSweepAt = sweepNow
				const removed = await sweepAuthorshipJournals(JOURNAL_MAX_AGE_MS, sweepNow)
				if (removed > 0) logger.info({ removed }, 'Swept stale agent authorship journals')
			}
			// The gate is re-checked EVERY cycle, not once at boot (the boot-only check was a
			// shipped bug: an org's commit_tracking_enabled flip reached the trailer writer via
			// per-session settings refresh, but the watcher never started until daemon restart —
			// trailered commits, empty ledger). Off => tear down fs watchers but PRESERVE
			// authorship and journals: a brief off-window (settings churn) must not destroy the
			// inferred tier's evidence for sessions that are still live.
			if (!isCommitAttributionEnabled()) {
				for (const root of [...watched.keys()]) unwatch(root)
				return
			}
			const now = Date.now()
			// One readdir+stat pass over the journal dir per reconcile (a handful of small files),
			// reused for every session's relevance check below.
			const journalTouchedAt = await listAuthorshipJournals()
			const sessions = services.collections.sessions.toArray.filter((s) =>
				isWatchRelevant(s, now, journalTouchedAt.get(s.id)),
			)
			const activeRoots = new Set<string>()
			const currentSessionIds = new Set<string>()
			const currentDirs = new Set<string>()
			// Build the new mapping into a LOCAL map first. resolveRoot awaits git, so an
			// fs.watch-debounced scanRepo can interleave during this loop; if we cleared
			// sessionRoots up front it would observe a half-built set and mis-tier inferred
			// commits as 'human'. Instead we keep serving the previous cycle's mapping until
			// the new one is complete, then swap it in synchronously (no await) below.
			const nextSessionRoots = new Map<string, Set<string>>()
			const setupRows = services.collections.workspaceSetup.toArray
			for (const s of sessions) {
				currentSessionIds.add(s.id)
				const roots = new Set<string>()
				for (const dir of await sessionRepoDirs({ session: s, services, setupRows })) {
					currentDirs.add(dir)
					const root = await resolveRoot(dir)
					if (!root) continue
					roots.add(root)
					activeRoots.add(root)
				}
				if (roots.size > 0) nextSessionRoots.set(s.id, roots)
			}

			// Evict cache entries no watch-relevant session references — bounds the cache and
			// un-sticks a dir whose resolution changed (e.g. a worktree deleted and recreated).
			for (const dir of [...dirRootCache.keys()]) {
				if (!currentDirs.has(dir)) dirRootCache.delete(dir)
			}

			// Atomic swap: clear + repopulate with no await in between, so no scan can see a
			// partially-built mapping.
			sessionRoots.clear()
			for (const [sid, roots] of nextSessionRoots) sessionRoots.set(sid, roots)

			// Drop the journal of sessions that have left the collection (bounds disk; a session
			// still present keeps its journal so a late ghost-written commit can still be
			// inferred). Fire-and-forget: the sweep above is the floor for anything missed.
			for (const sid of knownSessionIds) {
				if (!currentSessionIds.has(sid)) void removeAuthorshipJournal(sid)
			}
			knownSessionIds = currentSessionIds

			for (const root of activeRoots) {
				await ensureWatcher(root)
				void scanRepo(root) // catch-up on new repos + poll on known ones
			}
			// Drop watchers for repos no live session references anymore.
			for (const root of [...watched.keys()]) {
				if (!activeRoots.has(root)) unwatch(root)
			}
		} catch (error) {
			logger.error({ error }, 'Commit HEAD-watch reconcile failed')
			Sentry.captureException(error, { tags: { error_type: 'commit_watch_reconcile' } })
		}
	}

	void reconcile()
	const interval = setInterval(() => void reconcile(), reconcileIntervalMs)

	return {
		stop() {
			stopped = true
			clearInterval(interval)
			for (const root of [...watched.keys()]) unwatch(root)
		},
	}
}
