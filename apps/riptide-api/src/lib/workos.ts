import { WorkOS } from '@workos-inc/node'

import { requireEnvironment } from './environment'

// Lazy-loaded values (loaded on first use to avoid requiring env vars at module load)
let _workosApiKey: string | null = null
let _workosClientId: string | null = null
let _workosRedirectUri: string | null = null
let _workos: WorkOS | null = null
let _jwksUrl: string | null = null

// Export getters for environment variables
export function getWorkosApiKey(): string {
	if (!_workosApiKey) {
		_workosApiKey = requireEnvironment('WORKOS_API_KEY')
	}
	return _workosApiKey
}

export function getWorkosClientId(): string {
	if (!_workosClientId) {
		_workosClientId = requireEnvironment('WORKOS_CLIENT_ID')
	}
	return _workosClientId
}

export function getWorkosRedirectUri(): string {
	if (!_workosRedirectUri) {
		_workosRedirectUri = requireEnvironment('WORKOS_REDIRECT_URI')
	}
	return _workosRedirectUri
}

// Export getter for singleton WorkOS client
export function getWorkos(): WorkOS {
	if (!_workos) {
		_workos = new WorkOS(getWorkosApiKey())
	}
	return _workos
}

// Export getter for JWKS URL
export function getJwksUrl(): string {
	if (!_jwksUrl) {
		_jwksUrl = getWorkos().userManagement.getJwksUrl(getWorkosClientId())
	}
	return _jwksUrl
}
