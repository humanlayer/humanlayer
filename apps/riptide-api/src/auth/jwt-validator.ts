import { parseWorkOsAccessTokenClaims } from '@humanlayer/schemas/effect/workos-access-token'
import * as Sentry from '@sentry/node'
import { jwtVerify } from 'jose'

import { logger } from '../logger'
import { isExpiredJwtError } from './expired-jwt'
import { jwksCache } from './jwks-cache'

export interface AuthContext {
	userId: string
	organizationId: string
	workosOrganizationId: string
	role: string
	roles: string[]
	permissions: string[]
	entitlements: string[]
	sessionId?: string
	actingUser?: string
}

export interface AuthContextOptionalOrg {
	userId: string
	organizationId?: string
	workosOrganizationId?: string
	role: string
	roles: string[]
	permissions: string[]
	entitlements: string[]
	sessionId?: string
	actingUser?: string
}

export async function validateJWT(token: string): Promise<AuthContextOptionalOrg | null> {
	try {
		// Parse JWT header to get kid
		const parts = token.split('.')
		if (parts.length !== 3) {
			logger.warn('Invalid JWT format')
			return null
		}

		const [headerB64, payloadB64] = parts
		if (!headerB64 || !payloadB64) {
			logger.warn('Invalid JWT format')
			return null
		}

		const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
		const kid = header.kid

		if (!kid) {
			logger.warn('JWT missing kid header')
			return null
		}

		// Get imported key from cache, force refresh once if not found
		let key = jwksCache.getKey(kid)
		if (!key) {
			logger.info({ kid }, 'Key not found for kid, forcing refresh')
			await jwksCache.forceRefresh()
			key = jwksCache.getKey(kid)
			if (!key) {
				logger.warn({ kid }, 'Key not found for kid after refresh')
				return null
			}
		}

		// Decode payload to get issuer
		const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
		const issuer = payload.iss

		if (!issuer) {
			logger.warn('JWT missing issuer claim')
			return null
		}

		// Verify with the issuer from the token
		const { payload: verifiedPayload } = await jwtVerify(token, key, {
			issuer,
		})

		const claims = parseWorkOsAccessTokenClaims(verifiedPayload)

		// Convert to auth context - org fields now optional
		return {
			userId: claims.sub,
			organizationId: claims.internal_org_id || undefined, // undefined if empty/missing
			workosOrganizationId: claims.org_id || undefined, // undefined if empty/missing
			role: claims.role ?? '',
			roles: claims.roles ?? [],
			permissions: claims.permissions ?? [],
			entitlements: claims.entitlements ?? [],
			sessionId: claims.sid,
			actingUser: claims.act?.sub,
		}
	} catch (error) {
		// Expired tokens are expected (clients re-auth); don't report them to Sentry.
		if (!isExpiredJwtError(error)) {
			Sentry.captureException(error, {
				tags: { error_type: 'jwt_validation' },
			})
		}
		logger.warn(error, 'JWT validation failed')
		return null
	}
}
