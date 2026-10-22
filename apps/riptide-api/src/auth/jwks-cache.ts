import * as Sentry from '@sentry/node'
import { importJWK, type JWK } from 'jose'

import { getJwksUrl } from '../lib/workos'
import { logger } from '../logger'

type ImportedJwk = Awaited<ReturnType<typeof importJWK>>

export class JWKSCache {
	private keys = new Map<string, ImportedJwk>()

	async start(): Promise<void> {
		while (true) {
			await this.refreshKeys()
			// Wait 5 minutes before next refresh
			await new Promise((resolve) => setTimeout(resolve, 300_000))
		}
	}

	async forceRefresh(): Promise<void> {
		await this.refreshKeys()
	}

	private async refreshKeys(): Promise<void> {
		try {
			// Fetch with 10 second timeout
			const response = await fetch(getJwksUrl(), {
				signal: AbortSignal.timeout(10_000),
			})

			if (!response.ok) {
				throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`)
			}

			const data = (await response.json()) as { keys: JWK[] }

			if (!data || !Array.isArray(data.keys)) {
				throw new Error('Invalid JWKS response format')
			}

			// Import all keys and store them
			const newKeys = new Map<string, ImportedJwk>()
			for (const jwk of data.keys) {
				if (jwk.kid) {
					const key = await importJWK(jwk)
					newKeys.set(jwk.kid, key)
				}
			}

			// Replace old keys with new ones
			this.keys = newKeys
		} catch (error) {
			Sentry.captureException(error, {
				tags: { error_type: 'jwks_refresh' },
			})
			logger.error(error, 'JWKS refresh failed')
			// Keep existing keys if refresh fails
		}
	}

	getKey(kid: string): ImportedJwk | undefined {
		return this.keys.get(kid)
	}
}

// Export singleton instance
export const jwksCache = new JWKSCache()
