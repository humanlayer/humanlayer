import { DaemonIdentity, type DaemonIdentity as DaemonIdentityClaims } from '@humanlayer/schemas/effect/daemon/identity'
import * as Sentry from '@sentry/bun'
import * as Schema from 'effect/Schema'
import { importPKCS8, SignJWT } from 'jose'

import logger from '@/logger'

import { getHostId } from './host-id'

const alg = 'RS256'

let DAEMON_IDENTITY: string | null = null

export function getDaemonIdentity(): string {
	if (!DAEMON_IDENTITY) {
		throw new Error('Daemon identity not loaded')
	}
	return DAEMON_IDENTITY
}

export type LoadedDaemonIdentity =
	| {
			readonly authenticationMode: 'authenticated'
			readonly token: string
			readonly hostId: string
			readonly identity: DaemonIdentityClaims
	  }
	| {
			readonly authenticationMode: 'skip-auth'
			readonly token: string
			readonly hostId: string
	  }

let cachedClaims: DaemonIdentityClaims | null = null

/**
 * Get the daemon identity claims (userId, organizationId, hostId).
 * Must be called after loadDaemonIdentity() has completed.
 * Returns null in skip-auth mode.
 */
export async function getDaemonIdentityClaims(): Promise<DaemonIdentityClaims | null> {
	if (cachedClaims) {
		return cachedClaims
	}

	// An injected or production token takes precedence over local credential-loading flags.
	const token = DAEMON_IDENTITY
	if (token) {
		try {
			const claimsPortion = token.split('.')[1]
			if (claimsPortion) {
				const claimsText = Buffer.from(claimsPortion, 'base64url').toString()
				cachedClaims = Schema.decodeUnknownSync(DaemonIdentity)(JSON.parse(claimsText))
				return cachedClaims
			}
		} catch (error) {
			logger.error({ error }, 'Failed to parse complete authenticated daemon identity claims')
			Sentry.captureException(error, { tags: { error_type: 'daemon_identity_claims_parse' } })
			throw error
		}
	}

	// Skip-auth mode returns null only when no authenticated token was injected.
	if (process.env.RIPTIDE_DAEMON_SKIP_AUTH === 'true') {
		return null
	}

	// Dev mode: read from environment variables only when no token was supplied.
	if (process.env.RIPTIDE_DAEMON_LOAD_CREDS) {
		const userId = process.env.RIPTIDE_DAEMON_USER_ID
		const organizationId = process.env.RIPTIDE_DAEMON_ORGANIZATION_ID
		const hostId = await getHostId()

		if (userId && organizationId) {
			cachedClaims = { userId, organizationId, hostId }
			return cachedClaims
		}
	}
	return null
}

async function createSignedDaemonToken(
	userId: string,
	organizationId: string,
	hostId: string,
	privateKeyPem: string,
): Promise<string> {
	const privateKey = await importPKCS8(privateKeyPem, alg)
	return await new SignJWT({ userId, organizationId, hostId, createdAt: Date.now() })
		.setProtectedHeader({ alg })
		.sign(privateKey)
}

/**
 * Load a PEM key from an environment variable value.
 * Supports two formats:
 * - Base64-encoded PEM string (for CI/production)
 * - File path starting with './', '/', or '~/' (for local development)
 */
async function loadKeyFromEnvValue(envValue: string): Promise<string> {
	const { file } = await import('bun')
	const { homedir } = await import('node:os')
	const { join, resolve } = await import('node:path')

	const isFilePath = envValue.startsWith('./') || envValue.startsWith('/') || envValue.startsWith('~/')

	if (isFilePath) {
		const normalizedPath = envValue.startsWith('~') ? join(homedir(), envValue.slice(1)) : envValue
		const absolutePath = normalizedPath.startsWith('/') ? normalizedPath : resolve(process.cwd(), normalizedPath)
		return await file(absolutePath).text()
	}

	// Otherwise, treat as base64-encoded PEM
	return Buffer.from(envValue, 'base64').toString('utf-8')
}

export async function loadDaemonIdentity(injectedToken: string | null = null): Promise<LoadedDaemonIdentity> {
	// Injected token path (CLI passes token directly)
	if (injectedToken) {
		DAEMON_IDENTITY = injectedToken
		cachedClaims = null
		// Debug: decode and log JWT payload
		const parts = injectedToken.split('.')
		if (parts[1]) {
			try {
				const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
				logger.debug({ jwtClaims: payload }, 'Daemon token JWT payload')
			} catch {
				logger.warn('Could not decode daemon token JWT payload')
			}
		}
		const claims = await getDaemonIdentityClaims()
		if (!claims) throw new Error('Injected daemon token did not contain a complete daemon identity')
		logger.info('Loaded daemon identity from injected token')
		return { authenticationMode: 'authenticated', token: injectedToken, hostId: claims.hostId, identity: claims }
	}

	// Test mode: skip auth entirely and return a dummy token
	if (process.env.RIPTIDE_DAEMON_SKIP_AUTH === 'true') {
		DAEMON_IDENTITY = 'test-token-skip-auth'
		cachedClaims = null
		logger.info('Daemon using skip-auth mode (test token)')
		const hostId = await getHostId()
		return { authenticationMode: 'skip-auth', token: DAEMON_IDENTITY, hostId }
	}

	// Dev mode: self-sign token
	if (process.env.RIPTIDE_DAEMON_LOAD_CREDS) {
		const userId = process.env.RIPTIDE_DAEMON_USER_ID
		const organizationId = process.env.RIPTIDE_DAEMON_ORGANIZATION_ID
		const privateKeyEnv = process.env.RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY

		if (!userId || !organizationId || !privateKeyEnv) {
			throw new Error(
				'Dev mode requires RIPTIDE_DAEMON_USER_ID, RIPTIDE_DAEMON_ORGANIZATION_ID, and RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY',
			)
		}

		const privateKeyPem = await loadKeyFromEnvValue(privateKeyEnv)
		const hostId = await getHostId()

		DAEMON_IDENTITY = await createSignedDaemonToken(userId, organizationId, hostId, privateKeyPem)
		cachedClaims = null
		logger.info('Daemon created own DAEMON_IDENTITY (dev mode)')

		const claims = await getDaemonIdentityClaims()
		if (!claims) throw new Error('Self-signed daemon token did not contain a complete daemon identity')
		return { authenticationMode: 'authenticated', token: DAEMON_IDENTITY, hostId: claims.hostId, identity: claims }
	}

	// Production mode: read from DAEMON_IDENTITY environment variable
	// (set by Tauri when spawning the daemon process)
	const token = process.env.DAEMON_IDENTITY
	if (!token) {
		throw new Error('DAEMON_IDENTITY environment variable not set')
	}

	DAEMON_IDENTITY = token
	cachedClaims = null
	logger.info('Loaded DAEMON_IDENTITY from environment variable')

	const claims = await getDaemonIdentityClaims()
	if (!claims) throw new Error('DAEMON_IDENTITY did not contain a complete daemon identity')
	logger.info('Booting daemon with identity claims:', claims)

	return { authenticationMode: 'authenticated', token: DAEMON_IDENTITY, hostId: claims.hostId, identity: claims }
}
