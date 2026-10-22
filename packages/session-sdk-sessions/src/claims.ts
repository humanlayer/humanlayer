// Claims on web actions. Every process of an agent on this machine follows the same shape of its
// host's sessions, so two processes in one folder both see each web message. The first to create
// the claim file runs it; the others skip it. Claim files are empty markers, pruned after a day.

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** How long a claim file stays: long past any row change a process could still see. */
const KEEP_MS = 24 * 60 * 60 * 1000

/** True when this process took the key, false when another process has it. */
export async function claim(dir: string, key: string): Promise<boolean> {
	await mkdir(dir, { recursive: true, mode: 0o700 })
	try {
		await writeFile(join(dir, key.replace(/[^\w.-]/g, '_')), '', { flag: 'wx', mode: 0o600 })
		return true
	} catch (err) {
		if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return false
		throw err
	}
}

/** Deletes claims older than KEEP_MS. Best effort. */
export async function pruneClaims(dir: string, now = Date.now()): Promise<void> {
	for (const name of await readdir(dir).catch(() => [])) {
		const path = join(dir, name)
		const info = await stat(path).catch(() => undefined)
		if (info && now - info.mtimeMs > KEEP_MS) await rm(path, { force: true }).catch(() => {})
	}
}
