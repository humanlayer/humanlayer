import {
	parseWorkOsAccessTokenClaims,
	type WorkOsAccessTokenClaims,
} from '@humanlayer/schemas/effect/workos-access-token'
import { Context, Effect, Layer } from 'effect'
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose'

import {
	type JWKSKeyNotFoundError,
	type JWKSNotReadyError,
	JWTMalformedError,
	JWTMissingInternalOrgIdError,
	JWTMissingIssuerError,
	JWTMissingKidError,
	JWTVerificationError,
} from './errors'
import { JWKSCache } from './jwks-cache.service'

export interface AuthContext {
	userId: string
	organizationId: string
	workosOrganizationId: string
	roles: string[]
	permissions: string[]
	entitlements: string[]
	sessionId: string
	actingUser?: string
}

export type JWTValidationError =
	| JWTMalformedError
	| JWTMissingKidError
	| JWTMissingIssuerError
	| JWTVerificationError
	| JWTMissingInternalOrgIdError
	| JWKSNotReadyError
	| JWKSKeyNotFoundError

export class JWTValidator extends Context.Service<
	JWTValidator,
	{
		validateJWT: (token: string) => Effect.Effect<AuthContext, JWTValidationError>
	}
>()('JWTValidator') {}

const parseProtectedKid = (token: string) =>
	Effect.try({
		try: () => decodeProtectedHeader(token),
		catch: (error) => new JWTMalformedError({ cause: String(error) }),
	}).pipe(
		Effect.flatMap((header) => {
			if (!header.kid) return Effect.fail(new JWTMissingKidError())
			return Effect.succeed(header.kid)
		}),
	)

const parseIssuer = (token: string) =>
	Effect.try({
		try: () => decodeJwt(token),
		catch: (error) => new JWTMalformedError({ cause: String(error) }),
	}).pipe(
		Effect.flatMap((payload) => {
			if (!payload.iss) return Effect.fail(new JWTMissingIssuerError())
			return Effect.succeed(payload.iss)
		}),
	)

const claimsToAuthContext = (claims: WorkOsAccessTokenClaims) => {
	if (!claims.internal_org_id) {
		return Effect.fail(new JWTMissingInternalOrgIdError({ workosOrganizationId: claims.org_id }))
	}

	return Effect.succeed({
		userId: claims.sub,
		organizationId: claims.internal_org_id,
		workosOrganizationId: claims.org_id ?? '',
		roles: claims.roles ?? [],
		permissions: claims.permissions ?? [],
		entitlements: claims.entitlements ?? [],
		sessionId: claims.sid,
		actingUser: claims.act?.sub,
	})
}

export const JWTValidatorLive = Layer.effect(
	JWTValidator,
	Effect.gen(function* () {
		const jwksCache = yield* JWKSCache

		return {
			validateJWT: (token: string) =>
				Effect.gen(function* () {
					const kid = yield* parseProtectedKid(token)
					const issuer = yield* parseIssuer(token)

					// Try to get key, if not found force refresh and retry once
					const key = yield* jwksCache.getKey(kid).pipe(
						Effect.catchTag('JWKSKeyNotFoundError', () =>
							jwksCache.forceRefresh.pipe(
								Effect.catch(() => Effect.void), // Ignore refresh errors, will retry getKey anyway
								Effect.flatMap(() => jwksCache.getKey(kid)),
							),
						),
					)

					const { payload } = yield* Effect.tryPromise({
						try: () => jwtVerify(token, key, { issuer }),
						catch: (error) => new JWTVerificationError({ cause: String(error) }),
					})

					const claims = yield* Effect.try({
						try: () => parseWorkOsAccessTokenClaims(payload),
						catch: (error) =>
							new JWTVerificationError({
								cause: error instanceof Error ? error.message : 'JWT claims schema validation failed',
							}),
					})

					return yield* claimsToAuthContext(claims)
				}),
		}
	}),
)
