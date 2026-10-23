import { requireEnvironment } from './environment'

// Lazy-loaded values (loaded on first use to avoid requiring env vars at module load)
let _linearClientId: string | null = null
let _linearClientSecret: string | null = null

export function getLinearClientId(): string {
	if (!_linearClientId) {
		_linearClientId = requireEnvironment('LINEAR_CLIENT_ID')
	}
	return _linearClientId
}

export function getLinearClientSecret(): string {
	if (!_linearClientSecret) {
		_linearClientSecret = requireEnvironment('LINEAR_CLIENT_SECRET')
	}
	return _linearClientSecret
}

/**
 * The OAuth redirect URI is owned by the API, not supplied by the browser. It defaults to
 * `${RIPTIDE_API_ORIGIN}/integrations/linear/callback` (mirroring
 * `slackOAuthRedirectUrlFromApiOrigin`) and is overridable via `LINEAR_OAUTH_REDIRECT_URL`
 * for environments whose API origin does not match the URI registered with Linear.
 */
export function getLinearOAuthRedirectUrl(): string {
	const override = process.env.LINEAR_OAUTH_REDIRECT_URL
	if (override) return override

	const apiOrigin = requireEnvironment(
		'RIPTIDE_API_ORIGIN',
		process.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN ?? 'http://localhost:8700',
	)
	const url = new URL(apiOrigin)
	url.pathname = '/integrations/linear/callback'
	url.search = ''
	url.hash = ''
	return url.toString()
}
