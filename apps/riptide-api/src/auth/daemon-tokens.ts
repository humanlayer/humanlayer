import * as Sentry from '@sentry/node'
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose'

import { requireEnvironment } from '../lib/environment'
import { logger } from '../logger'
import {
	type DaemonTokenClaims,
	type LaunchTokenClaims,
	loadKeyFromEnvValue,
	parseDaemonTokenClaims,
} from './daemon-token-core'
import { isExpiredJwtError } from './expired-jwt'

const ALG = 'RS256'

// Lazy-loaded PEM strings (loaded on first use to avoid requiring env vars at module load)
let privateKeyPem: string | null = null
let publicKeyPem: string | null = null

// Lazy-loaded CryptoKey objects (imported once, reused forever)
let privateKey: CryptoKey | null = null
let publicKey: CryptoKey | null = null

function getPrivateKeyPem(): string {
	if (!privateKeyPem) {
		privateKeyPem = loadKeyFromEnvValue(requireEnvironment('RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY'))
	}
	return privateKeyPem
}

function getPublicKeyPem(): string {
	if (!publicKeyPem) {
		publicKeyPem = loadKeyFromEnvValue(requireEnvironment('RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY'))
	}
	return publicKeyPem
}

async function getPrivateKey(): Promise<CryptoKey> {
	if (!privateKey) {
		privateKey = await importPKCS8(getPrivateKeyPem(), ALG)
	}
	return privateKey
}

async function getPublicKey(): Promise<CryptoKey> {
	if (!publicKey) {
		publicKey = await importSPKI(getPublicKeyPem(), ALG)
	}
	return publicKey
}

/**
 * Create a signed daemon token using env-configured private key.
 * Key is imported once and cached for subsequent calls.
 */
export async function createSignedDaemonToken(
	userId: string,
	organizationId: string,
	hostId: string,
	createdAt: number = Date.now(),
): Promise<string> {
	const key = await getPrivateKey()
	return await new SignJWT({ userId, organizationId, hostId, createdAt }).setProtectedHeader({ alg: ALG }).sign(key)
}

/**
 * Validate a daemon token using env-configured public key.
 * Key is imported once and cached for subsequent calls.
 */
export async function validateDaemonToken(token: string): Promise<DaemonTokenClaims | null> {
	try {
		const key = await getPublicKey()
		const { payload } = await jwtVerify(token, key)
		return parseDaemonTokenClaims(payload)
	} catch (error) {
		// Expired tokens are expected (clients re-auth); don't report them to Sentry.
		if (!isExpiredJwtError(error)) {
			Sentry.captureException(error, {
				tags: { error_type: 'daemon_token' },
			})
		}
		logger.error(error, 'Error verifying daemon token')
		return null
	}
}

/**
 * Create a signed launch token using env-configured private key.
 * Launch tokens are scoped to (user, organization) with 24h expiry — no hostId.
 */
export async function createSignedLaunchToken(userId: string, organizationId: string): Promise<string> {
	const key = await getPrivateKey()
	return await new SignJWT({ type: 'launch' as const, userId, organizationId })
		.setProtectedHeader({ alg: ALG })
		.setExpirationTime('24h')
		.sign(key)
}

/**
 * Validate a launch token using env-configured public key.
 * Returns claims if valid, null if invalid or expired.
 */
export async function validateLaunchToken(token: string): Promise<LaunchTokenClaims | null> {
	try {
		const key = await getPublicKey()
		const verified = await jwtVerify(token, key)
		const payload = verified.payload

		if (
			payload.type === 'launch' &&
			typeof payload.userId === 'string' &&
			typeof payload.organizationId === 'string'
		) {
			return {
				type: 'launch',
				userId: payload.userId,
				organizationId: payload.organizationId,
			}
		}
		return null
	} catch (error) {
		// Expired tokens are expected (clients re-auth); don't report them to Sentry.
		if (!isExpiredJwtError(error)) {
			Sentry.captureException(error, {
				tags: { error_type: 'launch_token' },
			})
		}
		logger.error(error, 'Error verifying launch token')
		return null
	}
}

// Re-export types for convenience
export type { DaemonTokenClaims }
export type { LaunchTokenClaims }
