import { describe, it } from '@effect/vitest'
import { DateTime, Effect, Redacted } from 'effect'
import { TestClock } from 'effect/testing'
import { decodeJwt, exportPKCS8, generateKeyPair, importPKCS8, jwtVerify } from 'jose'
import { expect } from 'vitest'

import { signGitHubAppJwt } from '../../src/effects/services/github/github.auth'

describe('GitHub app authentication', () => {
	it.effect('signs bounded RS256 app JWT claims from the Effect clock', () =>
		Effect.gen(function* () {
			const now = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-07-16T12:00:00.000Z'))
			yield* TestClock.setTime(now)
			const { privateKey, publicKey } = yield* Effect.promise(() =>
				generateKeyPair('RS256', { extractable: true }),
			)
			const signingKey = yield* Effect.promise(async () => importPKCS8(await exportPKCS8(privateKey), 'RS256'))

			const redactedJwt = yield* signGitHubAppJwt({ issuer: 'Iv1.test-client', signingKey })
			const jwt = Redacted.value(redactedJwt)
			const claims = decodeJwt(jwt)
			yield* Effect.promise(() =>
				jwtVerify(jwt, publicKey, {
					algorithms: ['RS256'],
					currentDate: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
				}),
			)

			expect(claims.iss).toBe('Iv1.test-client')
			expect(claims.iat).toBe(Math.floor(now / 1000) - 60)
			expect(claims.exp).toBe(claims.iat! + 9 * 60)
			expect(String(redactedJwt)).not.toContain(jwt)
		}),
	)
})
