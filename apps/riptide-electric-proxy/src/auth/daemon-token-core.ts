import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { importSPKI, jwtVerify } from 'jose'

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
 *   RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=LS0tLS1CRUdJTi4uLg==  (base64)
 *   RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=./keys/public.pem     (relative path)
 *   RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=/etc/keys/public.pem  (absolute path)
 *   RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY=~/keys/public.pem     (home dir path)
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

export interface DaemonTokenClaims {
	userId: string
	organizationId: string
	hostId: string
	createdAt: number
}

const PersistentDaemonTokenPayload = Schema.Struct({
	type: Schema.optionalKey(Schema.Undefined),
	userId: Schema.String,
	organizationId: Schema.String,
	hostId: Schema.String,
	createdAt: Schema.Number,
})

export function parseDaemonTokenClaims(payload: unknown): DaemonTokenClaims | null {
	return Option.getOrNull(Schema.decodeUnknownOption(PersistentDaemonTokenPayload)(payload))
}

/**
 * Verify and decode a daemon token using the provided public key PEM.
 * This is a pure function - no side effects, no env var access.
 * Returns null if token is invalid or claims are malformed.
 *
 * Note: This module intentionally does NOT include signing functions.
 * The electric proxy should only be able to validate tokens, not create them.
 */
export async function verifyDaemonToken(publicKeyPem: string, token: string): Promise<DaemonTokenClaims | null> {
	try {
		const publicKey = await importSPKI(publicKeyPem, ALG)
		const { payload } = await jwtVerify(token, publicKey)
		return parseDaemonTokenClaims(payload)
	} catch {
		return null
	}
}
