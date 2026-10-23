// Small helpers a session-side client needs on disk and in time: JSON files written atomically, a
// lock file shared across processes, an unref'd sleep, JWT claims, and a best-effort log file.

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/** Waits ms without keeping the process alive. An abort ends the wait early, without an error. */
export function sleepUnref(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer)
			signal?.removeEventListener('abort', done)
			resolve()
		}
		const timer = setTimeout(done, ms)
		timer.unref()
		if (signal?.aborted) done()
		else signal?.addEventListener('abort', done, { once: true })
	})
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T
	} catch {
		return null
	}
}

export async function writeJsonFileAtomic(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 })
	const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
	await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
	await rename(tmp, path)
}

/** A lock older than this was left by a crash. */
const LOCK_STALE_MS = 30_000
const LOCK_TIMEOUT_MS = 15_000
const LOCK_POLL_MS = 100

/** Runs fn holding a lock file, across processes. */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
	await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
	const start = Date.now()
	for (;;) {
		try {
			const handle = await open(lockPath, 'wx', 0o600)
			// The holder's pid, so a lock left by a process that died holding it is taken at once.
			await handle.writeFile(String(process.pid))
			await handle.close()
			break
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
			const info = await stat(lockPath).catch(() => null)
			const age = Date.now() - (info?.mtimeMs ?? Date.now())
			if (age > LOCK_STALE_MS || (await holderGone(lockPath))) await unlink(lockPath).catch(() => {})
			else if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error(`HumanLayer: lock timed out: ${lockPath}`)
			else await sleepUnref(LOCK_POLL_MS)
		}
	}
	try {
		return await fn()
	} finally {
		await unlink(lockPath).catch(() => {})
	}
}

/** Whether the lock names a holder that no longer runs. A lock with no pid yet (being made) is held. */
async function holderGone(lockPath: string): Promise<boolean> {
	const pid = Number.parseInt(await readFile(lockPath, 'utf8').catch(() => ''), 10)
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
	try {
		process.kill(pid, 0)
		return false
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'ESRCH'
	}
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
	const part = jwt.split('.')[1]
	if (!part) throw new Error('Malformed JWT: no payload segment')
	const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
	if (typeof parsed !== 'object' || parsed === null) throw new Error('Malformed JWT: payload is not an object')
	return parsed as Record<string, unknown>
}

/** A non-empty string claim of a JWT, else undefined, also for a malformed token. */
export function jwtClaim(jwt: string, key: string): string | undefined {
	try {
		const value = decodeJwtPayload(jwt)[key]
		return typeof value === 'string' && value ? value : undefined
	} catch {
		return undefined
	}
}

let logChain: Promise<void> = Promise.resolve()

/** Best-effort append-only logger. Never throws, never logs secrets. Rotates at 5 MB. */
export function logLine(path: string, line: string): void {
	logChain = logChain.then(async () => {
		try {
			const info = await stat(path).catch(() => null)
			if (info && info.size > 5 * 1024 * 1024) await rename(path, `${path}.1`).catch(() => {})
			await mkdir(dirname(path), { recursive: true, mode: 0o700 })
			await appendFile(path, line.endsWith('\n') ? line : `${line}\n`, { mode: 0o600 })
		} catch {
			// logging is best-effort only
		}
	})
}
