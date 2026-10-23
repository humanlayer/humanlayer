// What `humanlayer-codex attach|off|on` asks of Codex. Codex has no plugin slash commands, so the
// CLI writes control.json and each thread's MCP server reads it at its next hook. Kept on disk, an
// attach made before Codex starts still applies to the next new session after a restart.

import { readJsonFile, withFileLock, writeJsonFileAtomic } from '@humanlayer/session-sdk-base'

import { controlPath } from './config.ts'

export interface Control {
	version: 1
	/** The task the next new session in that folder links to, or `new`. */
	nextAttach?: { target: string; cwd: string; at: string }
	/** Per Codex thread: what its next hook applies, then clears. */
	threads?: Record<string, { attach?: string; off?: boolean; at: string }>
}

export async function readControl(): Promise<Control> {
	const c = await readJsonFile<Control>(controlPath())
	return c?.version === 1 ? c : { version: 1 }
}

/** Changes control.json under its lock, so the CLI and the servers never lose each other's writes. */
export async function updateControl<T>(fn: (c: Control) => T): Promise<T> {
	return withFileLock(`${controlPath()}.lock`, async () => {
		const c = await readControl()
		const out = fn(c)
		await writeJsonFileAtomic(controlPath(), c)
		return out
	})
}

/** The next-attach target for a new session in cwd, taken so only one session uses it. */
export async function takeNextAttach(cwd: string): Promise<string | undefined> {
	const c = await readControl()
	if (c.nextAttach?.cwd !== cwd) return undefined
	return updateControl((c) => {
		const target = c.nextAttach?.cwd === cwd ? c.nextAttach.target : undefined
		if (target) delete c.nextAttach
		return target
	})
}

/** A thread's pending request, taken once. */
export async function takeThreadRequest(threadId: string): Promise<{ attach?: string; off?: boolean } | undefined> {
	const c = await readControl()
	if (!c.threads?.[threadId]) return undefined
	return updateControl((c) => {
		const req = c.threads?.[threadId]
		if (c.threads) delete c.threads[threadId]
		return req
	})
}
