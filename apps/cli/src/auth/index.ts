import type { EnvironmentConfig, EnvironmentName } from '../lib/macros'
import { createUnauthenticatedApiORPCClient } from '../orpc/client'
import { isSessionExpired, loadSession, saveSession, type WorkOSSession } from './storage'
import { pollForToken, requestDeviceCodes } from './workos-device-auth'

interface ResolveWorkOSTokenDeps {
	load: typeof loadSession
	save: typeof saveSession
	refresh: typeof refreshWorkOSToken
}

/**
 * Resolve a WorkOS access token for API calls.
 * Priority: stored session → refresh expired session → error.
 * Run `humanlayer login` to create a stored session via device auth.
 */
export async function resolveWorkOSToken(
	envName: EnvironmentName,
	envConfig: EnvironmentConfig,
): Promise<WorkOSSession> {
	return resolveWorkOSTokenWithDeps(envName, envConfig, {
		load: loadSession,
		save: saveSession,
		refresh: refreshWorkOSToken,
	})
}

export async function resolveWorkOSTokenWithDeps(
	envName: EnvironmentName,
	envConfig: EnvironmentConfig,
	deps: ResolveWorkOSTokenDeps,
): Promise<WorkOSSession> {
	// 1. Try stored session
	let stored = await deps.load(envName)
	if (stored && !isSessionExpired(stored)) {
		return stored
	}

	// 2. If stored but expired, attempt refresh
	if (stored?.refresh_token) {
		try {
			const refreshed = await deps.refresh(envConfig.apiOrigin, stored.refresh_token)
			const session: WorkOSSession = {
				access_token: refreshed.accessToken,
				refresh_token: refreshed.refreshToken,
				expires_at: Date.now() + 60 * 60 * 1000,
				user_id: stored.user_id,
				organization_id: stored.organization_id,
			}
			await deps.save(envName, session)
			return session
		} catch {
			stored = await deps.load(envName)
			if (stored && !isSessionExpired(stored)) return stored
		}
	}

	throw new Error('Not logged in. Run `humanlayer login` first, or pass --token.')
}

export async function refreshWorkOSToken(apiOrigin: string, refreshToken: string) {
	const apiClient = createUnauthenticatedApiORPCClient(apiOrigin)
	return apiClient.auth.token.refresh({ refreshToken })
}

/**
 * Run the interactive WorkOS device authorization flow.
 * WorkOS shows an org picker in the browser for multi-org users.
 */
export async function performDeviceAuth(
	envName: EnvironmentName,
	envConfig: EnvironmentConfig,
): Promise<WorkOSSession> {
	const codes = await requestDeviceCodes(envConfig.workosClientId)

	console.log()
	console.log('  Open this URL to authenticate:')
	console.log()
	console.log(`    ${codes.verification_uri_complete}`)
	console.log()
	console.log(`  Or visit ${codes.verification_uri} and enter code: ${codes.user_code}`)
	console.log()
	console.log('  Waiting for authentication...')

	const result = await pollForToken(envConfig.workosClientId, codes.device_code, codes.interval)

	const session: WorkOSSession = {
		access_token: result.access_token,
		refresh_token: result.refresh_token,
		expires_at: Date.now() + 60 * 60 * 1000,
		user_id: result.user.id,
		organization_id: result.organization_id,
	}
	await saveSession(envName, session)

	console.log(`  Authenticated as ${result.user.email}`)
	console.log()

	return session
}
