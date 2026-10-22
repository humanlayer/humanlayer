import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Store credentials in the same directory as config.json
const CREDENTIALS_DIR = join(homedir(), '.humanlayer', 'riptide')
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'linear.json')

export interface TokenData {
	access_token: string
	refresh_token: string
	expires_at: number // Unix timestamp in milliseconds
	token_type: string
	scope: string
}

/**
 * Save tokens to file storage at ~/.humanlayer/riptide/linear.json
 */
export async function saveTokens(tokens: TokenData): Promise<void> {
	await mkdir(CREDENTIALS_DIR, { recursive: true })
	await writeFile(CREDENTIALS_FILE, JSON.stringify(tokens, null, 2))
	if (process.env.DEBUG?.includes('linear-cli')) {
		console.error('[auth] Tokens saved to file:', CREDENTIALS_FILE)
	}
}

/**
 * Load tokens from file storage at ~/.humanlayer/riptide/linear.json
 */
export async function loadTokens(): Promise<TokenData | null> {
	try {
		const data = JSON.parse(await readFile(CREDENTIALS_FILE, 'utf-8'))

		// Validate required fields
		if (
			typeof data.access_token === 'string' &&
			typeof data.refresh_token === 'string' &&
			typeof data.expires_at === 'number' &&
			!isNaN(data.expires_at)
		) {
			if (process.env.DEBUG?.includes('linear-cli')) {
				console.error('[auth] Tokens loaded from file:', CREDENTIALS_FILE)
			}
			return {
				access_token: data.access_token,
				refresh_token: data.refresh_token,
				expires_at: data.expires_at,
				token_type: data.token_type || 'Bearer',
				scope: data.scope || 'read write',
			}
		}

		// Invalid data - remove corrupted file
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Corrupted credentials file, removing...')
		}
		await rm(CREDENTIALS_FILE, { force: true })
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null
		}
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Failed to parse credentials file:', error)
		}
		// Try to remove corrupted file
		try {
			await rm(CREDENTIALS_FILE, { force: true })
		} catch {}
	}

	return null
}

/**
 * Clear tokens from file storage
 */
export async function clearTokens(): Promise<void> {
	try {
		await rm(CREDENTIALS_FILE, { force: true })
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Credentials file deleted:', CREDENTIALS_FILE)
		}
	} catch (error) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Failed to delete credentials file:', error)
		}
	}
}

/**
 * Check if access token is expired (with 5 minute buffer)
 */
export function isTokenExpired(tokens: TokenData): boolean {
	const bufferMs = 5 * 60 * 1000 // 5 minutes
	return Date.now() >= tokens.expires_at - bufferMs
}
