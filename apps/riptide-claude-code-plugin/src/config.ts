// The plugin's folder under HUMANLAYER_RIPTIDE_HOME, its log, and its HumanLayer client. The
// client and the login are @humanlayer/session-sdk-auth's, as in the pi and opencode plugins;
// Claude Code keeps its own logins and host id, apart from theirs and the daemon's.

import { homedir } from 'node:os'
import { join } from 'node:path'

import { createDeviceLogin, createSessionClient } from '@humanlayer/session-sdk-auth'
import { type Channel, errorMessage, logLine } from '@humanlayer/session-sdk-base'

function riptideHome(): string {
	return process.env.HUMANLAYER_RIPTIDE_HOME || join(homedir(), '.humanlayer', 'riptide')
}

export function pluginDir(): string {
	return join(riptideHome(), 'claude-code')
}

/** A task's files, shared with the riptide daemon and the other plugins. `<cwd>/.humanlayer/tasks/<slug>` links here. */
export function artifactsDir(taskId: string): string {
	return join(riptideHome(), 'artifacts', taskId)
}

export function bindingsDir(channel: Channel): string {
	return join(pluginDir(), 'bindings', channel)
}

/** Claims on web actions, shared by every Claude Code process on this machine. */
export function claimsDir(): string {
	return join(pluginDir(), 'claims')
}

/** Every task folder link this plugin made, so worktree detection never counts one as the worktree's own. */
export function linksPath(): string {
	return join(pluginDir(), 'task-links.jsonl')
}

/** `/humanlayer attach` before a session links, by folder: kept across restarts. */
export function pendingAttachPath(): string {
	return join(pluginDir(), 'pending-attach.json')
}

/**
 * The server's socket, named after the Claude Code process that started it, which is how the mod
 * finds it. Kept short: a Unix socket path must stay near 100 bytes.
 */
export function socketPath(claudePid: number): string {
	return join(pluginDir(), 'run', `${claudePid}.sock`)
}

export function logFilePath(): string {
	return join(pluginDir(), 'logs', 'claude-code-humanlayer.log')
}

/** Appends a timestamped line to the log file. Best effort; never throws. */
export function log(line: string): void {
	logLine(logFilePath(), `${new Date().toISOString()} ${process.pid} ${line}`)
}

/** Runs fn, logging instead of throwing: for work whose failure must not reach Claude Code. */
export async function guard<T>(name: string, fn: () => T): Promise<Awaited<T> | undefined> {
	try {
		return await fn()
	} catch (err) {
		log(`${name}: ${errorMessage(err)}`)
		return undefined
	}
}

export const client = createSessionClient({
	dir: pluginDir,
	log,
	loginHint: 'Run /humanlayer login.',
	stashKey: 'humanlayer.claude-code.v1',
})

export const login = createDeviceLogin(client, {
	noBrowser: () => process.env.HUMANLAYER_CLAUDE_NO_BROWSER === '1',
})

/** How long the exit waits for queued updates to go out. Claude Code sends SIGTERM soon after SIGINT. */
export const FLUSH_MS = 5000

/** How often the host heartbeat beats. riptide-daemon beats every 15 s; the web app calls a host stale after 30 s. */
export const HEARTBEAT_MS = 15_000

/** The coding agent HumanLayer files these sessions under: not launchable, so the web never offers fork or continue. */
export const CODING_AGENT = 'claude-code' as const
