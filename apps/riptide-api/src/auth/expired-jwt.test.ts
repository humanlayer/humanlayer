import { SignJWT, jwtVerify } from 'jose'
import { describe, expect, test } from 'vitest'

import { isExpiredJwtError } from './expired-jwt'

describe('isExpiredJwtError', () => {
	test('true for jose JWTExpired thrown by jwtVerify (pins jose contract)', async () => {
		// HS256 keeps this fast (no RSA keygen). Sign a token whose exp is in the past,
		// then verify it — jose throws JWTExpired with code ERR_JWT_EXPIRED.
		const secret = new TextEncoder().encode('test-secret-that-is-at-least-32-bytes!!')
		const pastExp = Math.floor(Date.now() / 1000) - 3600
		const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(pastExp).sign(secret)

		expect.assertions(2)
		try {
			await jwtVerify(token, secret)
		} catch (error) {
			expect((error as { code?: string }).code).toBe('ERR_JWT_EXPIRED')
			expect(isExpiredJwtError(error)).toBe(true)
		}
	})

	test('true when only the message matches (minified class name fallback)', () => {
		expect(isExpiredJwtError(new Error('"exp" claim timestamp check failed'))).toBe(true)
	})

	test('true for a bare object carrying the jose code', () => {
		expect(isExpiredJwtError({ code: 'ERR_JWT_EXPIRED' })).toBe(true)
	})

	test('false for other JWT / generic errors', () => {
		expect(isExpiredJwtError(new Error('JWSSignatureVerificationFailed'))).toBe(false)
		expect(isExpiredJwtError({ code: 'ERR_JWT_INVALID' })).toBe(false)
		expect(isExpiredJwtError(new Error('boom'))).toBe(false)
	})

	test('false for non-error values', () => {
		expect(isExpiredJwtError(null)).toBe(false)
		expect(isExpiredJwtError(undefined)).toBe(false)
		expect(isExpiredJwtError('"exp" claim timestamp check failed')).toBe(false)
	})
})
