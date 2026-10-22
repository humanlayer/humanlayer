// Task files. `<cwd>/.humanlayer/tasks/<slug>` links to the task's folder in the riptide home, and
// files under it go to the cloud the way riptide-daemon sends them: text through artifacts/upsert,
// anything else through artifacts/createUpload and a PUT to the signed URL. There is no watcher:
// the host reports written paths and asks for scans (after a shell command, at bind, at the end),
// and each scan compares the folder with the ledger the host keeps. Nothing is ever deleted.

import { createHash } from 'node:crypto'
import { appendFile, lstat, mkdir, readdir, readFile, readlink, realpath, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
	type Backoff,
	type Channel,
	classifyRpcError,
	type DaemonPath,
	type DaemonRequest,
	type DaemonResponse,
	errorMessage,
	isRetry,
	Outbox,
	type QueueItem,
	sha256Hex,
	sleepUnref,
	timeout,
} from '@humanlayer/session-sdk-base'
import { git } from '@humanlayer/session-sdk-sessions'

import { frontmatter } from './frontmatter.ts'
import { getMimeType, isSyncableSubpath, isTextFile, MAX_ARTIFACT_TEXT_BYTES } from './rules.ts'

/** hash: what the cloud stores for the file. mtimeSize: `${mtimeMs}:${size}` when it was read. */
export interface LedgerEntry {
	hash: string
	mtimeSize: string
}

/** What the file sync needs from the agent integration around it. */
export interface ArtifactHost {
	readonly channel: Channel
	readonly taskId: string
	readonly sessionId: string
	readonly cwd: string
	/** The task's folder in the riptide home, which `<cwd>/.humanlayer/tasks/<slug>` links to. */
	readonly store: string
	/** Aborts calls in flight when the session ends. */
	readonly signal: AbortSignal
	readonly backoff?: Backoff
	/** Files sent so far, by subpath. The sync changes it in place; save() persists it. */
	ledger(): Record<string, LedgerEntry>
	/** Persists the ledger soon. */
	save(): void
	/** The file just synced, for a status line. */
	note(file: string): void
	/** A notice shown once per key. */
	warn(key: string, message: string): void
	readonly log: (line: string) => void
	daemonCall<P extends DaemonPath>(
		channel: Channel,
		path: P,
		body: DaemonRequest<P>,
		signal?: AbortSignal,
	): Promise<DaemonResponse<P>>
	/** Called before the sync makes a folder link, so later sessions can tell its links from a worktree's own. */
	recordLink?(path: string, taskId: string): Promise<void>
}

/** Content hash for artifact dedup: base64url(sha256("'" + s + "'")), ohash-style. */
export function ohash(s: string): string {
	const wrapped = `'${s.replaceAll('\0', '')}'`
	return createHash('sha256').update(wrapped, 'utf8').digest('base64url')
}

/** The system prompt section, named after HumanLayer's own block. */
export const HINT_SECTION = 'artifacts_directory_information'

/** Tries per file on a 5xx or a network error; after that the file waits for the next scan. */
const TRIES = 5

/** The slug as one safe path segment. An attach by uuid has none: no folder and no hint. */
export function safeSlug(slug: string | undefined): string | undefined {
	return slug && /^[a-z0-9][\w.-]*$/i.test(slug) ? slug : undefined
}

export function taskFolder(cwd: string, slug: string): string {
	return join(cwd, '.humanlayer', 'tasks', slug)
}

/**
 * The prompt hint for a bound or pending session, modeled on riptide-daemon's own: the task folder,
 * and the session's web app link once the cloud session exists.
 */
export function artifactsHint(cwd: string, taskSlug: string | undefined, sessionUrl?: string): string | undefined {
	const lines: string[] = []
	const slug = safeSlug(taskSlug)
	if (slug) {
		const folder = taskFolder(cwd, slug)
		lines.push(
			`Your task artifacts directory is: ${folder}`,
			'',
			"Files you write there sync to the user's HumanLayer task, where the user can read them.",
			"If the user asks you to continue work on a task, design discussion or plan and doesn't mention a file, check here first.",
			"This directory may be a symlink: list it with `ls -La`, and read and write files through this path, never through the link's target.",
			'Use the write and edit tools for artifacts.',
			'',
			'To show the user an HTML page or an image inline, put its path in a fenced block:',
			'```task-artifact',
			`${folder}/page.html`,
			'```',
		)
	}
	if (sessionUrl) {
		if (lines.length > 0) lines.push('')
		lines.push(
			`The user can follow this session in HumanLayer at ${sessionUrl}`,
			'If they ask to see or open the session, open that URL (for example with `open` on macOS or `xdg-open` on Linux).',
		)
	}
	return lines.length > 0 ? lines.join('\n') : undefined
}

/**
 * Links `folder` to `store` as the daemon does, then keeps git from seeing it. A link to another
 * task, or a broken one, is replaced; a link to this task's folder in another riptide home stays.
 * A real dir already there (the model wrote first) stays and syncs as it is.
 * Returns the folder's realpath, or undefined when a file sits at the path.
 */
async function openFolder(host: ArtifactHost, folder: string): Promise<string | undefined> {
	const { store, cwd, log } = host
	await mkdir(store, { recursive: true })
	await mkdir(dirname(folder), { recursive: true })
	const st = await lstat(folder).catch(() => undefined)
	if (st?.isSymbolicLink()) {
		if (basename(await realpath(folder).catch(() => '')) !== basename(store)) {
			log(`relinking ${folder} to ${store}`)
			// A broken link to this same task (the daemon's, say) stays someone else's link.
			const mine = basename(await readlink(folder)) !== basename(store)
			await unlink(folder)
			await linkFolder(host, folder, mine)
		}
	} else if (!st) {
		await linkFolder(host, folder, true)
	} else if (!st.isDirectory()) {
		log(`${folder} is not a folder; task files will not sync`)
		return undefined
	}
	await excludeFromGit(cwd).catch((err) => log(`info/exclude: ${errorMessage(err)}`))
	return realpath(folder)
}

/** mine: the link is this integration's, so it goes in the record first (a crash then leaves no unrecorded link). */
async function linkFolder(host: ArtifactHost, folder: string, mine: boolean): Promise<void> {
	if (mine) await host.recordLink?.(folder, basename(host.store))
	try {
		await symlink(host.store, folder, 'dir')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
	}
}

/** Adds `.humanlayer/tasks/` to the repo's info/exclude unless git ignores it already. Never touches .gitignore. */
async function excludeFromGit(cwd: string): Promise<void> {
	if ((await git(cwd, 'check-ignore', '-q', '--no-index', '--', '.humanlayer/tasks')) !== undefined) return
	const [prefix, path] = await Promise.all([
		git(cwd, 'rev-parse', '--show-prefix'),
		git(cwd, 'rev-parse', '--git-path', 'info/exclude'),
	])
	if (prefix === undefined || !path) return // not a git repo
	const file = resolve(cwd, path)
	await mkdir(dirname(file), { recursive: true })
	const text = await readFile(file, 'utf8').catch(() => '')
	const line = `/${prefix.replace(/[*?[\\]/g, '\\$&')}.humanlayer/tasks/`
	if (text.split(/\r?\n/).includes(line)) return
	await appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`)
}

/** The path as a subpath of one of the roots, by its logical path, then by its realpath. */
async function subpathOf(path: string, roots: string[]): Promise<string | undefined> {
	const under = (p: string) => {
		for (const root of roots) {
			const rel = relative(root, p)
			if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/')
		}
		return undefined
	}
	const real = await realpath(path).catch(() => undefined)
	return under(resolve(path)) ?? (real ? under(real) : undefined)
}

/** Regular files under the folder, as subpaths. Links inside it are not followed, as in the daemon's scan. */
async function listFolder(folder: string): Promise<string[]> {
	const entries = await readdir(folder, { recursive: true, withFileTypes: true })
	return entries
		.filter((e) => e.isFile())
		.map((e) => relative(folder, join(e.parentPath, e.name)).split(sep).join('/'))
		.filter(isSyncableSubpath)
}

interface FileItem extends QueueItem {
	name: string
	/** `mtime:size` of the bytes the last try read. */
	read?: string
}

/** The file lane: its own outbox beside the event outbox, one file at a time. */
export class ArtifactSync {
	private readonly host: ArtifactHost
	private readonly folder: string
	private readonly outbox: Outbox<FileItem>
	/** Resolves to the roots a touched path may sit under, or undefined if there is no folder. */
	private readonly ready: Promise<string[] | undefined>
	private readonly queued = new Set<string>()
	/** Files the server refused (or can't take), by the `mtime:size` refused. A change retries them. */
	private readonly refused = new Map<string, string>()
	private seq = 0
	private closed = false

	/** Links the task folder and scans it. `folder` is taskFolder(cwd, slug). */
	constructor(host: ArtifactHost, folder: string) {
		this.host = host
		const log = host.log
		this.folder = folder
		this.outbox = new Outbox<FileItem>({
			// A name stays in `queued` until its file leaves the queue (sent here, or skipped), so a
			// touch while it waits for a retry adds nothing. The stat after a send catches changes.
			send: async (item) => {
				const changed = await this.send(item)
				this.queued.delete(item.name)
				if (changed) this.push(item.name)
			},
			// Errors the event outbox retries forever get TRIES here; the next scan tries again.
			classify: (err, plane) => {
				const action = classifyRpcError(err, plane)
				return isRetry(action) ? { kind: 'retry-limited', maxAttempts: TRIES - 1 } : action
			},
			// A 403 here means no edit rights on the task: stop this lane, not the mirror.
			onStopBinding: (reason) =>
				host.warn(`artifacts:${reason}`, `HumanLayer: task files stopped syncing: ${reason}`),
			onSkip: (item, err) => {
				this.queued.delete(item.name)
				if (!isRetry(classifyRpcError(err, 'daemon')) && item.read) this.refused.set(item.name, item.read)
				log(`task file ${item.name} not synced: ${errorMessage(err)}`)
			},
			onDrop: (item) => this.queued.delete(item.name),
			log,
			...host.backoff,
		})
		this.ready = openFolder(host, folder).then(
			(real) => (real ? [folder, real] : undefined),
			(err) => {
				log(`task folder ${folder}: ${errorMessage(err)}`)
				return undefined
			},
		)
		this.touched({}) // the scan at bind
	}

	touched(t: { path?: string }): void {
		if (this.closed || this.outbox.isStopped) return
		const run = t.path ? this.syncPath(t.path) : this.scan()
		run.catch((err) => this.host.log(`task files: ${errorMessage(err)}`))
	}

	/** The scan, then the queue, within ms in all. Never rejects. */
	async flush(ms: number): Promise<void> {
		const end = Date.now() + ms
		const run = this.scan().then(() => this.outbox.drain(Math.max(0, end - Date.now())))
		await Promise.race([run.catch(() => undefined), sleepUnref(ms)])
	}

	close(): void {
		this.closed = true
		this.outbox.close()
	}

	private async syncPath(path: string): Promise<void> {
		const roots = await this.ready
		const name = roots && (await subpathOf(path, roots))
		if (!name) return
		if (isSyncableSubpath(name)) this.push(name)
		else this.host.log(`task file ${name} skipped: .trash, or a name the server refuses`)
	}

	/** Queues each file whose `mtime:size` the ledger doesn't have. Never rejects. */
	private async scan(): Promise<void> {
		if (!(await this.ready) || this.closed) return
		const names = await listFolder(this.folder).catch((err) => {
			this.host.log(`task folder scan: ${errorMessage(err)}`)
			return []
		})
		const stats = await Promise.all(names.map((name) => lstat(this.pathOf(name)).catch(() => undefined)))
		const ledger = this.host.ledger()
		names.forEach((name, i) => {
			const st = stats[i]
			const now = st && `${st.mtimeMs}:${st.size}`
			if (now && ledger[name]?.mtimeSize !== now && this.refused.get(name) !== now) this.push(name)
		})
	}

	private push(name: string): void {
		if (this.closed || this.queued.has(name)) return
		this.queued.add(name)
		this.outbox.push({ id: String(++this.seq), plane: 'daemon', sizeBytes: name.length, name })
	}

	private pathOf(name: string): string {
		return join(this.folder, ...name.split('/'))
	}

	/**
	 * One try. Reads the file now, so a retry sends the latest bytes, and skips the call when the
	 * ledger has its hash. Returns whether the file changed while it was being sent.
	 */
	private async send(item: FileItem): Promise<boolean> {
		const path = this.pathOf(item.name)
		const st = await lstat(path).catch(() => undefined)
		if (!st?.isFile()) return false // gone, or not a regular file (no deletes)
		const read = `${st.mtimeMs}:${st.size}`
		item.read = read
		const bytes = await readFile(path)
		const text = isTextFile(item.name)
		const hash = text ? ohash(bytes.toString('utf8')) : sha256Hex(bytes)
		const ledger = this.host.ledger()
		const last = ledger[item.name]
		if (hash !== last?.hash) {
			if (text ? bytes.length > MAX_ARTIFACT_TEXT_BYTES : bytes.length === 0) {
				this.refused.set(item.name, read)
				this.host.log(`task file ${item.name} not synced: ${text ? 'over 10 MiB' : 'empty'}`)
				return false
			}
			if (text) await this.upsert(item.name, path, bytes.toString('utf8'), last ? 'Edit' : 'Write')
			else await this.upload(item.name, bytes, hash)
			this.host.note(item.name)
		}
		ledger[item.name] = { hash, mtimeSize: read }
		this.host.save()
		const after = await lstat(path).catch(() => undefined)
		return after !== undefined && `${after.mtimeMs}:${after.size}` !== read
	}

	private async upsert(name: string, path: string, content: string, operationType: 'Write' | 'Edit'): Promise<void> {
		await this.host.daemonCall(
			this.host.channel,
			'artifacts/upsert',
			{
				taskId: this.host.taskId,
				fileName: name,
				content,
				sessionId: this.host.sessionId,
				operationType,
				operationContents: { path, file_path: path }, // never the file body: the whole request caps at 10 MiB
				frontmatter: frontmatter(content),
			},
			this.host.signal,
		)
	}

	/** createUpload, then the bytes to the signed URL, with the Content-Type it was signed for. */
	private async upload(name: string, bytes: Buffer, hash: string): Promise<void> {
		const contentType = getMimeType(name)
		const { uploadUrl } = await this.host.daemonCall(
			this.host.channel,
			'artifacts/createUpload',
			{
				taskId: this.host.taskId,
				fileName: name,
				contentType,
				contentHash: hash,
				fileSizeBytes: bytes.length,
			},
			this.host.signal,
		)
		const res = await fetch(uploadUrl, {
			method: 'PUT',
			headers: new Headers({ 'content-type': contentType }),
			body: bytes,
			signal: timeout(30_000 + Math.ceil(bytes.length / 100), this.host.signal), // 100 KB/s at worst
		})
		await res.arrayBuffer().catch(() => undefined)
		// A plain Error, so the lane retries it as it would a network failure.
		if (!res.ok) throw new Error(`upload of ${name}: HTTP ${res.status}`)
	}
}
