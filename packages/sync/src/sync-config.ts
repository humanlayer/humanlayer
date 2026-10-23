import type { SyncPathVersion } from '@humanlayer/db/tables/organization-settings'

// Re-export types from db as the single source of truth
export type { SyncPathVersion }

// Type aliases for API/client contexts
export type SyncVersion = SyncPathVersion

// Route versions beyond the org-level SyncPathVersion (1|2): individual collections may
// pin a newer proxy route (e.g. /v3/hosts) while the org-wide sync version stays put.
export type SyncRouteVersion = SyncPathVersion | 3

export const DEFAULT_BACKOFF_OPTIONS = {
	initialDelay: 500,
	maxDelay: 10_000,
	multiplier: 1.3,
	maxRetries: Infinity,
} as const

export class AccessTokenUnavailableError extends Error {
	constructor(message?: string, options?: ErrorOptions) {
		super(message ?? 'Access token unavailable', options)
		this.name = 'AccessTokenUnavailableError'
	}
}

/**
 * Builds the Electric SQL sync URL for a given route path and sync version.
 *
 * @param syncOrigin - The base URL of the Electric sync server
 * @param syncVersion - The sync route version (1, 2, or 3)
 * @param routePath - The route path (e.g., '/sessions', '/tasks')
 * @returns The full URL for the Electric sync endpoint
 */
export function buildElectricSyncUrl(syncOrigin: string, syncVersion: SyncRouteVersion, routePath: string): string {
	const url = new URL(`${syncOrigin}/v${syncVersion}${routePath}`)
	return url.toString()
}
