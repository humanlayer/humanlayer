import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { EnvironmentName } from '../lib/macros'

function credentialsDir(): string {
	return process.env.HUMANLAYER_RIPTIDE_HOME ?? join(homedir(), '.humanlayer', 'riptide')
}

function sessionFile(env: EnvironmentName): string {
	return join(credentialsDir(), `workos-session-${env}.json`)
}

export interface WorkOSSession {
	access_token: string
	refresh_token: string
	expires_at: number // Unix timestamp in milliseconds
	user_id: string
	organization_id: string
}

export async function saveSession(env: EnvironmentName, session: WorkOSSession): Promise<void> {
	await mkdir(credentialsDir(), { recursive: true })
	await writeFile(sessionFile(env), JSON.stringify(session, null, 2))
}

export async function loadSession(env: EnvironmentName): Promise<WorkOSSession | null> {
	try {
		const data = JSON.parse(await readFile(sessionFile(env), 'utf8')) as unknown
		if (
			data !== null &&
			typeof data === 'object' &&
			'access_token' in data &&
			typeof (data as Record<string, unknown>).access_token === 'string' &&
			'refresh_token' in data &&
			typeof (data as Record<string, unknown>).refresh_token === 'string' &&
			'expires_at' in data &&
			typeof (data as Record<string, unknown>).expires_at === 'number'
		) {
			return data as WorkOSSession
		}
		// Corrupted file — remove it
		await rm(sessionFile(env), { force: true })
	} catch {
		await rm(sessionFile(env), { force: true })
	}
	return null
}

export async function clearSession(env: EnvironmentName): Promise<void> {
	await rm(sessionFile(env), { force: true })
}

export function isSessionExpired(session: WorkOSSession): boolean {
	const bufferMs = 5 * 60 * 1000 // 5 minute buffer
	return Date.now() >= session.expires_at - bufferMs
}
