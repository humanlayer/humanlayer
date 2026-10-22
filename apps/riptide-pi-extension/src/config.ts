// Channels, origins and on-disk paths under HUMANLAYER_RIPTIDE_HOME. See plan.md §2.

import { homedir } from 'node:os'
import { join } from 'node:path'

import { authPaths } from '@humanlayer/session-sdk-auth'
import { type Channel, isChannel } from '@humanlayer/session-sdk-base'
import type { CodingAgent } from '@humanlayer/session-sdk-sessions'

import { errorMessage, logLine, readJsonFile, writeJsonFileAtomic } from './util.ts'

export {
	ALL_CHANNELS,
	type Channel,
	type ChannelConfig,
	getChannelConfig,
	isChannel,
} from '@humanlayer/session-sdk-base'

function riptideHome(): string {
	return process.env.HUMANLAYER_RIPTIDE_HOME || join(homedir(), '.humanlayer', 'riptide')
}

/** pi's own folder: its logins, host ids, bindings and log. */
export function piDir(): string {
	return join(riptideHome(), 'pi')
}

export function configFilePath(): string {
	return authPaths(piDir()).config
}

export function hostFilePath(channel: Channel): string {
	return authPaths(piDir()).host(channel)
}

export function sessionFilePath(channel: Channel): string {
	return authPaths(piDir()).session(channel)
}

export function sessionLockPath(channel: Channel): string {
	return authPaths(piDir()).lock(channel)
}

export function bindingsDir(channel: Channel): string {
	return join(piDir(), 'bindings', channel)
}

/** A task's files, shared with the riptide daemon. `<cwd>/.humanlayer/tasks/<slug>` links here. */
export function artifactsDir(taskId: string): string {
	return join(riptideHome(), 'artifacts', taskId)
}

export function logFilePath(): string {
	return join(piDir(), 'logs', 'pi-humanlayer.log')
}

/** Appends a timestamped line to the log file. Best effort; never throws. */
export function log(line: string): void {
	logLine(logFilePath(), `${new Date().toISOString()} ${line}`)
}

/** Runs fn, logging instead of throwing: for work whose failure must not reach pi. */
export function guard<T>(name: string, fn: () => T): T | undefined {
	try {
		return fn()
	} catch (err) {
		log(`${name}: ${errorMessage(err)}`)
		return undefined
	}
}

/** HUMANLAYER_CHANNEL, then config.json's saved channel, then prod. */
export async function resolveChannel(): Promise<Channel> {
	const envChannel = process.env.HUMANLAYER_CHANNEL
	if (isChannel(envChannel)) return envChannel
	const saved = await readJsonFile<{ channel?: string }>(configFilePath())
	if (isChannel(saved?.channel)) return saved.channel
	return 'prod'
}

export async function saveChannel(channel: Channel): Promise<void> {
	await writeJsonFileAtomic(configFilePath(), { channel })
}

export function isDisabled(): boolean {
	return process.env.HUMANLAYER_PI_DISABLE === '1'
}

/** The codingAgent value sent to prepare. The contract defaults to "codelayer", so always send one. */
export type { CodingAgent }

/** HUMANLAYER_PI_CODING_AGENT, else pi. The server refuses a name it doesn't know. */
export function codingAgent(): CodingAgent {
	return (process.env.HUMANLAYER_PI_CODING_AGENT || 'pi') as CodingAgent
}

/** HUMANLAYER_TASK: a task id or slug to attach new bindings to. */
export function taskFromEnv(): string | undefined {
	return process.env.HUMANLAYER_TASK?.trim() || undefined
}

/** How long session_shutdown waits for the outbox to drain. */
export function flushMs(): number {
	const ms = Number.parseInt(process.env.HUMANLAYER_PI_FLUSH_MS ?? '', 10)
	return ms >= 0 ? ms : 5000
}

/** How often the host heartbeat beats. riptide-daemon beats every 15 s; the web app calls a host stale after 30 s. */
export function heartbeatMs(): number {
	const ms = Number.parseInt(process.env.HUMANLAYER_PI_HEARTBEAT_MS ?? '', 10)
	return ms > 0 ? ms : 15_000
}
