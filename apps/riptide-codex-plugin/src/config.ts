// The plugin's folder under HUMANLAYER_RIPTIDE_HOME, its log, its HumanLayer client, and its
// settings. The client and the login are @humanlayer/session-sdk-auth's, as in the pi extension
// and the opencode plugin; Codex keeps its own logins and host id.
//
// Codex starts MCP servers with a filtered environment: only the names `.mcp.json` lists in
// `env_vars` reach this process. A new setting must go there too, and needs a Codex restart.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDeviceLogin, createSessionClient } from '@humanlayer/session-sdk-auth'
import { type Channel, errorMessage, logLine } from '@humanlayer/session-sdk-base'

function riptideHome(): string {
	return process.env.HUMANLAYER_RIPTIDE_HOME || join(homedir(), '.humanlayer', 'riptide')
}

export function codexDir(): string {
	return join(riptideHome(), 'codex')
}

/** A task's files, shared with riptide-daemon, pi and opencode. `<cwd>/.humanlayer/tasks/<slug>` links here. */
export function artifactsDir(taskId: string): string {
	return join(riptideHome(), 'artifacts', taskId)
}

export function bindingsDir(channel: Channel): string {
	return join(codexDir(), 'bindings', channel)
}

/** Claims on web actions, shared by every Codex thread on this machine. */
export function claimsDir(): string {
	return join(codexDir(), 'claims')
}

/** Every task folder link this plugin made, so worktree detection never counts one as the worktree's own. */
export function linksPath(): string {
	return join(codexDir(), 'task-links.jsonl')
}

/** What `humanlayer-codex attach|off|on` asks of the running threads (control.ts). */
export function controlPath(): string {
	return join(codexDir(), 'control.json')
}

/**
 * HumanLayer's skills for agents other than Claude Code: the rpi skills and show-me. The pi
 * extension keeps them; the built plugin carries a copy in skills/, and a checkout reads the pi
 * extension's folder.
 */
export function bundledSkillsDir(): string {
	const built = fileURLToPath(new URL('./skills/', import.meta.url))
	return existsSync(built) ? built : fileURLToPath(new URL('../../riptide-pi-extension/skills/', import.meta.url))
}

export function logFilePath(): string {
	return join(codexDir(), 'logs', 'codex-humanlayer.log')
}

/** Appends a timestamped line to the log file. Best effort; never throws. */
export function log(line: string): void {
	logLine(logFilePath(), `${new Date().toISOString()} [${process.pid}] ${line}`)
}

/** Runs fn, logging instead of throwing: for work whose failure must not reach Codex. */
export async function guard<T>(name: string, fn: () => T): Promise<Awaited<T> | undefined> {
	try {
		return await fn()
	} catch (err) {
		log(`${name}: ${errorMessage(err)}`)
		return undefined
	}
}

export const client = createSessionClient({
	dir: codexDir,
	log,
	loginHint: 'Run `humanlayer-codex login`.',
	stashKey: 'humanlayer.codex.v1',
})

export const login = createDeviceLogin(client, {
	noBrowser: () => process.env.HUMANLAYER_CODEX_NO_BROWSER === '1',
})

export function isDisabled(): boolean {
	return process.env.HUMANLAYER_CODEX_DISABLE === '1'
}

/**
 * A session the HumanLayer daemon runs already mirrors itself: its agents get these. A Codex the
 * daemon started with this plugin installed must not send the session a second time.
 */
export function daemonSession(): string | undefined {
	return process.env.HUMANLAYER_SESSION_ID || process.env.HUMANLAYER_SESSION_URL || undefined
}

/** HUMANLAYER_TASK: a task id or slug to attach new sessions to, or `new`. */
export function taskFromEnv(): string | undefined {
	return process.env.HUMANLAYER_TASK?.trim() || undefined
}

/**
 * Where approvals are answered. `web` (the default): the web app's answer, until
 * approvalWaitMs passes, then Codex's own prompt. `terminal`: Codex's prompt only.
 */
export function approvalMode(): 'web' | 'terminal' {
	return process.env.HUMANLAYER_CODEX_APPROVALS === 'terminal' ? 'terminal' : 'web'
}

/** How long an approval waits for the web app. The hook's own timeout is 600 s. */
export function approvalWaitMs(): number {
	const seconds = Number(process.env.HUMANLAYER_CODEX_APPROVAL_WAIT)
	return (Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 590) : 540) * 1000
}

/** The codex binary for `codex queue`: the one running this server, unless set. */
export function codexBin(): string {
	return process.env.HUMANLAYER_CODEX_BIN || process.env.CODEX_CLI_PATH || 'codex'
}

/** How long shutdown waits for queued updates to go out. */
export const FLUSH_MS = 5000

/** How often the host heartbeat beats. riptide-daemon beats every 15 s; the web app calls a host stale after 30 s. */
export const HEARTBEAT_MS = 15_000
