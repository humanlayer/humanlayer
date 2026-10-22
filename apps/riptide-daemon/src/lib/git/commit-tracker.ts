import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { JOURNAL_MAX_AGE_MS } from '@humanlayer/git-attribution'

import { collectChangeIds, unquoteGitPath } from './change-identity'

const execFileAsync = promisify(execFile)

/**
 * Bump when the capture algorithm changes (numstat handling, heuristics, delimiters, or the
 * capture MODEL itself). v2: capture moved from a run-start/run-end watermark window to a
 * continuous daemon HEAD-watch that records every commit as it lands (feeding content-based
 * attribution) rather than only diffing baseline..HEAD once per run. v3: merge commits and
 * `git revert`-generated commits no longer carry numstat — under v2 every merge recorded the
 * whole incoming branch as the merger's own additions (`git show --numstat` falls back to the
 * first-parent diff), and a revert cycle double-counted; adds changeId (content-derived,
 * sha-stable dedup identity), isPrimaryBranch, and authorMatchesDaemonUser; non-ASCII paths
 * stored literal (core.quotepath=off). Persisted per-row so trend charts never silently shift
 * when the algorithm evolves (the Cursor lesson); old rows keep their version.
 *
 * READ PATHS MUST EXCLUDE MERGE ROWS. A v2 merge row's additions are meaningless (the whole
 * incoming branch), a v3+ merge row's are zero — metrics count neither: they read from the
 * `authored_commits` view (the ledger minus merges; see packages/db/src/tables/commits.ts),
 * never from `commits` directly.
 */
export const CAPTURE_ALGORITHM_VERSION = 3

/** Guard against pathological rebases/pulls between run start and run end. */
const MAX_COMMITS = 200
/**
 * How far back the FIRST scan of a newly-watched repo looks (see collectCommitsForWatch).
 * EQUAL BY CONSTRUCTION to the authorship journal's retention: any commit an agent session could
 * still be inferred for is within this horizon, so nothing attribution could claim is lost —
 * while a years-old monorepo history stays permanently out of scope.
 */
const FIRST_SCAN_LOOKBACK_MS = JOURNAL_MAX_AGE_MS
/** file_stats is capped; files_changed always carries the true count. */
const MAX_FILE_STATS = 500
const SUBJECT_MAX = 512
const BODY_MAX = 10_000
const BRANCH_MAX = 512
const AUTHOR_MAX = 512
const REMOTE_URL_MAX = 2048
const REPO_FULL_NAME_MAX = 512
/** Every git invocation is best-effort; a stuck repo must not stall the post-run hook. */
const GIT_COMMAND_TIMEOUT_MS = 10_000
/** numstat for a very large commit stays well under this; keeps a stray huge diff from OOM. */
const GIT_MAX_BUFFER = 16 * 1024 * 1024

// Control-char delimiters make the git-show header immune to commit-message content.
const US = '\x1f' // unit separator, between header fields
const RS = '\x1e' // record separator, terminates the header before the numstat block

// %H sha, %P parents, %an/%ae author, %aI author date, %cI committer date, %s subject, %b body.
const SHOW_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s%x1f%b%x1e'

// "Co-Authored-By: Claude ..." / "... <noreply@anthropic.com>" trailer (Claude Code's own
// default). `.` excludes newlines so the match is confined to a single trailer line.
const CO_AUTHOR_REGEX = /co-authored-by:.*(claude|noreply@anthropic\.com)/i

const SHA_REGEX = /^[0-9a-f]{40,64}$/

/**
 * Per-file numstat entry. Binary files carry `binary: true` with 0/0 counts.
 * changeId (v3+): content-derived id of this file's diff (see {@link collectChangeIds}).
 */
export interface CommitFileStat {
	path: string
	additions: number
	deletions: number
	binary?: boolean
	changeId?: string
}

/**
 * Fully-attributed commit record, shaped to match the daemon contract's
 * `CommitSchema` so it can be passed straight to `sessions.commits.record`.
 */
export interface CollectedCommit {
	sha: string
	parentShas: string[]
	branch?: string
	repoRemoteUrl?: string
	repoFullName?: string
	repoDirectory?: string
	subject: string
	body?: string
	authorName?: string
	authorEmail?: string
	authoredAt?: number // epoch ms
	committedAt: number // epoch ms
	additions: number
	deletions: number
	filesChanged: number
	fileStats?: CommitFileStat[]
	coAuthoredByAgent: boolean
	captureAlgorithmVersion: number
	// v3 capture context — see the commits table for full semantics.
	changeId?: string
	isPrimaryBranch?: boolean
	authorMatchesDaemonUser?: boolean
}

/** Per-commit fields parsed from a single `git show` invocation (no per-repo metadata yet). */
type ParsedCommit = Omit<
	CollectedCommit,
	| 'branch'
	| 'repoRemoteUrl'
	| 'repoFullName'
	| 'repoDirectory'
	| 'captureAlgorithmVersion'
	| 'changeId'
	| 'isPrimaryBranch'
	| 'authorMatchesDaemonUser'
>

/** Run a git subprocess and return stdout. Rejects on non-zero exit, timeout, or spawn failure. */
async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', args, {
		cwd,
		timeout: GIT_COMMAND_TIMEOUT_MS,
		maxBuffer: GIT_MAX_BUFFER,
		encoding: 'utf8',
	})
	return stdout
}

/**
 * Markers git prints when HEAD is unborn/missing (a fresh repo with no commits):
 * `git rev-parse HEAD` fails with "fatal: ambiguous argument 'HEAD': unknown
 * revision ...". These — and ONLY these — mean "empty repo, safe to scan from
 * scratch". Any other failure (index lock, timeout, corruption) is transient and
 * must NOT be mistaken for an empty repo.
 */
const UNBORN_HEAD_REGEX = /unknown revision|ambiguous argument|bad revision/i

/** True when an execFile error's stderr/message indicates an unborn/missing HEAD. */
export function isUnbornHeadError(error: unknown): boolean {
	if (error && typeof error === 'object') {
		const e = error as { stderr?: unknown; message?: unknown }
		for (const stream of [e.stderr, e.message]) {
			if (typeof stream === 'string' && UNBORN_HEAD_REGEX.test(stream)) return true
		}
	}
	return false
}

/** Run-start HEAD resolution: a real sha, an empty (unborn) repo, or a transient failure to skip. */
type HeadResolution = { kind: 'sha'; sha: string } | { kind: 'empty' } | { kind: 'skip' }

/**
 * Resolve HEAD for the run-start baseline. Distinguishes an empty repo (unborn
 * HEAD — scannable from scratch) from a transient failure (skip this run) so a
 * flaky `git rev-parse` never causes the run-end scan to treat pre-existing
 * history as new. Prefer undercount over mis-attribution.
 */
async function resolveHead(repoRoot: string): Promise<HeadResolution> {
	try {
		const sha = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
		return SHA_REGEX.test(sha) ? { kind: 'sha', sha } : { kind: 'skip' }
	} catch (error) {
		return isUnbornHeadError(error) ? { kind: 'empty' } : { kind: 'skip' }
	}
}

/** Branch name, or undefined for a detached HEAD or on any failure. */
async function resolveBranch(repoRoot: string): Promise<string | undefined> {
	try {
		const branch = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
		if (branch.length === 0 || branch === 'HEAD') return undefined
		return branch.slice(0, BRANCH_MAX)
	} catch {
		return undefined
	}
}

/**
 * The repo's default branch, from the remote's HEAD pointer. `origin/HEAD` is a local
 * ref created at clone time — stale if the remote default changed since, and absent in
 * repos that were `git init`ed rather than cloned. Undefined on any failure — and then
 * isPrimaryBranch stays UNKNOWN rather than guessed (Cursor falls back to a list of
 * common default names here; we deliberately don't: "unknown" is more honest than a
 * name-based guess, and nothing consumes the flag yet). Also deliberately NO network
 * fallback (`git remote show origin` would be accurate but adds a network round-trip
 * to every scan of every watched repo).
 */
async function resolveDefaultBranch(repoRoot: string): Promise<string | undefined> {
	try {
		const ref = (await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
		// "origin/main" -> "main"
		const name = ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
		return name.length > 0 ? name.slice(0, BRANCH_MAX) : undefined
	} catch {
		return undefined
	}
}

/** The repo-effective `git config user.email` (repo > global > system). Undefined when unset. */
async function resolveUserEmail(repoRoot: string): Promise<string | undefined> {
	try {
		const email = (await git(repoRoot, ['config', 'user.email'])).trim()
		return email.length > 0 ? email : undefined
	} catch {
		return undefined // exits non-zero when the key is unset anywhere
	}
}

/** Case-insensitive email comparison; undefined when either side is unknown. */
export function emailsMatch(a: string | undefined, b: string | undefined): boolean | undefined {
	if (a === undefined || b === undefined) return undefined
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Was this branch the repo's default? Compared against the remote's HEAD only —
 * undefined (unknown) when either side is unknown: detached HEAD, or a repo with no
 * `origin/HEAD` to name a default. Never guessed from branch names.
 */
export function computeIsPrimaryBranch(
	branch: string | undefined,
	defaultBranch: string | undefined,
): boolean | undefined {
	if (branch === undefined || defaultBranch === undefined) return undefined
	return branch === defaultBranch
}

/**
 * A `git revert`-GENERATED commit: subject starts with "Revert " — or "Reapply ",
 * which git ≥2.43 generates for a revert-of-a-revert (found by the capture-matrix POC;
 * a prefix check on "Revert " alone, which is all Cursor does, misses every reland) —
 * AND the body carries the generated "This reverts commit <sha>" line (also present in
 * the `-m` merge-revert form, "…, reversing changes made to <sha>"). Both signals
 * required: a hand-typed "Revert to old behavior" subject alone stays a normal, counted
 * commit. The trailer requirement trades a little recall (hand-written revert messages)
 * for never zeroing someone's real work on a spoofable prefix.
 */
export function isRevertCommit(subject: string, body: string | undefined): boolean {
	return (
		(subject.startsWith('Revert ') || subject.startsWith('Reapply ')) &&
		/This reverts commit [0-9a-f]{7,64}/.test(body ?? '')
	)
}

/** Raw origin remote URL, best-effort. May carry embedded credentials — see {@link sanitizeRemoteUrl}. */
async function resolveRemoteUrl(repoRoot: string): Promise<string | undefined> {
	try {
		const url = (await git(repoRoot, ['remote', 'get-url', 'origin'])).trim()
		return url.length > 0 ? url.slice(0, REMOTE_URL_MAX) : undefined
	} catch {
		return undefined
	}
}

/**
 * Strip embedded credentials from a remote URL before it is persisted to the
 * metrics DB. An https origin can carry `user:token@host` (a PAT baked into the
 * remote); those secrets must never leak into stored metrics.
 *
 * - Parseable (https://, ssh://, git://): clear username + password, return the
 *   rebuilt URL.
 * - Unparseable (scp-like `git@host:path`, junk): keep it ONLY when there is no
 *   `@` before the first `/` — otherwise a userinfo-looking secret could hide in
 *   it, so drop it (undefined) rather than risk leaking. The owner/repo is still
 *   recovered separately via {@link parseRepoFullName} from the raw URL.
 */
export function sanitizeRemoteUrl(raw: string): string | undefined {
	const url = raw.trim()
	if (url.length === 0) return undefined
	try {
		const parsed = new URL(url)
		parsed.username = ''
		parsed.password = ''
		return parsed.toString().slice(0, REMOTE_URL_MAX)
	} catch {
		const firstSlash = url.indexOf('/')
		const authority = firstSlash === -1 ? url : url.slice(0, firstSlash)
		if (authority.includes('@')) return undefined
		return url.slice(0, REMOTE_URL_MAX)
	}
}

/**
 * Parse "owner/repo" (or nested groups) from an ssh scp-like or url-form remote.
 * Returns undefined when the URL is not a recognizable remote.
 */
export function parseRepoFullName(remoteUrl: string): string | undefined {
	const url = remoteUrl.trim()
	let path: string | undefined

	// scp-like: git@github.com:owner/repo(.git)
	const scp = url.match(/^[^/@]+@[^:/]+:(.+)$/)
	if (scp) {
		path = scp[1]
	} else {
		// url form: (ssh|git|http|https)://[user@]host/owner/repo(.git)
		const urlForm = url.match(/^(?:ssh|git|https?):\/\/[^/]+\/(.+)$/)
		if (urlForm) path = urlForm[1]
	}

	if (path === undefined) return undefined
	path = path
		.replace(/\.git$/, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
	if (!path.includes('/')) return undefined
	return path.slice(0, REPO_FULL_NAME_MAX)
}

/** Parse one `git show ... --numstat --format=SHOW_FORMAT` output into per-commit fields. */
export function parseCommitShow(raw: string): ParsedCommit | null {
	// The format emits exactly one RS to terminate the header, then the numstat
	// block (which never contains control chars). Use the LAST RS so a body that
	// itself contains an RS byte cannot truncate the header early.
	const rsIndex = raw.lastIndexOf(RS)
	if (rsIndex === -1) return null

	const header = raw.slice(0, rsIndex)
	const numstatBlock = raw.slice(rsIndex + 1)

	const fields = header.split(US)
	if (fields.length < 8) return null
	// A body could in theory contain the unit separator; rejoin any trailing fields.
	const [
		shaRaw = '',
		parentsRaw = '',
		authorName = '',
		authorEmail = '',
		authoredIso = '',
		committedIso = '',
		subjectRaw = '',
		...bodyParts
	] = fields
	const sha = shaRaw.trim()
	const bodyRaw = bodyParts.join(US)

	if (!SHA_REGEX.test(sha)) return null

	const committedMs = Date.parse(committedIso)
	if (Number.isNaN(committedMs)) return null // committed_at is required; skip rather than fabricate
	const authoredMs = Date.parse(authoredIso)

	const parentShas = parentsRaw.trim().length > 0 ? parentsRaw.trim().split(/\s+/).slice(0, 16) : []

	// numstat rows: "additions\tdeletions\tpath". "-" in either count => binary (0/0).
	const allStats: CommitFileStat[] = []
	let additions = 0
	let deletions = 0
	for (const line of numstatBlock.split('\n')) {
		if (line.length === 0) continue
		const parts = line.split('\t')
		if (parts.length < 3) continue
		const [addStr = '', delStr = '', ...pathParts] = parts
		const path = pathParts.join('\t')
		if (path.length === 0) continue
		const binary = addStr === '-' || delStr === '-'
		if (binary) {
			allStats.push({ path, additions: 0, deletions: 0, binary: true })
			continue
		}
		const add = Number.parseInt(addStr, 10)
		const del = Number.parseInt(delStr, 10)
		if (Number.isNaN(add) || Number.isNaN(del)) continue
		additions += add
		deletions += del
		allStats.push({ path, additions: add, deletions: del })
	}

	const filesChanged = allStats.length
	const fileStats = filesChanged > 0 ? allStats.slice(0, MAX_FILE_STATS) : undefined

	return {
		sha,
		parentShas,
		subject: subjectRaw.slice(0, SUBJECT_MAX),
		body: bodyRaw.length > 0 ? bodyRaw.slice(0, BODY_MAX) : undefined,
		authorName: authorName.length > 0 ? authorName.slice(0, AUTHOR_MAX) : undefined,
		authorEmail: authorEmail.length > 0 ? authorEmail.slice(0, AUTHOR_MAX) : undefined,
		authoredAt: Number.isNaN(authoredMs) ? undefined : authoredMs,
		committedAt: committedMs,
		additions,
		deletions,
		filesChanged,
		fileStats,
		coAuthoredByAgent: CO_AUTHOR_REGEX.test(bodyRaw),
	}
}

/**
 * The CONTENT of the lines a commit ADDED (best-effort). Runs `git show` with an empty `--format=`
 * (so no commit header prints) and `--unified=0` (so no surrounding context prints), then keeps the
 * diff's added lines — those starting with `+` but NOT the `+++` file-header — stripped of the
 * leading `+`. Feeds content-based attribution (matching a human commit's added lines against an
 * agent session's authored lines). Returns [] on any failure — attribution degrades gracefully,
 * never throws. Same timeouts/buffers as its siblings (via the shared {@link git} helper).
 */
export async function getAddedLines(repoRoot: string, sha: string): Promise<string[]> {
	try {
		// --no-show-signature for the same reason as collectShas: gpg verification lines from
		// a user's log.showSignature=true config must not ride into the diff parse.
		const raw = await git(repoRoot, [
			'show',
			sha,
			'--unified=0',
			'--no-color',
			'--no-renames',
			'--no-show-signature',
			'--format=',
		])
		const added: string[] = []
		for (const line of raw.split('\n')) {
			if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1))
		}
		return added
	} catch {
		return []
	}
}

/**
 * Parse each sha via one `git show` (per-repo metadata fetched once), skipping failures.
 * `execFailures` counts shas whose `git show` FAILED AT THE EXEC LEVEL (spawn error, timeout,
 * maxBuffer) — distinct from parse failures (malformed commit data, permanently skippable):
 * exec failures are usually systemic (host load, OOM, lock storms) and the watch path uses
 * the distinction to retry instead of permanently skipping a window (see collectCommitsForWatch).
 */
async function collectShas(
	repoRoot: string,
	shas: string[],
): Promise<{ commits: CollectedCommit[]; execFailures: number }> {
	// Per-repo metadata, fetched once and shared by every commit in this repo. Independent
	// git spawns — overlap them.
	// Parse owner/repo from the RAW url (never carries userinfo in its path), but
	// persist only the credential-stripped url so tokens never leak into metrics.
	const [branch, rawRemoteUrl, defaultBranch, daemonUserEmail] = await Promise.all([
		resolveBranch(repoRoot),
		resolveRemoteUrl(repoRoot),
		resolveDefaultBranch(repoRoot),
		resolveUserEmail(repoRoot),
	])
	const repoRemoteUrl = rawRemoteUrl !== undefined ? sanitizeRemoteUrl(rawRemoteUrl) : undefined
	const repoFullName = rawRemoteUrl !== undefined ? parseRepoFullName(rawRemoteUrl) : undefined
	const isPrimaryBranch = computeIsPrimaryBranch(branch, defaultBranch)

	const commits: CollectedCommit[] = []
	let execFailures = 0
	for (const sha of shas) {
		try {
			// --no-show-signature: `git show` is porcelain and honors user config — with
			// `log.showSignature=true` (a global setting some GPG users carry), verification
			// lines print BEFORE the format header on every signed commit, breaking the sha
			// parse and silently skipping ALL capture for that user. rev-list is plumbing and
			// immune; this is the one config-sensitive invocation in the pipeline.
			const raw = await git(repoRoot, [
				// quotepath=off (v3): store non-ASCII paths as literal UTF-8 instead of
				// octal-escaped quoting, and keep them identical to the paths the changeId
				// pass parses from patch headers — otherwise per-file ids never attach for
				// any non-ASCII filename. Control characters stay quoted on both sides;
				// the attach step bridges those via unquoteGitPath.
				'-c',
				'core.quotepath=off',
				'show',
				sha,
				'--numstat',
				'--no-renames',
				'--no-show-signature',
				// --diff-merges=off: a MERGE must contribute no numstat. Without it, `git show`
				// silently falls back to the FIRST-PARENT diff for merges (--numstat is a raw
				// format and cannot express a combined diff), so "merge upstream/main into my
				// branch" records the entire incoming delta as this author's additions. Measured
				// on dev: 89% of one user's 4-week LOC came from 35 such commits, one of them
				// 234,798 additions across 2,614 files — enough to invert the per-user ranking.
				// Asking for a combined diff instead (--diff-merges=cc) does NOT escape this: it
				// hits the same fallback and returns byte-identical numbers. Only suppression
				// works. The little that IS hand-written inside a merge is conflict resolution,
				// and on dev 98.7% of that was regenerated drizzle snapshots and lockfiles (660
				// real source lines across 76 merges), so nothing of value is lost. Note this
				// does NOT affect getAddedLines(): it uses a PATCH format, where git's default
				// --cc applies correctly and already yields the conflict-resolution lines only.
				'--diff-merges=off',
				'--date=iso-strict',
				`--format=${SHOW_FORMAT}`,
			])
			let parsed = parseCommitShow(raw)
			if (parsed === null) continue
			// Reverts (v3): a `git revert`-generated commit carries no numstat, same shape as a
			// merge. A revert UN-does work — counting its deletions, and the reland's
			// re-additions, inflates both sides of a revert cycle (Cursor skips these too).
			// The row itself is kept: a commit is a commit, and the sha anchors idempotency.
			const revert = isRevertCommit(parsed.subject, parsed.body)
			if (revert) {
				parsed = { ...parsed, additions: 0, deletions: 0, filesChanged: 0, fileStats: undefined }
			}
			// Content identity (v3): a second, patch-format show. Best-effort — collectChangeIds
			// returns empty ids on failure rather than throwing, so a too-large diff (maxBuffer)
			// degrades to a row without dedup ids instead of an execFailure retry loop. Skipped
			// for reverts: their diff is the inverse of work already identified elsewhere.
			const { changeId, fileChangeIds } = revert
				? { changeId: undefined, fileChangeIds: new Map<string, string>() }
				: await collectChangeIds(repoRoot, sha)
			const fileStats =
				parsed.fileStats && fileChangeIds.size > 0
					? parsed.fileStats.map((f) => {
							// Numstat still quotes control-char paths even with quotepath=off;
							// the patch-header side is unquoted by the parser, so bridge here.
							const id = fileChangeIds.get(f.path) ?? fileChangeIds.get(unquoteGitPath(f.path))
							return id === undefined ? f : { ...f, changeId: id }
						})
					: parsed.fileStats
			commits.push({
				...parsed,
				fileStats,
				branch,
				repoRemoteUrl,
				repoFullName,
				repoDirectory: repoRoot,
				captureAlgorithmVersion: CAPTURE_ALGORITHM_VERSION,
				changeId,
				isPrimaryBranch,
				authorMatchesDaemonUser: emailsMatch(parsed.authorEmail, daemonUserEmail),
			})
		} catch {
			// best-effort: skip this commit, keep the rest — but count the exec failure
			execFailures++
		}
	}
	return { commits, execFailures }
}

/**
 * `git rev-list --reverse <range>` as a sha array (oldest first). Output lines are kept only
 * when they LOOK like commit shas: several of these values are re-embedded in later git argv
 * positions (ranges, `git show <sha>`), so anything unexpected on stdout must not ride along.
 */
async function revListReverse(repoRoot: string, range: string, extraArgs: string[] = []): Promise<string[]> {
	return (await git(repoRoot, ['rev-list', '--reverse', ...extraArgs, range]))
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => SHA_REGEX.test(line))
}

/**
 * `git rev-list --count [--first-parent] <range>`. Constant-size stdout, so it is safe on a
 * window of ANY size — always count before listing. Throws on unparseable output so the scan
 * fails observably instead of proceeding on a garbage number.
 */
async function countRange(repoRoot: string, range: string, opts: { firstParent?: boolean } = {}): Promise<number> {
	const args = ['rev-list', '--count']
	if (opts.firstParent) args.push('--first-parent')
	args.push(range)
	const count = Number.parseInt((await git(repoRoot, args)).trim(), 10)
	if (!Number.isFinite(count) || count < 0) throw new Error(`unparseable rev-list --count output for ${range}`)
	return count
}

/**
 * The OLDEST `limit` shas of `range` (oldest first) WITHOUT materializing the full list:
 * given the range's known `total`, `--skip` the newest remainder. Like `--max-count`, `--skip`
 * is a limiting option git applies BEFORE `--reverse`, so skipping from the newest side leaves
 * exactly the oldest `limit`. Keeps stdout bounded no matter how large the range is — a subtree
 * merge can pull 10^5+ commits into a window, and an unbounded listing would overflow maxBuffer
 * and fail every scan from then on.
 */
async function revListOldest(
	repoRoot: string,
	range: string,
	total: number,
	limit: number,
	extraArgs: string[] = [],
): Promise<string[]> {
	const skip = Math.max(0, total - limit)
	return revListReverse(repoRoot, range, skip > 0 ? [...extraArgs, `--skip=${skip}`] : extraArgs)
}

/**
 * True when `sha` names a commit that exists in the repo. The regex gate doubles as the
 * argv-injection guard: callers embed accepted values in rev-list ranges, and execFile passes
 * argv verbatim — a crafted value starting with `-` would otherwise parse as a git flag.
 */
async function commitExists(repoRoot: string, sha: string): Promise<boolean> {
	if (!SHA_REGEX.test(sha)) return false
	try {
		await git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`])
		return true
	} catch {
		return false
	}
}

/** One HEAD-watch scan's outcome: the commits to record plus the watermark to resume from. */
export interface WatchScanResult {
	commits: CollectedCommit[]
	/**
	 * Ancestry-safe resume point: every commit in `commits` is an ancestor of this sha, so the
	 * next scan's `watermark..HEAD` window can never re-list THIS SCAN's commits. Equal to
	 * `sinceSha` when there is nothing to advance past (e.g. HEAD moved backwards).
	 *
	 * Caveat (deliberate): commits recorded by EARLIER scans can re-list after a branch
	 * switch — a watermark cut on one branch does not dominate commits collected while another
	 * branch was checked out (e.g. watermark moves side-tip -> main; a later merge of side
	 * re-lists side's commits). Correctness then rests on the server's (org, sha) insert-dedup:
	 * re-collection costs redundant local work, never duplicate rows. Do NOT remove that dedup.
	 */
	watermark: string
	/**
	 * Commits inside the advanced-past window that were NOT collected because one forced
	 * first-parent step (a single merge's closure) exceeded the absolute per-scan ceiling.
	 * Almost always 0; non-zero only for a pathological merge (e.g. a vendored-history subtree
	 * merge). The caller must surface it — the watermark has moved past these, so they are
	 * never revisited.
	 */
	dropped: number
	/**
	 * Commits the scan LISTED but could not parse into records (a `git show` failure or
	 * malformed output). Per-commit capture stays best-effort — one weird commit must never
	 * stall the repo — but the watermark advances past these, so a skip has to be visible
	 * to the caller, not silently absorbed.
	 */
	skipped: number
	/**
	 * True when the scan collected NOTHING because every `git show` in the window failed at
	 * the exec level (systemic: host load, OOM, lock storm — not malformed commits). The
	 * watermark HELD at `sinceSha` so the next scan retries the window instead of permanently
	 * skipping it; already-recorded commits dedupe server-side on the retry. A window where
	 * at least one commit parses still advances (partial exec failures are then `skipped`).
	 */
	held: boolean
}

/**
 * Absolute per-scan ceiling multiplier for the forced-progress case: when a single merge's
 * closure exceeds `maxCommits`, progress requires advancing past it whole, but the WORK must
 * stay bounded — at most `maxCommits * this` commits are collected (the NEWEST of the closure,
 * which keeps the merge commit itself and anything near it; the dropped remainder is the old
 * imported history) and the rest are reported via {@link WatchScanResult.dropped}.
 */
const FORCED_CLOSURE_CAP_MULTIPLIER = 5

/**
 * Collect commits for one HEAD-watch scan and compute the watermark to resume from.
 *
 * Why not "advance to the last collected sha" (the old behavior): the watermark is a single
 * ancestry cut — `watermark..HEAD` excludes only the watermark's ANCESTORS. rev-list's
 * (reversed) output is date-interleaved across parallel branches, so in a merge-heavy history
 * the Nth-oldest commit of a capped window does not dominate the other N-1; resuming from it
 * re-lists them on every scan and the window never drains (the 2026-07-10 incident: perpetual
 * ~200-commit rescans, `recorded: 0` forever, multiplied across every watched repo).
 *
 * Semantics:
 * - HEAD unresolvable (unborn repo, transient git failure) => null: skip this scan entirely.
 * - `sinceSha` null (repo never scanned) or unknown to the repo (history rewritten / gc'd)
 *   => `{ commits: [], watermark: HEAD }`: the ledger starts at "now". It deliberately never
 *   backfills history — the old `null => scan everything reachable from HEAD` behavior meant
 *   the first scan of any pre-existing repo listed its ENTIRE history, which on a monorepo is
 *   both a huge burst of work and, combined with the cap above, a wedge.
 * - Window fits in `maxCommits` => collect it all, watermark = the scanned HEAD.
 * - Window exceeds `maxCommits` => cut at the newest FIRST-PARENT commit of the window whose
 *   ancestry closure stays within the cap (binary search; always at least one first-parent
 *   step so even a single over-cap merge drains). A first-parent commit dominates everything
 *   merged beneath it, which is what makes the cut ancestry-safe and progress monotonic —
 *   each scan permanently retires >= 1 first-parent commit from the window.
 */
export async function collectCommitsForWatch(
	repoRoot: string,
	sinceSha: string | null,
	maxCommits: number = MAX_COMMITS,
): Promise<WatchScanResult | null> {
	// Clamp the cap: a zero/negative/NaN caller value must not disable the bounding math below.
	const cap = Math.max(1, Math.floor(maxCommits) || 1)

	const head = await resolveHead(repoRoot)
	if (head.kind !== 'sha') return null

	// The stored watermark crosses the DB boundary — never trust its shape. commitExists
	// regex-validates BEFORE the value can be embedded in a rev-list range below; anything
	// that is not a plausible existing commit sha is treated as "never scanned".
	const since = sinceSha !== null && (await commitExists(repoRoot, sinceSha)) ? sinceSha : null
	if (since === head.sha) {
		return { commits: [], watermark: head.sha, dropped: 0, skipped: 0, held: false }
	}
	if (since === null) {
		// FIRST scan of a newly-watched repo. Initializing the watermark to HEAD and recording
		// nothing (the old behavior) permanently lost every commit made before the repo entered
		// the watch set — with worktree-per-task that is systematically the task's FIRST commits
		// (worktree created, agent commits, THEN the session row makes the repo watched). Full
		// history is still off the table (a monorepo's first scan must not list 10^5 commits),
		// so collect a bounded recent window: the newest `cap` commits within the lookback.
		// Recording is idempotent on (org, sha) server-side, so re-observing commits another
		// host already recorded is a no-op, and swept-in commits by others attribute as human.
		const cutoff = new Date(Date.now() - FIRST_SCAN_LOOKBACK_MS).toISOString()
		const recentShas = await revListReverse(repoRoot, head.sha, [`--max-count=${cap}`, `--since=${cutoff}`])
		if (recentShas.length === 0) {
			return { commits: [], watermark: head.sha, dropped: 0, skipped: 0, held: false }
		}
		const { commits, execFailures } = await collectShas(repoRoot, recentShas)
		if (commits.length === 0 && execFailures > 0) {
			// Every show exec-failed => systemic. There is no prior watermark to hold at, so
			// signal "retry next poll" the same way an unresolvable HEAD does: the watermark
			// stays unset and the next scan re-attempts the whole first-scan window.
			return null
		}
		return {
			commits,
			watermark: head.sha,
			dropped: 0,
			skipped: recentShas.length - commits.length,
			held: false,
		}
	}

	// Pin the range to the resolved HEAD sha (not the literal 'HEAD') so a commit landing
	// mid-scan cannot outrun the watermark we return.
	const range = `${since}..${head.sha}`

	// Count before listing — a count's stdout is constant-size, so even a 10^5+-commit window
	// (subtree merge, runaway backlog) cannot overflow the exec buffer and fail every scan.
	const total = await countRange(repoRoot, range)
	// Empty window with since != HEAD: HEAD moved backwards (reset). Hold position — new
	// commits on the reset base will show up in since..HEAD as soon as they exist.
	if (total === 0) return { commits: [], watermark: since, dropped: 0, skipped: 0, held: false }

	if (total <= cap) {
		const allShas = await revListReverse(repoRoot, range) // listing bounded by total <= cap
		const { commits, execFailures } = await collectShas(repoRoot, allShas)
		// Every show exec-failed => systemic; hold and retry rather than skip the window.
		if (commits.length === 0 && execFailures > 0) {
			return { commits: [], watermark: since, dropped: 0, skipped: 0, held: true }
		}
		return { commits, watermark: head.sha, dropped: 0, skipped: allShas.length - commits.length, held: false }
	}

	// Capped: binary-search the newest first-parent commit whose window closure fits the cap.
	// Only the OLDEST `cap` spine entries can qualify — spine[k]'s closure contains
	// spine[0..k] itself, so closure(spine[k]) >= k+1 > cap for every k >= cap — which is also
	// what keeps this listing bounded regardless of how long the spine really is.
	const spineTotal = await countRange(repoRoot, range, { firstParent: true })
	const spine = await revListOldest(repoRoot, range, spineTotal, cap, ['--first-parent'])
	// Defensive: HEAD is always on the window's own first-parent spine, so an empty slice
	// means a git anomaly. Hold position (observable as a stalled watermark) rather than crash.
	if (spine.length === 0) return { commits: [], watermark: since, dropped: 0, skipped: 0, held: false }

	const cutStart = spine[0]
	if (cutStart === undefined) return { commits: [], watermark: since, dropped: 0, skipped: 0, held: false }
	let cut = cutStart
	let cutClosure = await countRange(repoRoot, `${since}..${cut}`)
	if (cutClosure <= cap) {
		let lo = 1
		let hi = spine.length - 1
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			const midSha = spine[mid]
			if (midSha === undefined) break
			const count = await countRange(repoRoot, `${since}..${midSha}`)
			if (count <= cap) {
				cut = midSha
				cutClosure = count
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
	}

	// Forced-progress case: the first spine step alone (one merge's closure) exceeds the cap.
	// Advancing past it whole is required for progress, but the collection stays bounded by an
	// absolute ceiling — keep the NEWEST slice (which includes the merge commit itself; the
	// dropped remainder is the oldest imported history) and report the drop for the caller to
	// surface. In the normal case cutClosure <= cap <= ceiling and nothing is dropped.
	const ceiling = cap * FORCED_CLOSURE_CAP_MULTIPLIER
	const dropped = Math.max(0, cutClosure - ceiling)
	const windowShas = await revListReverse(
		repoRoot,
		`${since}..${cut}`,
		dropped > 0 ? [`--max-count=${ceiling}`] : [], // --max-count keeps the NEWEST n, then reverses
	)
	const { commits, execFailures } = await collectShas(repoRoot, windowShas)
	// Every show exec-failed => systemic; hold and retry rather than skip the window.
	if (commits.length === 0 && execFailures > 0) {
		return { commits: [], watermark: since, dropped: 0, skipped: 0, held: true }
	}
	return { commits, watermark: cut, dropped, skipped: windowShas.length - commits.length, held: false }
}
