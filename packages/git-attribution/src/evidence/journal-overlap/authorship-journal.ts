import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { LINE_HASH_RE } from '../../shared/line-hash'
import { isSessionId } from '../../shared/session-id'
import { riptideStateDir } from '../../shared/state-dir'
import { agentEditLineHashes } from './agent-edit'

/**
 * The CROSS-PROCESS half of the agent authorship store — a machine-local, append-only journal of
 * the line-hashes a session authored, one file per session under `<state dir>/authorship/`.
 *
 * Unlike ./authorship's process-local Map, this journal retains evidence across process lifetimes.
 * The HEAD-watch can use retained authored-line evidence when a later commit is observed, without
 * requiring its producer to remain in memory.
 *
 * Why a file and not IPC or the API (the alternatives, and why they lose):
 *   - A local IPC/HTTP endpoint on the daemon would need discovery + auth + a liveness assumption:
 *     a hook firing while the daemon is restarting would drop the edit, and a hook that blocks on
 *     a socket adds latency to every Edit the user sees. The file has no liveness coupling at all —
 *     the producer writes whether or not the daemon is up, and the daemon reads whenever it scans.
 *   - Round-tripping through the cloud API would put line-derived data on the wire. Today the added
 *     line CONTENT never leaves the machine (see commit-watcher's `getAddedLines` comment: only the
 *     verdict + counts are sent). Line hashes are content-derived and, for short//common source
 *     lines, trivially confirmable by dictionary — shipping them would quietly convert a local-only
 *     signal into a server-side one. This design keeps that property: the journal is written, read
 *     and deleted entirely on the user's machine, and `recordObserved` still sends only the verdict.
 *
 * Format: one 40-char lowercase hex sha1 per line. Append-only and order-free, so concurrent hook
 * processes (Claude Code can run tools in parallel) need no lock — each `appendFile` is a single
 * O_APPEND write, and any line that arrives torn simply fails {@link LINE_HASH_RE} on read and is
 * skipped. A dropped or malformed hash costs recall on one line, never correctness.
 */

/** Per-session journal size ceiling: ~41 bytes/hash x 100k hashes, matching MAX_AUTHORSHIP_HASHES. */
export const MAX_JOURNAL_BYTES = 100_000 * 41

/** Journals older than this are swept: a session whose agent has not written in a day is over. */
export const JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function authorshipJournalDir(): string {
	return join(riptideStateDir(), 'authorship')
}

/**
 * Path of one session's journal, or null for anything that is not a session id (see
 * ./session-id — a UUID is inherently a safe single path segment, so nothing else may name a
 * file here).
 */
export function authorshipJournalPath(sessionId: string): string | null {
	if (!isSessionId(sessionId)) return null
	return join(authorshipJournalDir(), `${sessionId}.hashes`)
}

/**
 * Escape hatch for users/hosts that do not want agent line-hashes written to disk at all. The
 * journal never leaves the machine, but it is still derived from file content, so it must be
 * refusable without disabling the CLI hook.
 */
function isAuthorshipJournalDisabled(): boolean {
	const value = process.env.RIPTIDE_DISABLE_AUTHORSHIP_JOURNAL
	return value === '1' || value === 'true'
}

/** Append line-hashes to a session's journal. Best-effort: never throws at the call site. */
export async function appendAuthorshipHashes(sessionId: string, hashes: Iterable<string>): Promise<number> {
	if (isAuthorshipJournalDisabled()) return 0
	const path = authorshipJournalPath(sessionId)
	if (path === null) return 0
	const lines: string[] = []
	for (const hash of hashes) {
		if (LINE_HASH_RE.test(hash)) lines.push(hash)
	}
	if (lines.length === 0) return 0
	try {
		await mkdir(authorshipJournalDir(), { recursive: true })
		// Bound the file before writing, not after: an unbounded journal is a disk leak, and the
		// cap degrades exactly like the in-memory one (recall on the overflow, never correctness).
		const size = await stat(path).then(
			(s) => s.size,
			() => 0,
		)
		if (size >= MAX_JOURNAL_BYTES) return 0
		await appendFile(path, `${lines.join('\n')}\n`, 'utf8')
		return lines.length
	} catch {
		return 0
	}
}

/**
 * Fold one file-writing tool call into the session's journal — the cross-process twin of
 * ./authorship `recordAgentEdit`. Both derive their hashes from ./agent-edit, so an Edit observed
 * by the daemon's SDK stream and the same Edit observed by the CLI hook produce identical hashes.
 */
export async function recordAgentEditToJournal(
	sessionId: string,
	toolName: string,
	toolInput: unknown,
): Promise<number> {
	const hashes = agentEditLineHashes(toolName, toolInput)
	if (hashes.size === 0) return 0
	return appendAuthorshipHashes(sessionId, hashes)
}

// Re-reading a 4MB journal on every 30s scan of every watched repo would be pure waste: the file is
// append-only, so (size, mtimeMs) is a sound cache key — any append changes at least the size.
const readCache = new Map<string, { size: number; mtimeMs: number; hashes: Set<string> }>()

/** The line-hashes a session's journal holds, or an empty Set when there is none / it is unreadable. */
export async function readAuthorshipJournal(sessionId: string): Promise<Set<string>> {
	const path = authorshipJournalPath(sessionId)
	if (path === null) return new Set<string>()
	let size: number
	let mtimeMs: number
	try {
		const info = await stat(path)
		size = info.size
		mtimeMs = info.mtimeMs
	} catch {
		readCache.delete(path)
		return new Set<string>()
	}
	const cached = readCache.get(path)
	if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.hashes
	try {
		const content = await readFile(path, 'utf8')
		const hashes = new Set<string>()
		for (const line of content.split('\n')) {
			if (LINE_HASH_RE.test(line)) hashes.add(line)
		}
		readCache.set(path, { size, mtimeMs, hashes })
		return hashes
	} catch {
		return new Set<string>()
	}
}

/** Drop a session's journal (and its read cache entry). Paired with ./authorship `clearAuthorship`. */
export async function removeAuthorshipJournal(sessionId: string): Promise<void> {
	const path = authorshipJournalPath(sessionId)
	if (path === null) return
	readCache.delete(path)
	await rm(path, { force: true }).catch(() => undefined)
}

/**
 * Every journal on this host with the time it was last appended to. The HEAD-watch uses this as
 * a liveness signal alongside `status`/`updated_at` (see commit-watcher `isWatchRelevant`).
 */
export async function listAuthorshipJournals(): Promise<Map<string, number>> {
	const dir = authorshipJournalDir()
	const out = new Map<string, number>()
	let entries: string[]
	try {
		entries = await readdir(dir)
	} catch {
		return out
	}
	for (const entry of entries) {
		if (!entry.endsWith('.hashes')) continue
		const sessionId = entry.slice(0, -'.hashes'.length)
		if (!isSessionId(sessionId)) continue
		try {
			const info = await stat(join(dir, entry))
			out.set(sessionId, info.mtimeMs)
		} catch {
			// vanished between readdir and stat — nothing to report
		}
	}
	return out
}

/**
 * Delete journals untouched for `maxAgeMs`. The daemon deletes a journal when its session leaves
 * the watch-relevant set, but journals written while the daemon was DOWN (or by a session on a host
 * whose daemon never ran) have no such owner — this is the floor that keeps the directory bounded.
 * Returns the number of journals removed.
 */
export async function sweepAuthorshipJournals(
	maxAgeMs: number = JOURNAL_MAX_AGE_MS,
	nowMs = Date.now(),
): Promise<number> {
	let removed = 0
	for (const [sessionId, mtimeMs] of await listAuthorshipJournals()) {
		if (nowMs - mtimeMs <= maxAgeMs) continue
		await removeAuthorshipJournal(sessionId)
		removed++
	}
	return removed
}
