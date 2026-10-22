import { LinearClient } from '@linear/sdk'

import { getAuthenticatedClient } from '../auth'
import { loadTokens } from '../auth/storage'

/**
 * Initialize Linear client with authentication check (sync, API key only)
 * @deprecated Use initializeLinearClientAsync for OAuth support
 */
export function initializeLinearClient(needsAuth: boolean): LinearClient | undefined {
	if (!needsAuth) {
		return undefined
	}

	if (!process.env.LINEAR_API_KEY) {
		return undefined
	}

	return new LinearClient({
		apiKey: process.env.LINEAR_API_KEY,
	})
}

/**
 * Initialize Linear client with full auth support (async, supports OAuth)
 */
export async function initializeLinearClientAsync(
	needsAuth: boolean,
	options?: { ciFlag?: boolean },
): Promise<LinearClient | undefined> {
	if (!needsAuth) {
		return undefined
	}

	const client = await getAuthenticatedClient(options)
	return client ?? undefined
}

/**
 * Check if auth is needed based on command
 */
export function needsAuthentication(argv: string[]): boolean {
	const command = argv[2]
	return (
		argv.length > 2 &&
		command !== undefined &&
		!['--help', '-h', '--version', '-v', 'completion', 'help', 'login', 'logout'].includes(command)
	)
}

export type LinearClientResult = { resolved: true; linear: LinearClient; source: 'env' | 'file' } | { resolved: false }

/**
 * Attempts to get a Linear client without triggering OAuth prompts.
 *
 * @returns LinearClientResult - either resolved with client and source, or not resolved
 */
export async function maybeGetLinearClient(): Promise<LinearClientResult> {
	// Priority 1: LINEAR_API_KEY environment variable (no prompt possible)
	if (process.env.LINEAR_API_KEY) {
		return {
			resolved: true,
			linear: new LinearClient({ apiKey: process.env.LINEAR_API_KEY }),
			source: 'env',
		}
	}

	// Priority 2: Existing OAuth tokens from file storage
	try {
		const tokens = await loadTokens()
		if (tokens?.access_token) {
			return {
				resolved: true,
				linear: new LinearClient({ accessToken: tokens.access_token }),
				source: 'file',
			}
		}
	} catch {
		// Token loading failed - treat as no credentials
	}

	return { resolved: false }
}
