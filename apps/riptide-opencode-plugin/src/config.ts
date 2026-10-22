// The plugin's folder under HUMANLAYER_RIPTIDE_HOME, its log, and its HumanLayer client. The
// client and the login are @humanlayer/session-sdk-auth's, as in the pi extension; opencode keeps
// its own logins and host id.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDeviceLogin, createSessionClient } from '@humanlayer/session-sdk-auth'
import { type Channel, errorMessage, logLine } from '@humanlayer/session-sdk-base'

function riptideHome(): string {
	return process.env.HUMANLAYER_RIPTIDE_HOME || join(homedir(), '.humanlayer', 'riptide')
}

export function opencodeDir(): string {
	return join(riptideHome(), 'opencode')
}

/** A task's files, shared with the riptide daemon and pi. `<cwd>/.humanlayer/tasks/<slug>` links here. */
export function artifactsDir(taskId: string): string {
	return join(riptideHome(), 'artifacts', taskId)
}

export function bindingsDir(channel: Channel): string {
	return join(opencodeDir(), 'bindings', channel)
}

/** Claims on web actions, shared by every opencode process on this machine (claims.ts). */
export function claimsDir(): string {
	return join(opencodeDir(), 'claims')
}

/** Every task folder link this plugin made, so worktree detection never counts one as the worktree's own. */
export function linksPath(): string {
	return join(opencodeDir(), 'task-links.jsonl')
}

/**
 * HumanLayer's skills for agents other than Claude Code: the rpi skills and show-me. The pi
 * extension keeps them; the built package carries a copy in skills/ beside its index.js, and a
 * checkout reads the pi extension's folder.
 */
export function bundledSkillsDir(): string {
	const built = fileURLToPath(new URL('./skills/', import.meta.url))
	return existsSync(built) ? built : fileURLToPath(new URL('../../riptide-pi-extension/skills/', import.meta.url))
}

export function logFilePath(): string {
	return join(opencodeDir(), 'logs', 'opencode-humanlayer.log')
}

/** Appends a timestamped line to the log file. Best effort; never throws. */
export function log(line: string): void {
	logLine(logFilePath(), `${new Date().toISOString()} ${line}`)
}

/** Runs fn, logging instead of throwing: for work whose failure must not reach opencode. */
export async function guard<T>(name: string, fn: () => T): Promise<Awaited<T> | undefined> {
	try {
		return await fn()
	} catch (err) {
		log(`${name}: ${errorMessage(err)}`)
		return undefined
	}
}

export const client = createSessionClient({
	dir: opencodeDir,
	log,
	loginHint: 'Run `humanlayer-opencode login`.',
	stashKey: 'humanlayer.opencode.v1',
})

export const login = createDeviceLogin(client, {
	noBrowser: () => process.env.HUMANLAYER_OPENCODE_NO_BROWSER === '1',
})

export function isDisabled(): boolean {
	return process.env.HUMANLAYER_OPENCODE_DISABLE === '1'
}

/** HUMANLAYER_TASK: a task id or slug to attach new sessions to. */
export function taskFromEnv(): string | undefined {
	return process.env.HUMANLAYER_TASK?.trim() || undefined
}

/** How long dispose waits for queued updates to go out. */
export const FLUSH_MS = 5000

/** How often the host heartbeat beats. riptide-daemon beats every 15 s; the web app calls a host stale after 30 s. */
export const HEARTBEAT_MS = 15_000
