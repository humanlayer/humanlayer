import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { importPKCS8, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	decodeDaemonTokenUnsafe,
	loadKeyFromEnvValue,
	signDaemonToken,
	signLaunchToken,
	verifyDaemonToken,
	verifyLaunchToken,
} from './daemon-token-core'

// Generate ephemeral test keys using Web Crypto API
let privateKey: string
let publicKey: string

beforeAll(async () => {
	const keyPair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify'],
	)

	const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
	const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey)

	privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateKeyBuffer).toString('base64')}\n-----END PRIVATE KEY-----`
	publicKey = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(publicKeyBuffer).toString('base64')}\n-----END PUBLIC KEY-----`
})

describe('daemon-token-core', () => {
	describe('signDaemonToken', () => {
		test('creates a valid JWT with three parts', async () => {
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789')

			expect(token).toBeDefined()
			expect(typeof token).toBe('string')
			expect(token.split('.')).toHaveLength(3)
		})

		test('accepts custom createdAt timestamp', async () => {
			const customTime = 1700000000000
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789', customTime)

			const claims = await verifyDaemonToken(publicKey, token)
			expect(claims?.createdAt).toBe(customTime)
		})

		test('uses current timestamp when createdAt is not provided', async () => {
			const before = Date.now()
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789')
			const after = Date.now()

			const claims = await verifyDaemonToken(publicKey, token)
			expect(claims?.createdAt).toBeGreaterThanOrEqual(before)
			expect(claims?.createdAt).toBeLessThanOrEqual(after)
		})
	})

	describe('verifyDaemonToken', () => {
		test('verifies and returns claims for valid token', async () => {
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789')

			const claims = await verifyDaemonToken(publicKey, token)

			expect(claims).not.toBeNull()
			expect(claims!.userId).toBe('user-123')
			expect(claims!.organizationId).toBe('org-456')
			expect(claims!.hostId).toBe('host-789')
			expect(claims!.createdAt).toBeGreaterThan(0)
		})

		test('returns null for invalid token string', async () => {
			const result = await verifyDaemonToken(publicKey, 'not-a-jwt')
			expect(result).toBeNull()
		})

		test('returns null for empty token string', async () => {
			const result = await verifyDaemonToken(publicKey, '')
			expect(result).toBeNull()
		})

		test('returns null for tampered payload', async () => {
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789')

			// Tamper with the payload
			const parts = token.split('.')
			const payloadPart = parts[1]!
			const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString())
			payload.userId = 'hacked-user'
			parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')
			const tamperedToken = parts.join('.')

			const result = await verifyDaemonToken(publicKey, tamperedToken)
			expect(result).toBeNull()
		})

		test('returns null for token signed with different key', async () => {
			// Generate a different key pair
			const otherKeyPair = await crypto.subtle.generateKey(
				{
					name: 'RSASSA-PKCS1-v1_5',
					modulusLength: 2048,
					publicExponent: new Uint8Array([1, 0, 1]),
					hash: 'SHA-256',
				},
				true,
				['sign', 'verify'],
			)
			const otherPrivate = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey)
			const otherPrivateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(otherPrivate).toString('base64')}\n-----END PRIVATE KEY-----`

			const token = await signDaemonToken(otherPrivateKey, 'user', 'org', 'host')
			const result = await verifyDaemonToken(publicKey, token)

			expect(result).toBeNull()
		})

		test('returns null for token with missing required claims', async () => {
			// Create a token with missing claims by using jose directly
			const key = await importPKCS8(privateKey, 'RS256')

			// Token with only userId (missing organizationId, hostId, createdAt)
			const incompleteToken = await new SignJWT({ userId: 'user-123' })
				.setProtectedHeader({ alg: 'RS256' })
				.sign(key)

			const result = await verifyDaemonToken(publicKey, incompleteToken)
			expect(result).toBeNull()
		})

		test('returns null for token with wrong claim types', async () => {
			const key = await importPKCS8(privateKey, 'RS256')

			// Token with number userId instead of string
			const wrongTypeToken = await new SignJWT({
				userId: 123, // should be string
				organizationId: 'org',
				hostId: 'host',
				createdAt: Date.now(),
			})
				.setProtectedHeader({ alg: 'RS256' })
				.sign(key)

			const result = await verifyDaemonToken(publicKey, wrongTypeToken)
			expect(result).toBeNull()
		})
	})

	describe('decodeDaemonTokenUnsafe', () => {
		test('decodes claims without verification', async () => {
			const token = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789', 1700000000000)

			const claims = decodeDaemonTokenUnsafe(token)

			expect(claims).not.toBeNull()
			expect(claims!.userId).toBe('user-123')
			expect(claims!.organizationId).toBe('org-456')
			expect(claims!.hostId).toBe('host-789')
			expect(claims!.createdAt).toBe(1700000000000)
		})

		test('returns null for non-JWT strings', () => {
			expect(decodeDaemonTokenUnsafe('not-a-jwt')).toBeNull()
			expect(decodeDaemonTokenUnsafe('')).toBeNull()
			expect(decodeDaemonTokenUnsafe('a.b')).toBeNull()
			expect(decodeDaemonTokenUnsafe('a')).toBeNull()
		})

		test('returns null for JWT with invalid base64 payload', () => {
			expect(decodeDaemonTokenUnsafe('header.!!!invalid-base64!!!.signature')).toBeNull()
		})

		test('returns null for JWT with non-JSON payload', () => {
			const nonJsonPayload = Buffer.from('not json').toString('base64url')
			expect(decodeDaemonTokenUnsafe(`header.${nonJsonPayload}.signature`)).toBeNull()
		})

		test('returns null for JWT with missing required claims', () => {
			const incompletePayload = Buffer.from(JSON.stringify({ userId: 'user' })).toString('base64url')
			expect(decodeDaemonTokenUnsafe(`header.${incompletePayload}.signature`)).toBeNull()
		})
	})

	describe('signLaunchToken', () => {
		test('creates a valid JWT with three parts', async () => {
			const token = await signLaunchToken(privateKey, 'user-123', 'org-456')
			expect(token).toBeDefined()
			expect(typeof token).toBe('string')
			expect(token.split('.')).toHaveLength(3)
		})

		test('includes type: launch in claims', async () => {
			const token = await signLaunchToken(privateKey, 'user-123', 'org-456')
			const claims = await verifyLaunchToken(publicKey, token)
			expect(claims).not.toBeNull()
			expect(claims!.type).toBe('launch')
		})

		test('does not include hostId in claims', async () => {
			const token = await signLaunchToken(privateKey, 'user-123', 'org-456')
			// Decode the raw payload to verify no hostId
			const parts = token.split('.')
			const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
			expect(payload.hostId).toBeUndefined()
		})

		test('includes exp claim for 24h expiry', async () => {
			const before = Math.floor(Date.now() / 1000)
			const token = await signLaunchToken(privateKey, 'user-123', 'org-456')
			const parts = token.split('.')
			const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
			expect(payload.exp).toBeDefined()
			// exp should be ~24h from now (allow 5 second tolerance)
			const expectedExp = before + 24 * 60 * 60
			expect(payload.exp).toBeGreaterThanOrEqual(expectedExp - 5)
			expect(payload.exp).toBeLessThanOrEqual(expectedExp + 5)
		})
	})

	describe('verifyLaunchToken', () => {
		test('verifies and returns claims for valid token', async () => {
			const token = await signLaunchToken(privateKey, 'user-123', 'org-456')
			const claims = await verifyLaunchToken(publicKey, token)
			expect(claims).not.toBeNull()
			expect(claims!.type).toBe('launch')
			expect(claims!.userId).toBe('user-123')
			expect(claims!.organizationId).toBe('org-456')
		})

		test('returns null for invalid token string', async () => {
			const result = await verifyLaunchToken(publicKey, 'not-a-jwt')
			expect(result).toBeNull()
		})

		test('returns null for token signed with different key', async () => {
			const otherKeyPair = await crypto.subtle.generateKey(
				{
					name: 'RSASSA-PKCS1-v1_5',
					modulusLength: 2048,
					publicExponent: new Uint8Array([1, 0, 1]),
					hash: 'SHA-256',
				},
				true,
				['sign', 'verify'],
			)
			const otherPrivate = await crypto.subtle.exportKey('pkcs8', otherKeyPair.privateKey)
			const otherPrivateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(otherPrivate).toString('base64')}\n-----END PRIVATE KEY-----`

			const token = await signLaunchToken(otherPrivateKey, 'user', 'org')
			const result = await verifyLaunchToken(publicKey, token)
			expect(result).toBeNull()
		})

		test('returns null for token missing type claim', async () => {
			const key = await importPKCS8(privateKey, 'RS256')
			const tokenWithoutType = await new SignJWT({ userId: 'user', organizationId: 'org' })
				.setProtectedHeader({ alg: 'RS256' })
				.setExpirationTime('24h')
				.sign(key)
			const result = await verifyLaunchToken(publicKey, tokenWithoutType)
			expect(result).toBeNull()
		})
	})

	describe('cross-type rejection', () => {
		test('launch tokens are rejected by verifyDaemonToken', async () => {
			const launchToken = await signLaunchToken(privateKey, 'user-123', 'org-456')
			const result = await verifyDaemonToken(publicKey, launchToken)
			expect(result).toBeNull()
		})

		test('daemon tokens are rejected by verifyLaunchToken', async () => {
			const daemonToken = await signDaemonToken(privateKey, 'user-123', 'org-456', 'host-789')
			const result = await verifyLaunchToken(publicKey, daemonToken)
			expect(result).toBeNull()
		})
	})

	describe('loadKeyFromEnvValue', () => {
		let tempDir: string

		beforeAll(async () => {
			tempDir = await mkdtemp(join(tmpdir(), 'daemon-token-test-'))
		})

		afterAll(async () => {
			await rm(tempDir, { recursive: true, force: true })
		})

		test('loads key from base64-encoded string', () => {
			const pemContent = '-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----'
			const base64Encoded = Buffer.from(pemContent).toString('base64')

			const result = loadKeyFromEnvValue(base64Encoded)

			expect(result).toBe(pemContent)
		})

		test('loads key from absolute file path', async () => {
			const pemContent = '-----BEGIN PUBLIC KEY-----\nABCDEF...\n-----END PUBLIC KEY-----'
			const filePath = join(tempDir, 'test-key.pem')
			await writeFile(filePath, pemContent)

			const result = loadKeyFromEnvValue(filePath)

			expect(result).toBe(pemContent)
		})

		test('loads key from relative file path starting with ./', async () => {
			const pemContent = '-----BEGIN PUBLIC KEY-----\nRELATIVE...\n-----END PUBLIC KEY-----'
			const filePath = join(tempDir, 'relative-key.pem')
			await writeFile(filePath, pemContent)

			// Create relative path from cwd
			const cwd = process.cwd()
			process.chdir(tempDir)
			try {
				const result = loadKeyFromEnvValue('./relative-key.pem')
				expect(result).toBe(pemContent)
			} finally {
				process.chdir(cwd)
			}
		})

		test('throws error for non-existent file path', () => {
			expect(() => loadKeyFromEnvValue('/non/existent/path.pem')).toThrow()
		})

		test('correctly identifies file paths', () => {
			// These should be treated as file paths (would throw if file doesn't exist)
			expect(() => loadKeyFromEnvValue('/absolute/path.pem')).toThrow()
			expect(() => loadKeyFromEnvValue('./relative/path.pem')).toThrow()
			expect(() => loadKeyFromEnvValue('~/home/path.pem')).toThrow()

			// This should be treated as base64 (won't throw, just decode)
			const result = loadKeyFromEnvValue('SGVsbG8gV29ybGQ=') // "Hello World" in base64
			expect(result).toBe('Hello World')
		})
	})
})
