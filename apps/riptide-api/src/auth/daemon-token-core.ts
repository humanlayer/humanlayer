import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import * as Sentry from '@sentry/node'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose'

import { logger } from '../logger'
import { isExpiredJwtError } from './expired-jwt'

const ALG = 'RS256'

/**
 * Normalize a path to handle the user home dir if specified
 */
function normalizePath(filePath: string): string {
	return filePath.startsWith('~') ? join(homedir(), filePath.slice(1)) : filePath
}

/**
 * Check if a value looks like a file path
 */
function isFilePath(value: string): boolean {
	return value.startsWith('./') || value.startsWith('/') || value.startsWith('~/')
}

/**
 * Load a PEM key from an environment variable value.
 * Supports two formats:
 * - Base64-encoded PEM string (for CI/production)
 * - File path starting with './', '/', or '~/' (for local development)
 *
 * Examples:
 *   RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=LS0tLS1CRUdJTi4uLg==  (base64)
 *   RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=./keys/private.pem    (relative path)
 *   RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=/etc/keys/private.pem (absolute path)
 *   RIPTIDE_DAEMON_TOKEN_PRIVATE_KEY=~/keys/private.pem    (home dir path)
 */
export function loadKeyFromEnvValue(envValue: string): string {
	if (isFilePath(envValue)) {
		const normalizedPath = normalizePath(envValue)
		const absolutePath = normalizedPath.startsWith('/') ? normalizedPath : resolve(process.cwd(), normalizedPath)
		return readFileSync(absolutePath, 'utf-8')
	}

	// Otherwise, treat as base64-encoded PEM
	return Buffer.from(envValue, 'base64').toString('utf-8')
}

export const DaemonTokenClaims = Schema.Struct({
	type: Schema.optionalKey(Schema.Undefined),
	userId: Schema.String,
	organizationId: Schema.String,
	hostId: Schema.String,
	createdAt: Schema.Number,
})
export interface DaemonTokenClaims extends Schema.Schema.Type<typeof DaemonTokenClaims> {}

export function parseDaemonTokenClaims(payload: unknown): DaemonTokenClaims | null {
	return Option.getOrNull(Schema.decodeUnknownOption(DaemonTokenClaims)(payload))
}

/**
 * Create a signed daemon token using the provided private key PEM.
 * This is a pure function - no side effects, no env var access.
 */
export async function signDaemonToken(
	privateKeyPem: string,
	userId: string,
	organizationId: string,
	hostId: string,
	createdAt: number = Date.now(),
): Promise<string> {
	const privateKey = await importPKCS8(privateKeyPem, ALG)
	return await new SignJWT({ userId, organizationId, hostId, createdAt })
		.setProtectedHeader({ alg: ALG })
		.sign(privateKey)
}

/**
 * Verify and decode a daemon token using the provided public key PEM.
 * This is a pure function - no side effects, no env var access.
 * Returns null if token is invalid or claims are malformed.
 */
export async function verifyDaemonToken(publicKeyPem: string, token: string): Promise<DaemonTokenClaims | null> {
	try {
		const publicKey = await importSPKI(publicKeyPem, ALG)
		const { payload } = await jwtVerify(token, publicKey)
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

export interface LaunchTokenClaims {
	type: 'launch'
	userId: string
	organizationId: string
}

/**
 * Create a signed launch token using the provided private key PEM.
 * Launch tokens have a 24-hour expiry and no hostId.
 * This is a pure function - no side effects, no env var access.
 */
export async function signLaunchToken(privateKeyPem: string, userId: string, organizationId: string): Promise<string> {
	const privateKey = await importPKCS8(privateKeyPem, ALG)
	return await new SignJWT({ type: 'launch' as const, userId, organizationId })
		.setProtectedHeader({ alg: ALG })
		.setExpirationTime('24h')
		.sign(privateKey)
}

/**
 * Verify and decode a launch token using the provided public key PEM.
 * This is a pure function - no side effects, no env var access.
 * Returns null if token is invalid, expired, or claims are malformed.
 */
export async function verifyLaunchToken(publicKeyPem: string, token: string): Promise<LaunchTokenClaims | null> {
	try {
		const publicKey = await importSPKI(publicKeyPem, ALG)
		const verified = await jwtVerify(token, publicKey)
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

/**
 * Decode a token without verification (for debugging/inspection only).
 * WARNING: Do not use this for authorization - always use verifyDaemonToken.
 */
export function decodeDaemonTokenUnsafe(token: string): DaemonTokenClaims | null {
	try {
		const parts = token.split('.')
		if (parts.length !== 3) return null

		const payloadPart = parts[1]
		if (!payloadPart) return null

		const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8'))

		if (
			payload.type === undefined &&
			typeof payload.userId === 'string' &&
			typeof payload.organizationId === 'string' &&
			typeof payload.hostId === 'string' &&
			typeof payload.createdAt === 'number'
		) {
			return {
				userId: payload.userId,
				organizationId: payload.organizationId,
				hostId: payload.hostId,
				createdAt: payload.createdAt,
			}
		}
		return null
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'daemon_token_decode' },
		})
		logger.error(error, 'Error decoding daemon token')
		return null
	}
}
