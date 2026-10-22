export { saveTokens, loadTokens, clearTokens, isTokenExpired } from './storage'
export type { TokenData } from './storage'
export { performOAuthFlow, refreshAccessToken } from './oauth'

import { LinearClient } from '@linear/sdk'

import { performOAuthFlow, refreshAccessToken } from './oauth'
import { loadTokens, saveTokens, clearTokens } from './storage'

/**
 * Check if running in CI mode (CI env var only - flag is passed separately)
 */
export function isCIMode(): boolean {
	return Boolean(process.env.CI)
}

/**
 * Get access token from environment or stored credentials
 * Returns null if no valid token is available
 */
export async function getAccessToken(): Promise<string | null> {
	// Priority 1: Environment variable (API key mode)
	if (process.env.LINEAR_API_KEY) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Using LINEAR_API_KEY from environment')
		}
		return null // Signal to use API key mode instead
	}

	// Priority 2 & 3: Stored OAuth tokens (Bun secrets or file)
	const tokens = await loadTokens()
	if (tokens) {
		try {
			if (process.env.DEBUG?.includes('linear-cli')) {
				const expiresIn = Math.round((tokens.expires_at - Date.now()) / 1000 / 60)
				console.error(`[auth] Token expires in ${expiresIn} minutes, refreshing...`)
			}
			const refreshed = await refreshAccessToken(tokens.refresh_token)
			await saveTokens(refreshed)
			if (process.env.DEBUG?.includes('linear-cli')) {
				console.error('[auth] Token refreshed successfully')
			}
			return refreshed.access_token
		} catch (error) {
			if (process.env.DEBUG?.includes('linear-cli')) {
				console.error('[auth] Token refresh failed:', error instanceof Error ? error.message : error)
			}
			// Clear invalid tokens
			await clearTokens()
			return null
		}
	}

	return null
}

/**
 * Get authenticated Linear client
 * Handles API key, OAuth tokens, and auto-login flow
 *
 * Auth priority:
 * 1. LINEAR_API_KEY env var - always works
 * 2. CI mode check - if CI mode and no API key, return null (error)
 * 3. Stored OAuth tokens
 * 4. Auto OAuth flow
 */
export async function getAuthenticatedClient(options?: { ciFlag?: boolean }): Promise<LinearClient | null> {
	// Compute effective CI mode: explicit flag OR environment variable
	const ciMode = options?.ciFlag || isCIMode()

	// Priority 1: Environment variable (API key mode)
	if (process.env.LINEAR_API_KEY) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] Using LINEAR_API_KEY from environment')
		}
		return new LinearClient({ apiKey: process.env.LINEAR_API_KEY })
	}

	// Priority 2: CI mode check - if in CI mode without API key, fail immediately
	// CI mode means: API key only, no stored tokens, no OAuth
	if (ciMode) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] CI mode enabled but LINEAR_API_KEY not set')
		}
		return null
	}

	// Priority 3: Stored OAuth tokens
	const accessToken = await getAccessToken()
	if (accessToken) {
		return new LinearClient({ accessToken })
	}

	// Priority 4: Auto-login via OAuth (not in CI mode)
	if (process.env.DEBUG?.includes('linear-cli')) {
		console.error('[auth] No credentials found, initiating OAuth flow...')
	}
	try {
		const tokens = await performOAuthFlow()
		await saveTokens(tokens)
		return new LinearClient({ accessToken: tokens.access_token })
	} catch (error) {
		if (process.env.DEBUG?.includes('linear-cli')) {
			console.error('[auth] OAuth flow failed:', error)
		}
		return null
	}
}
