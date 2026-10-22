// The task diff: the working tree's diff against the task's base commit, published as rows on
// the task's durable streams (diff-patches, then diff-files), the way riptide-daemon's task-diff
// service does. The build never writes to the user's index or object store: `git add` runs on a
// copy of the index, and its new blobs go to a temp object dir that reads the repo's objects as an
// alternate. Env files and .humanlayer/ never leave the machine. A publish sends only rows whose
// hash changed since the binding's `published` map, plus deletes for paths that left the diff.

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import {
	errorMessage,
	isTransient,
	LoginRequiredError,
	RpcError,
	sha256Hex,
	sleepUnref,
} from '@humanlayer/session-sdk-base'

import { parseNameStatus, parseNumstat } from './git-output.ts'
import { isPrivateDiffPath } from './paths.ts'
import {
	diffFileRowId,
	MAX_TASK_DIFF_PATCH_BYTES,
	patchFits,
	type TaskDiffFileRow,
	type TaskDiffPatchRow,
} from './rows.ts'
import { diffStreamMessage, messageBatches } from './stream-messages.ts'

export interface DiffRows {
	files: TaskDiffFileRow[]
	patches: TaskDiffPatchRow[]
}

export interface DiffTarget {
	syncUrl: string // the channel's sync origin
	orgId: string // internal org uuid (the daemon token's organizationId)
	taskId: string
	sessionId: string
	gitRoot: string
	baseSha: string // HEAD at bind time
	repoId: string // basename(gitRoot), also repoDisplayName
	published: Record<string, { patchHash?: string; rowHash: string }> // from the binding file; path → what we last sent
}

export type DiffErrorKind = 'login-required' | 'stopped' | 'transient'

export interface DiffSyncOptions {
	daemonToken: () => Promise<string>
	remintDaemonToken: () => Promise<string> // called once per run on a 401 or 403, then the run gives up and reports
	onPublished: (published: DiffTarget['published']) => void // the caller saves it in the binding file
	onError?: (kind: DiffErrorKind, message: string) => void // once per kind until a run succeeds
	log?: (line: string) => void // default: no log
	debounceMs?: number // default 1500
	maxPatchBytes?: number // default 8 MiB; larger patches get patchOmittedReason "too_large"
	maxPostBytes?: number // default 10 MB per POST
	retryBaseMs?: number // first retry backoff, doubling; default 500
}

/** The base sha or repo id can't be used, so no retry can help (e.g. a repo with no commits). */
export class DiffTargetError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DiffTargetError'
	}
}

/** A failed git command: its last stderr line, and execFile's code (the exit status, or a Node code). */
class GitError extends Error {
	readonly code: string | number | undefined

	constructor(message: string, code: string | number | null | undefined) {
		super(message)
		this.name = 'GitError'
		this.code = code ?? undefined
	}
}

type PublishedEntry = DiffTarget['published'][string]
type StreamName = 'diff-patches' | 'diff-files'

const MAX_POST_BYTES = 10_000_000 // the sync proxy answers 413 over 10 MiB
const LIST_MAX_BUFFER = 256 * 1024 * 1024
const GIT_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 4
const PATCH_CONCURRENCY = 4
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/
const ENV_GLOBS = ['**/.env*', '**/.env*/**', '**/*.env']
// For commands that write the temp index: a split index would write its shared file into .git.
const WRITE = ['-c', 'core.splitIndex=false']
/** The writer name on stream messages. */
const FROM = 'pi-humanlayer'
const DIFF = ['diff', '--cached', '-M', '--no-color', '--no-ext-diff', '--no-textconv']

/** Runs git and resolves with its raw stdout. */
function git(
	cwd: string,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; maxBuffer?: number } = {},
): Promise<Buffer> {
	const { env, signal, maxBuffer = LIST_MAX_BUFFER } = opts
	return new Promise((done, fail) => {
		execFile(
			'git',
			args,
			{ cwd, env, signal, maxBuffer, timeout: GIT_TIMEOUT_MS, encoding: 'buffer' },
			(err, stdout, stderr) => {
				if (!err) return done(stdout)
				const name = args.find((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-c')
				const detail = stderr.toString('utf8').trim().split('\n').at(-1) || err.message
				fail(new GitError(`git ${name}: ${detail}`, err.code))
			},
		)
	})
}

/** True when sha names a commit in the repo at cwd. */
async function isCommit(cwd: string, sha: string, signal?: AbortSignal): Promise<boolean> {
	if (!SHA.test(sha)) return false
	try {
		await git(cwd, ['rev-parse', '--verify', '-q', `${sha}^{commit}`], { signal })
		return true
	} catch (err) {
		if (signal?.aborted) throw err
		return false
	}
}

/** A file git reports no numstat line for. */
const NO_STATS = { additions: 0, deletions: 0, binary: false }

/** Maps with at most `limit` calls in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = []
	// One iterator shared by the workers: each takes the next item.
	const queue = items.entries()
	const worker = async () => {
		for (const [i, item] of queue) out[i] = await fn(item)
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return out
}

/** Drops undefined fields, so a row looks the same in memory as on the wire. */
function compact<T extends object>(row: T): T {
	return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T
}

/** Exported for tests: build the current rows without publishing. */
export async function buildDiff(
	target: Pick<DiffTarget, 'gitRoot' | 'baseSha' | 'taskId' | 'repoId' | 'sessionId'>,
	opts: { maxPatchBytes?: number; signal?: AbortSignal } = {},
): Promise<DiffRows> {
	const { gitRoot, baseSha, taskId, repoId, sessionId } = target
	const { signal, maxPatchBytes = MAX_TASK_DIFF_PATCH_BYTES } = opts
	// The UI splits file row ids on ":", so the repo id can't hold one.
	if (!repoId || repoId.includes(':'))
		throw new DiffTargetError(`repo id ${JSON.stringify(repoId)} is empty or has a ":"`)
	if (!(await isCommit(gitRoot, baseSha, signal))) {
		throw new DiffTargetError(`diff base ${JSON.stringify(baseSha)} is not a commit in ${gitRoot}`)
	}
	const paths = await git(gitRoot, ['rev-parse', '--git-path', 'index', '--git-path', 'objects'], { signal })
	const [indexFile = '', objectsDir = ''] = paths
		.toString('utf8')
		.trim()
		.split('\n')
		.map((line) => resolve(gitRoot, line))
	const tmp = await mkdtemp(join(tmpdir(), 'pi-hl-diff-'))
	try {
		const env = {
			...process.env,
			GIT_INDEX_FILE: join(tmp, 'index'),
			GIT_OBJECT_DIRECTORY: join(tmp, 'objects'),
			// Quoted when it holds the list separator, which git reads C-style.
			GIT_ALTERNATE_OBJECT_DIRECTORIES: objectsDir.includes(delimiter) ? JSON.stringify(objectsDir) : objectsDir,
			GIT_TERMINAL_PROMPT: '0', // never prompt in pi's terminal
		}
		await mkdir(env.GIT_OBJECT_DIRECTORY)
		const run = (args: string[], maxBuffer?: number) => git(gitRoot, args, { env, signal, maxBuffer })
		// --sparse keeps entries outside a sparse checkout; git < 2.34 lacks it and exits 129.
		const withSparse = (args: string[]) =>
			run(args).catch((err: unknown) => {
				if (!(err instanceof GitError) || err.code !== 129) throw err
				return run(args.filter((arg) => arg !== '--sparse'))
			})
		// The copy keeps the index's mtime, or git would trust stat data for files changed in the
		// same second as the index was written (racy git) and miss those edits.
		const copied = await cp(indexFile, env.GIT_INDEX_FILE, { preserveTimestamps: true }).then(
			() => true,
			(err: NodeJS.ErrnoException) => {
				if (err.code !== 'ENOENT') throw err
				return false
			},
		)
		// No index yet: start from the base tree, so tracked files that are now ignored stay tracked.
		if (!copied) await run([...WRITE, 'read-tree', baseSha])
		const excludes = [...ENV_GLOBS, '**/.humanlayer/**'].map((glob) => `:(exclude,glob)${glob}`)
		await withSparse([...WRITE, 'add', '--all', '--sparse', '--', '.', ...excludes])
		// Tracked env files leave the temp index too, so `mv .env config.txt` shows as a rename from
		// .env (dropped below) rather than a new file that holds the secret.
		const envSpecs = ENV_GLOBS.map((glob) => `:(glob)${glob}`)
		await withSparse([
			...WRITE,
			'rm',
			'-r',
			'-f',
			'-q',
			'--cached',
			'--ignore-unmatch',
			'--sparse',
			'--',
			...envSpecs,
		])
		const [nameStatus, numstat] = await Promise.all([
			run([...DIFF, '-z', '--name-status', baseSha]),
			run([...DIFF, '-z', '--numstat', baseSha]),
		])
		const stats = parseNumstat(numstat.toString('utf8'))
		const changes = parseNameStatus(nameStatus.toString('utf8')).filter(
			(c) => !isPrivateDiffPath(c.path) && (c.prevPath === undefined || !isPrivateDiffPath(c.prevPath)),
		)
		const updatedAt = new Date().toISOString()
		const rows = await mapLimit(changes, PATCH_CONCURRENCY, async (change) => {
			const specs = change.prevPath === undefined ? [change.path] : [change.prevPath, change.path]
			const args = [
				'--literal-pathspecs',
				...DIFF,
				'--binary',
				'--full-index',
				'--src-prefix=a/',
				'--dst-prefix=b/',
			]
			// Reading stops at maxPatchBytes: a longer patch can't fit once JSON-escaped either.
			const patch = await run([...args, baseSha, '--', ...specs], maxPatchBytes).then(
				(out) => out.toString('utf8'),
				(err: unknown) => {
					if (err instanceof GitError && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return undefined
					throw err
				},
			)
			const byteLength = patch === undefined ? undefined : Buffer.byteLength(patch)
			let patchRow: TaskDiffPatchRow | undefined
			if (patch !== undefined && patchFits(patch, maxPatchBytes)) {
				const patchHash = sha256Hex(patch)
				patchRow = {
					id: patchHash,
					taskId,
					repoId,
					sessionId,
					patchHash,
					patch,
					byteLength: Buffer.byteLength(patch),
					updatedAt,
				}
			}
			const { additions, deletions, binary } = stats.get(change.path) ?? NO_STATS
			const file = compact<TaskDiffFileRow>({
				id: `${taskId}:${repoId}:${change.path}`,
				taskId,
				repoId,
				repoDisplayName: repoId,
				sessionId,
				path: change.path,
				prevPath: change.prevPath,
				changeType: change.changeType,
				additions,
				deletions,
				binary,
				generated: false,
				patchHash: patchRow?.patchHash,
				patchByteLength: byteLength,
				patchOmittedReason: patchRow ? undefined : 'too_large',
				updatedAt,
			})
			return { file, patchRow }
		})
		return { files: rows.map((r) => r.file), patches: rows.flatMap((r) => (r.patchRow ? [r.patchRow] : [])) }
	} finally {
		await rm(tmp, { recursive: true, force: true }).catch(() => {})
	}
}

interface Plan {
	patches: TaskDiffPatchRow[]
	files: TaskDiffFileRow[]
	deletes: string[] // paths
	next: Map<string, PublishedEntry>
}

/** How a failed run is reported. Only "stopped" ends the sync; the others wait for the next run. */
function errorKind(err: unknown): DiffErrorKind {
	if (err instanceof LoginRequiredError || (err instanceof RpcError && err.status === 401)) return 'login-required'
	if (err instanceof DiffTargetError || (err instanceof RpcError && !isTransient(err))) return 'stopped'
	return 'transient'
}

/**
 * Publishes one binding's diff. touched() and flush() queue runs: one in flight plus at most one
 * pending. pi's handlers never wait on it: touched() returns at once, and nothing it starts can
 * reject unhandled.
 */
export class DiffSync {
	private readonly target: DiffTarget
	private readonly opts: DiffSyncOptions
	private readonly abort = new AbortController()
	/** Streams known to exist, so later runs skip the HEAD. */
	private readonly ready = new Set<StreamName>()
	/** Streams this process created that haven't had a full publish yet. */
	private readonly empty = new Set<StreamName>()
	private published: Map<string, PublishedEntry>
	private timer: NodeJS.Timeout | undefined
	private current: Promise<void> = Promise.resolve()
	private running = false
	private pending = false
	private closed = false
	private stopped = false
	private token: string | undefined
	private reminted = false
	private reported: DiffErrorKind | undefined

	constructor(target: DiffTarget, opts: DiffSyncOptions) {
		this.target = target
		this.opts = opts
		this.published = new Map(Object.entries(target.published))
	}

	/** Something may have changed: run debounceMs after the first touch since the last run. */
	touched(): void {
		if (this.closed || this.stopped || this.timer) return
		this.timer = setTimeout(() => {
			this.timer = undefined
			void this.kick()
		}, this.opts.debounceMs ?? 1500)
		this.timer.unref()
	}

	/** Runs now (cancelling the debounce) and waits for it, for at most ms. Never rejects. */
	async flush(ms: number): Promise<void> {
		this.clearTimer()
		if (this.closed || this.stopped) return
		await Promise.race([this.kick(), sleepUnref(ms)])
	}

	/** Stops the timer and aborts in-flight git and fetch calls, so print mode can exit. */
	close(): void {
		this.closed = true
		this.clearTimer()
		this.abort.abort()
	}

	private clearTimer(): void {
		clearTimeout(this.timer)
		this.timer = undefined
	}

	/** Starts the run loop, or asks the running one for one more run. Resolves when the loop ends. */
	private kick(): Promise<void> {
		this.pending = true
		if (!this.running) this.current = this.loop().catch((err: unknown) => this.log(`diffs: ${errorMessage(err)}`))
		return this.current
	}

	// `running` is cleared with no await after the last `pending` check, so no kick() is lost.
	private async loop(): Promise<void> {
		this.running = true
		try {
			while (this.pending && !this.closed && !this.stopped) {
				this.pending = false
				await this.run()
			}
		} finally {
			this.running = false
		}
	}

	/** One build and publish. Never throws: failures are reported, and the work waits for the next run. */
	private async run(): Promise<void> {
		this.token = undefined
		this.reminted = false
		try {
			const built = await buildDiff(this.target, {
				maxPatchBytes: this.opts.maxPatchBytes,
				signal: this.abort.signal,
			})
			// Even with nothing to send: the web app reads each stream once when the page opens and
			// never retries a 404, so a page opened before the first edit would stay empty.
			await this.ensure('diff-patches')
			await this.ensure('diff-files')
			const todo = this.plan(built)
			if (todo.patches.length + todo.files.length + todo.deletes.length > 0) await this.publish(todo)
			this.reported = undefined
		} catch (err) {
			if (this.closed) return
			const kind = errorKind(err)
			if (kind === 'stopped') {
				this.stopped = true
				this.clearTimer()
			}
			this.report(kind, errorMessage(err))
		}
	}

	/** Rows whose hash changed since the last publish, and deletes for paths that left the diff. */
	private plan(built: DiffRows): Plan {
		const freshPatches = this.empty.has('diff-patches')
		const freshFiles = this.empty.has('diff-files')
		const patchRows = new Map(built.patches.map((row) => [row.patchHash, row]))
		const patches = new Map<string, TaskDiffPatchRow>()
		const files: TaskDiffFileRow[] = []
		const next = new Map<string, PublishedEntry>()
		for (const file of built.files) {
			const before = this.published.get(file.path)
			const rowHash = sha256Hex(JSON.stringify({ ...file, updatedAt: undefined }))
			next.set(file.path, file.patchHash === undefined ? { rowHash } : { patchHash: file.patchHash, rowHash })
			const patch = file.patchHash === undefined ? undefined : patchRows.get(file.patchHash)
			if (patch && (freshPatches || before?.patchHash !== patch.patchHash)) patches.set(patch.patchHash, patch)
			if (freshFiles || before?.rowHash !== rowHash) files.push(file)
		}
		const deletes = freshFiles ? [] : [...this.published.keys()].filter((path) => !next.has(path))
		return { patches: [...patches.values()], files, deletes, next }
	}

	/** HEAD the stream, and PUT it on a 404. A stream made here holds no rows, so it gets a full publish. */
	private async ensure(stream: StreamName): Promise<void> {
		if (this.ready.has(stream)) return
		if ((await this.send('HEAD', stream)) === 404 && (await this.send('PUT', stream)) === 201)
			this.empty.add(stream)
		this.ready.add(stream)
	}

	/** Patches first, so every file row's patch is there when the UI reads it. */
	private async publish(todo: Plan): Promise<void> {
		const { taskId, repoId } = this.target
		const at = new Date().toISOString()
		const max = this.opts.maxPostBytes ?? MAX_POST_BYTES
		const patches = todo.patches.map((row) => diffStreamMessage('task-diff-patch', row.id, 'upsert', at, FROM, row))
		const files = [
			...todo.files.map((row) => diffStreamMessage('task-diff-file', row.id, 'upsert', at, FROM, row)),
			...todo.deletes.map((path) =>
				diffStreamMessage('task-diff-file', diffFileRowId(taskId, repoId, path), 'delete', at, FROM),
			),
		]
		for (const body of messageBatches(patches, max)) await this.send('POST', 'diff-patches', body)
		for (const body of messageBatches(files, max)) await this.send('POST', 'diff-files', body)
		this.published = todo.next
		this.empty.clear()
		this.log(
			`diffs: published ${todo.files.length} files, ${todo.patches.length} patches, ${todo.deletes.length} deletes`,
		)
		try {
			this.opts.onPublished(Object.fromEntries(todo.next))
		} catch (err) {
			this.log(`diffs: onPublished: ${errorMessage(err)}`)
		}
	}

	/** request() with backoff on retryable failures, and one token re-mint per run on a 401 or 403. */
	private async send(method: 'HEAD' | 'PUT' | 'POST', stream: StreamName, body?: string): Promise<number> {
		let backoffMs = this.opts.retryBaseMs ?? 500
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.request(method, stream, body)
			} catch (err) {
				if (this.closed) throw err
				const status = err instanceof RpcError ? err.status : 0
				if ((status === 401 || status === 403) && !this.reminted) {
					this.reminted = true
					this.token = await this.opts.remintDaemonToken().catch((e: unknown) => {
						throw new LoginRequiredError(`daemon token re-mint failed: ${errorMessage(e)}`)
					})
					continue
				}
				if (!isTransient(err) || attempt >= MAX_ATTEMPTS) throw err
				this.log(`diffs: ${errorMessage(err)}; retry in ${backoffMs} ms`)
				await sleepUnref(backoffMs)
				backoffMs *= 2
			}
		}
	}

	/** One request to a diff stream. Resolves with the status (HEAD may 404, PUT may 409); throws RpcError otherwise. */
	private async request(method: 'HEAD' | 'PUT' | 'POST', stream: StreamName, body?: string): Promise<number> {
		this.token ??= await this.opts.daemonToken()
		const { syncUrl, orgId, taskId } = this.target
		const url = `${syncUrl.replace(/\/+$/, '')}/v2/streams/organizations/${encodeURIComponent(orgId)}/tasks/${encodeURIComponent(taskId)}/${stream}`
		const headers = new Headers({ 'x-daemon-authorization': this.token })
		if (method !== 'HEAD') headers.set('content-type', 'application/json')
		const res = await fetch(url, {
			method,
			headers,
			body,
			signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		})
		const text = await res.text()
		if (res.ok || (method === 'HEAD' && res.status === 404) || (method === 'PUT' && res.status === 409))
			return res.status
		throw new RpcError(
			`${method} ${stream}: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`,
			res.status,
			undefined,
		)
	}

	/** Logs every failure; tells the caller once per kind until a run succeeds. */
	private report(kind: DiffErrorKind, message: string): void {
		this.log(`diffs: ${kind}: ${message}`)
		if (this.reported === kind) return
		this.reported = kind
		try {
			this.opts.onError?.(kind, message)
		} catch {
			// the caller's callback must not break the run loop
		}
	}

	private log(line: string): void {
		try {
			this.opts.log?.(line)
		} catch {
			// logging is best effort
		}
	}
}
