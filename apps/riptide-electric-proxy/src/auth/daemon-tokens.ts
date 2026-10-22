import { importSPKI, jwtVerify } from 'jose'

import { requireEnvironment } from '../lib/utils'
import { type DaemonTokenClaims, loadKeyFromEnvValue, parseDaemonTokenClaims } from './daemon-token-core'

const ALG = 'RS256'

// Lazy-loaded PEM string (loaded on first use to avoid requiring env vars at module load)
let publicKeyPem: string | null = null

// Lazy-loaded CryptoKey object (imported once, reused forever)
let publicKey: CryptoKey | null = null

function getPublicKeyPem(): string {
	if (!publicKeyPem) {
		publicKeyPem = loadKeyFromEnvValue(requireEnvironment('RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY'))
	}
	return publicKeyPem
}

async function getPublicKey(): Promise<CryptoKey> {
	if (!publicKey) {
		publicKey = await importSPKI(getPublicKeyPem(), ALG)
	}
	return publicKey
}

/**
 * Validate a daemon token using env-configured public key.
 * Key is imported once and cached for subsequent calls.
 * Note: This module intentionally does NOT export a sign function.
 */
export async function validateDaemonToken(token: string): Promise<DaemonTokenClaims | null> {
	try {
		const key = await getPublicKey()
		const { payload } = await jwtVerify(token, key)
		return parseDaemonTokenClaims(payload)
	} catch {
		return null
	}
}

// Re-export types for convenience
export type { DaemonTokenClaims }
