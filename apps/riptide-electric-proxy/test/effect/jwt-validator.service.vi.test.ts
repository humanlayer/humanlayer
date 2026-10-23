import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Layer } from 'effect'
import { generateKeyPair, SignJWT } from 'jose'

import {
	JWKSKeyNotFoundError,
	JWTMalformedError,
	JWTMissingInternalOrgIdError,
	JWTMissingIssuerError,
	JWTMissingKidError,
	JWTVerificationError,
} from '../../src/auth/effect/errors'
import { JWKSCache } from '../../src/auth/effect/jwks-cache.service'
import { JWTValidator, JWTValidatorLive } from '../../src/auth/effect/jwt-validator.service'

async function makeToken(privateKey: CryptoKey, kid: string, claims: Record<string, unknown> = {}) {
	return new SignJWT({
		sub: 'user_123',
		org_id: 'org_123',
		internal_org_id: 'internal-org-123',
		role: 'admin',
		roles: ['admin'],
		permissions: ['tasks:read'],
		entitlements: [],
		sid: 'session_123',
		jti: 'jti_123',
		...claims,
	})
		.setProtectedHeader({ alg: 'RS256', kid })
		.setIssuer('https://api.workos.test')
		.setIssuedAt()
		.setExpirationTime('5 minutes')
		.sign(privateKey)
}

function firstFailure(exit: Exit.Exit<unknown, unknown>) {
	if (Exit.isSuccess(exit)) return undefined
	return Array.from(exit.cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error))[0]
}

describe('JWTValidator', () => {
	it.effect('validates a signed JWT with a cached key', ({ expect }) =>
		Effect.gen(function* () {
			const kid = 'test-kid'
			const { publicKey, privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() => makeToken(privateKey, kid))

			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: (requestedKid) =>
					requestedKid === kid
						? Effect.succeed(publicKey)
						: Effect.fail(new JWKSKeyNotFoundError({ kid: requestedKid })),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})

			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const authContext = yield* validator.validateJWT(token)

			expect(authContext).toEqual({
				userId: 'user_123',
				organizationId: 'internal-org-123',
				workosOrganizationId: 'org_123',
				roles: ['admin'],
				permissions: ['tasks:read'],
				entitlements: [],
				sessionId: 'session_123',
				actingUser: undefined,
			})
		}),
	)

	it.effect('accepts a token without optional WorkOS authorization claims', ({ expect }) =>
		Effect.gen(function* () {
			const kid = 'test-kid'
			const { publicKey, privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() =>
				makeToken(privateKey, kid, {
					org_id: undefined,
					role: undefined,
					roles: undefined,
					permissions: undefined,
					entitlements: undefined,
				}),
			)

			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.succeed(publicKey),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))

			expect(yield* validator.validateJWT(token)).toEqual({
				userId: 'user_123',
				organizationId: 'internal-org-123',
				workosOrganizationId: '',
				roles: [],
				permissions: [],
				entitlements: [],
				sessionId: 'session_123',
				actingUser: undefined,
			})
		}),
	)

	it.effect('fails when token is malformed', ({ expect }) =>
		Effect.gen(function* () {
			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.fail(new JWKSKeyNotFoundError({ kid: 'unused' })),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const exit = yield* Effect.exit(validator.validateJWT('not-a-jwt'))

			expect(firstFailure(exit)).toBeInstanceOf(JWTMalformedError)
		}),
	)

	it.effect('fails when kid is missing', ({ expect }) =>
		Effect.gen(function* () {
			const { publicKey, privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() =>
				new SignJWT({ sub: 'user_123' })
					.setProtectedHeader({ alg: 'RS256' })
					.setIssuer('https://api.workos.test')
					.sign(privateKey),
			)
			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.succeed(publicKey),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const exit = yield* Effect.exit(validator.validateJWT(token))

			expect(firstFailure(exit)).toBeInstanceOf(JWTMissingKidError)
		}),
	)

	it.effect('fails when issuer is missing', ({ expect }) =>
		Effect.gen(function* () {
			const kid = 'test-kid'
			const { publicKey, privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() =>
				new SignJWT({ sub: 'user_123' }).setProtectedHeader({ alg: 'RS256', kid }).sign(privateKey),
			)
			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.succeed(publicKey),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const exit = yield* Effect.exit(validator.validateJWT(token))

			expect(firstFailure(exit)).toBeInstanceOf(JWTMissingIssuerError)
		}),
	)

	it.effect('fails when signature does not match cached key', ({ expect }) =>
		Effect.gen(function* () {
			const kid = 'test-kid'
			const { privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const { publicKey: wrongPublicKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() => makeToken(privateKey, kid))
			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.succeed(wrongPublicKey),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const exit = yield* Effect.exit(validator.validateJWT(token))

			expect(firstFailure(exit)).toBeInstanceOf(JWTVerificationError)
		}),
	)

	it.effect('fails when internal_org_id is empty', ({ expect }) =>
		Effect.gen(function* () {
			const kid = 'test-kid'
			const { publicKey, privateKey } = yield* Effect.promise(() => generateKeyPair('RS256'))
			const token = yield* Effect.promise(() => makeToken(privateKey, kid, { internal_org_id: '' }))
			const JWKSCacheTest = Layer.succeed(JWKSCache, {
				getKey: () => Effect.succeed(publicKey),
				isReady: Effect.succeed(true),
				forceRefresh: Effect.void,
			})
			const validator = yield* JWTValidator.pipe(Effect.provide(JWTValidatorLive), Effect.provide(JWKSCacheTest))
			const exit = yield* Effect.exit(validator.validateJWT(token))

			expect(firstFailure(exit)).toBeInstanceOf(JWTMissingInternalOrgIdError)
		}),
	)
})
