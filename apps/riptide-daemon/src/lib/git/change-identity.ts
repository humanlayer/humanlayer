/**
 * Content-derived change identity for commits (capture v3).
 *
 * The problem this solves: the commit ledger is sha-unique, but the SAME work
 * re-lands under NEW shas constantly — rebase merges, cherry-picks, amends,
 * squashes. Measured on the landing-methods diagnostic (test/diagnostics), sha-keyed capture counts
 * squash/rebase/cherry-pick landings 2.0x. This module derives an identity from
 * the CONTENT of a change — independent of sha, parents, author, message, and
 * timestamps — so re-landings are recognizable. Same design as the changeId in
 * Cursor's shipped commit scoring (verified against their 3.16.29 build).
 *
 * The identity, bottom-up:
 *  - line hash    = sha256(`${path}:${±content}`), one per added/deleted line
 *  - per-file id  = sha256(path + its SORTED line hashes)
 *  - commit id    = sha256(the SORTED per-file ids)
 *
 * Sorting makes the ids insensitive to line ORDER within the diff — deliberate:
 * this is content identity, not patch identity (`git patch-id` is
 * order-sensitive, which is why it catches rebases but can never catch a
 * squash). A squash's per-file diff equals the original's whenever exactly one
 * branch commit touched that file, so squash dedup works at the PER-FILE level;
 * the squash's commit-level id is the hash of a union and matches nothing — by
 * design, the same trade-off Cursor makes.
 *
 * API: {@link collectChangeIds} (repo + sha → ids, best-effort, never throws)
 * is the entry point; {@link parseChangeIds} is the pure core, exported for
 * tests and for callers that already hold the patch text. The two are coupled
 * by contract: the parser assumes a patch produced by exactly the flags
 * {@link changeIdShowArgs} builds — forced a/ b/ prefixes, literal paths,
 * zero context lines, no merge diffs.
 *
 * References / provenance:
 * - Cursor's changeId, the design this mirrors. Extracted 2026-08-20 from
 *   their shipped build (cursor_3.16.29_amd64.deb →
 *   extensions/cursor-retrieval/dist/main.js; the minified bundle leaks the
 *   original path `packages/agent-analytics/src/commit-scoring/change-id.ts`):
 *   `changeId = hash(filePath + sorted("source:lineHash", …))` — content
 *   identity, no sha, no timestamp. Public surface of the same concept:
 *   https://cursor.com/docs/account/teams/ai-code-tracking-api ("deterministic
 *   changeId … groups accepted AI changes, independent of commits").
 * - Cursor's Agent Trace RFC proposes "optional content hashes" for tracking
 *   attributed code across moves/rewrites — same instinct, standardized:
 *   https://www.infoq.com/news/2026/02/agent-trace-cursor
 * - `git patch-id --stable` (githooks/git-patch-id(1)) is the in-git prior
 *   art this deliberately deviates from: patch-id is order-sensitive and
 *   whole-patch, so it survives rebases/cherry-picks but can never match a
 *   squash. Measured head-to-head in test/diagnostics/landing-methods.ts:
 *   patch-id 0/1 on squash, this scheme 1/1 (per-file), both 5/6 on
 *   rebase/cherry-pick.
 * - Full investigation, dev-org measurements, and the parser bugs the
 *   capture-matrix diagnostic found in earlier drafts of this file: PR #2221.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'

import { Option, Schema } from 'effect'

const execFileAsync = promisify(execFile)

// Same subprocess policy as commit-tracker's git helper: a stuck repo must not
// stall capture, and one stray huge diff must not OOM the daemon. A diff larger
// than the buffer degrades to "no ids" via the catch in collectChangeIds.
const GIT_COMMAND_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 16 * 1024 * 1024

const SIMPLE_ESCAPE_KEYS = ['t', 'n', 'r', '"', '\\', 'a', 'b', 'f', 'v'] as const
const SimpleEscapeKey = Schema.Literals(SIMPLE_ESCAPE_KEYS)
const SIMPLE_ESCAPES: Record<(typeof SIMPLE_ESCAPE_KEYS)[number], string> = {
	t: '\t',
	n: '\n',
	r: '\r',
	'"': '"',
	'\\': '\\',
	a: '\x07',
	b: '\b',
	f: '\f',
	v: '\v',
}

/** Per-commit content identity: the commit-level id plus one id per changed file. */
export interface ChangeIds {
	changeId?: string
	fileChangeIds: Map<string, string>
}

const NONE: () => ChangeIds = () => ({ fileChangeIds: new Map() })

/** sha256 truncated to 128 bits — plenty for org-scale dedup, half the storage. */
function contentHash(input: string): string {
	return createHash('sha256').update(input).digest('hex').slice(0, 32)
}

/**
 * Undo git's C-style path quoting (`"pa\th"` → `pa<TAB>h`). Even with
 * `core.quotepath=off` git still quotes paths containing control characters,
 * double quotes, or backslashes; escapes are octal BYTE sequences, so decode to
 * bytes first and reassemble as UTF-8. Unquoted input passes through untouched.
 */
export function unquoteGitPath(path: string): string {
	if (!(path.length >= 2 && path.startsWith('"') && path.endsWith('"'))) return path
	const inner = path.slice(1, -1)
	const bytes: number[] = []
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i] ?? ''
		if (ch !== '\\') {
			bytes.push(...Buffer.from(ch, 'utf8'))
			continue
		}
		const next = inner[i + 1] ?? ''
		if (next >= '0' && next <= '7') {
			bytes.push(Number.parseInt(inner.slice(i + 1, i + 4), 8))
			i += 3
		} else {
			const escapeKey = Option.getOrUndefined(Schema.decodeUnknownOption(SimpleEscapeKey)(next))
			bytes.push(...Buffer.from(escapeKey === undefined ? next : SIMPLE_ESCAPES[escapeKey], 'utf8'))
			i += 1
		}
	}
	return Buffer.from(bytes).toString('utf8')
}

/** Strip a `--- `/`+++ ` header's payload to a repo path; null for /dev/null. */
function parseHeaderPath(payload: string, prefix: 'a/' | 'b/'): string | null {
	// Paths ending in whitespace get a trailing tab terminator in headers.
	const raw = unquoteGitPath(payload.replace(/\t$/, ''))
	if (raw === '/dev/null') return null
	return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

/**
 * The exact `git show` invocation {@link parseChangeIds} is written against.
 * `--unified=0` (no context lines), `--diff-merges=off` (a merge yields no diff
 * → no ids, matching its zeroed numstat), FORCED `--src-prefix/--dst-prefix`
 * (they beat diff.noprefix / diff.mnemonicPrefix in user config, which
 * otherwise change the header shape per machine), and `core.quotepath=off` so
 * non-ASCII paths come out literal and match the numstat side.
 */
export function changeIdShowArgs(sha: string): string[] {
	return [
		'-c',
		'core.quotepath=off',
		'show',
		sha,
		'--unified=0',
		'--no-color',
		'--no-renames',
		'--no-show-signature',
		'--diff-merges=off',
		'--src-prefix=a/',
		'--dst-prefix=b/',
		'--format=',
	]
}

/**
 * Pure core: patch text → change ids. The parse is a diff-structure STATE
 * MACHINE, not startsWith sniffing: `--- `/`+++ ` are only headers between a
 * `diff --git` line and the file's first hunk. Content lines forge those
 * prefixes constantly — a deleted `-- SQL comment` renders as `--- SQL
 * comment`, an added `++x` as `+++x` — and a naive parse drops them (found by
 * the capture-matrix diagnostic). Expects a patch produced by
 * {@link changeIdShowArgs}; an empty patch yields empty ids.
 */
export function parseChangeIds(patch: string): ChangeIds {
	// Group +/- lines by file. Path comes from the `+++ b/…` header, falling
	// back to `--- a/…` for pure deletions (`+++ /dev/null`).
	const lineHashesByFile = new Map<string, string[]>()
	let currentPath: string | undefined
	let pendingMinusPath: string | undefined
	// True between a `diff --git` line and the file's `+++ ` header — the ONLY
	// region where `--- `/`+++ ` are headers rather than content.
	let inFileHeader = false
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git ')) {
			inFileHeader = true
			currentPath = undefined
			pendingMinusPath = undefined
			continue
		}
		if (inFileHeader) {
			if (line.startsWith('--- ')) {
				pendingMinusPath = parseHeaderPath(line.slice(4), 'a/') ?? undefined
			} else if (line.startsWith('+++ ')) {
				currentPath = parseHeaderPath(line.slice(4), 'b/') ?? pendingMinusPath
				inFileHeader = false
			}
			// index/mode/similarity/"Binary files … differ" lines: skip. A binary file
			// has no +++ header, so inFileHeader stays set until the next `diff --git`
			// — which is exactly the "no per-file id for binaries" behavior we want.
			continue
		}
		if (currentPath === undefined) continue
		if (line.startsWith('+') || line.startsWith('-')) {
			const hashes = lineHashesByFile.get(currentPath) ?? []
			hashes.push(contentHash(`${currentPath}:${line}`))
			lineHashesByFile.set(currentPath, hashes)
		}
	}

	if (lineHashesByFile.size === 0) return NONE()

	const fileChangeIds = new Map<string, string>()
	for (const [path, hashes] of lineHashesByFile) {
		fileChangeIds.set(path, contentHash(`${path}:${hashes.sort().join(',')}`))
	}
	const changeId = contentHash([...fileChangeIds.values()].sort().join(','))
	return { changeId, fileChangeIds }
}

/**
 * Entry point: change ids for one commit. Best-effort and never throws — any
 * git failure (missing sha, timeout, a diff over the exec buffer) degrades to
 * empty ids and capture proceeds without them.
 */
export async function collectChangeIds(repoRoot: string, sha: string): Promise<ChangeIds> {
	try {
		const { stdout } = await execFileAsync('git', changeIdShowArgs(sha), {
			cwd: repoRoot,
			timeout: GIT_COMMAND_TIMEOUT_MS,
			maxBuffer: GIT_MAX_BUFFER,
			encoding: 'utf8',
		})
		return parseChangeIds(stdout)
	} catch {
		return NONE()
	}
}
