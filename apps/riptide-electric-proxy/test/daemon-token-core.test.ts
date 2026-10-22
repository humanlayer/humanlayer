import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { importPKCS8, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import * as daemonTokenCore from '../src/auth/daemon-token-core'
import { loadKeyFromEnvValue, verifyDaemonToken } from '../src/auth/daemon-token-core'
import { createElectricTestContext, createTestUser, waitForItem } from './fixtures'

const CI = !!process.env.CI

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

// Helper function to sign tokens for testing (since electric-proxy doesn't export signing)
async function signTestToken(
	privateKeyPem: string,
	userId: string,
	organizationId: string,
	hostId: string,
	createdAt: number = Date.now(),
): Promise<string> {
	const key = await importPKCS8(privateKeyPem, 'RS256')
	return await new SignJWT({ userId, organizationId, hostId, createdAt })
		.setProtectedHeader({ alg: 'RS256' })
		.sign(key)
}

describe('daemon-token-core (electric-proxy)', () => {
	describe('verifyDaemonToken', () => {
		test('verifies and returns claims for valid token', async () => {
			const token = await signTestToken(privateKey, 'user-123', 'org-456', 'host-789')

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
			const token = await signTestToken(privateKey, 'user-123', 'org-456', 'host-789')

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

			const token = await signTestToken(otherPrivateKey, 'user', 'org', 'host')
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

	describe('module exports', () => {
		test('module does NOT export signDaemonToken (security: proxy cannot sign)', () => {
			expect(daemonTokenCore).not.toHaveProperty('signDaemonToken')
		})

		test('module does NOT export decodeDaemonTokenUnsafe (not needed for proxy)', () => {
			expect(daemonTokenCore).not.toHaveProperty('decodeDaemonTokenUnsafe')
		})

		test('module exports verifyDaemonToken', () => {
			expect(daemonTokenCore).toHaveProperty('verifyDaemonToken')
			expect(typeof daemonTokenCore.verifyDaemonToken).toBe('function')
		})

		test('module exports loadKeyFromEnvValue', () => {
			expect(daemonTokenCore).toHaveProperty('loadKeyFromEnvValue')
			expect(typeof daemonTokenCore.loadKeyFromEnvValue).toBe('function')
		})

		test('DaemonTokenClaims type is properly exported', async () => {
			// This is a compile-time type check - if this file compiles, the type is exported
			// We verify the type is usable by type-checking the return value of verifyDaemonToken
			const token = await signTestToken(privateKey, 'user', 'org', 'host')
			const claims = await daemonTokenCore.verifyDaemonToken(publicKey, token)

			// Type assertion that claims satisfies DaemonTokenClaims
			if (claims !== null) {
				const _userId: string = claims.userId
				const _orgId: string = claims.organizationId
				const _hostId: string = claims.hostId
				const _createdAt: number = claims.createdAt
				expect(_userId).toBe('user')
			}
		})
	})
})

// ============================================================================
// Daemon Token Scope Tests - Session Access
// ============================================================================

describe.skipIf(CI)('Daemon Token Scope Tests', () => {
	let ctx: Awaited<ReturnType<typeof createElectricTestContext>>

	beforeAll(async () => {
		ctx = await createElectricTestContext()
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	describe('Session Access Control', () => {
		test('Daemon can sync sessions it created (matching host_id)', async () => {
			const testId = randomUUID().slice(0, 8)
			const daemonUser = createTestUser(`daemon_scope_a1_${testId}`)
			const hostId = `host-${testId}-a1`

			// Create a proxy server with daemon token (hostId in auth context)
			const server = ctx.createProxyServer({
				user: daemonUser,
				organization: ctx.defaultOrganization,
				hostId,
				key: `daemon_a1_${testId}`,
			})

			const sessionsCollection = await ctx.createSessionsCollection({ server })

			// Create session owned by daemon's host_id
			const session = await ctx.seedSession({
				resource_owner_user_id: daemonUser.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: daemonUser.userId,
			})

			// Daemon should see its own session
			await waitForItem(sessionsCollection, session.id, { timeout: 10_000 })
			expect(sessionsCollection.has(session.id)).toBe(true)
		})

		test('Daemon CANNOT sync sessions from different host_id', async () => {
			const testId = randomUUID().slice(0, 8)
			const daemon1User = createTestUser(`daemon_scope_a2_d1_${testId}`)
			const daemon2User = createTestUser(`daemon_scope_a2_d2_${testId}`)
			const hostId1 = `host-${testId}-a2-1`
			const hostId2 = `host-${testId}-a2-2`

			// Create daemon1 proxy with hostId1
			const daemon1Server = ctx.createProxyServer({
				user: daemon1User,
				organization: ctx.defaultOrganization,
				hostId: hostId1,
				key: `daemon1_a2_${testId}`,
			})

			const daemon1SessionsCollection = await ctx.createSessionsCollection({ server: daemon1Server })

			// Create session owned by hostId2 (different host)
			const session = await ctx.withElectricSentinel(daemon1SessionsCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: daemon2User.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: hostId2,
						created_by: daemon2User.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: daemon1User.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: hostId1,
						created_by: daemon1User.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed daemon session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Daemon1 should NOT see session from hostId2 (critical security property)
			expect(daemon1SessionsCollection.has(session.id)).toBe(false)
		})

		test('Daemon can sync sessions without task_id (NULL task_id)', async () => {
			const testId = randomUUID().slice(0, 8)
			const daemonUser = createTestUser(`daemon_scope_a3_${testId}`)
			const hostId = `host-${testId}-a3`

			const server = ctx.createProxyServer({
				user: daemonUser,
				organization: ctx.defaultOrganization,
				hostId,
				key: `daemon_a3_${testId}`,
			})

			const sessionsCollection = await ctx.createSessionsCollection({ server })

			// Create session with NULL task_id but matching host_id
			const session = await ctx.seedSession({
				resource_owner_user_id: daemonUser.userId,
				organization_id: ctx.defaultOrganization.id,
				task_id: null,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: hostId,
				created_by: daemonUser.userId,
			})

			// Daemon should be able to sync sessions with NULL task_id as long as host_id matches
			await waitForItem(sessionsCollection, session.id, { timeout: 10_000 })
			expect(sessionsCollection.has(session.id)).toBe(true)
		})
	})

	describe('Cross-Organization Isolation', () => {
		test('Daemon in org A CANNOT sync sessions from org B', async () => {
			const testId = randomUUID().slice(0, 8)
			const daemonUserA = createTestUser(`daemon_cross_b1_a_${testId}`)
			const daemonUserB = createTestUser(`daemon_cross_b1_b_${testId}`)
			const hostIdA = `host-${testId}-b1-a`
			const hostIdB = `host-${testId}-b1-b`

			// Create organization B
			const orgB = await ctx.seedOrganization({ name: `Cross Org B ${testId}` })

			// Create daemon A proxy in default org
			const daemonAServer = ctx.createProxyServer({
				user: daemonUserA,
				organization: ctx.defaultOrganization,
				hostId: hostIdA,
				key: `daemon_a_b1_${testId}`,
			})

			const daemonASessionsCollection = await ctx.createSessionsCollection({ server: daemonAServer })

			// Create session in org B
			const sessionB = await ctx.withElectricSentinel(daemonASessionsCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: daemonUserB.userId,
						organization_id: orgB.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: hostIdB,
						created_by: daemonUserB.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.sessions)
					.values({
						resource_owner_user_id: daemonUserA.userId,
						organization_id: ctx.defaultOrganization.id,
						working_directory: tmpdir(),
						status: 'draft',
						host_id: hostIdA,
						created_by: daemonUserA.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed cross-org session barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Daemon A should NOT see session from org B (even if host_id is different)
			expect(daemonASessionsCollection.has(sessionB.id)).toBe(false)
		})

		test('Daemon in org A CANNOT sync tasks from org B', async () => {
			const testId = randomUUID().slice(0, 8)
			const daemonUserA = createTestUser(`daemon_cross_b2_a_${testId}`)
			const daemonUserB = createTestUser(`daemon_cross_b2_b_${testId}`)
			const hostIdA = `host-${testId}-b2-a`

			// Create organization B
			const orgB = await ctx.seedOrganization({ name: `Cross Org Task B ${testId}` })

			// Create daemon A proxy in default org
			const daemonAServer = ctx.createProxyServer({
				user: daemonUserA,
				organization: ctx.defaultOrganization,
				hostId: hostIdA,
				key: `daemon_a_b2_${testId}`,
			})

			const daemonATasksCollection = await ctx.createTasksCollection({ server: daemonAServer })

			// Create task in org B
			const taskB = await ctx.withElectricSentinel(daemonATasksCollection, async (tx) => {
				const [denied] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `Cross Org Task B2 ${testId}`,
						resource_owner_user_id: daemonUserB.userId,
						organization_id: orgB.id,
						created_by: daemonUserB.userId,
					})
					.returning()
				const [sentinel] = await tx
					.insert(ctx.tables.tasks)
					.values({
						name: `Cross Org Task B2 Sentinel ${testId}`,
						resource_owner_user_id: daemonUserA.userId,
						organization_id: ctx.defaultOrganization.id,
						created_by: daemonUserA.userId,
					})
					.returning()
				if (!denied || !sentinel) throw new Error('Failed to seed cross-org task barrier')
				return { result: denied, sentinelId: sentinel.id }
			})

			// Daemon A should NOT see task from org B
			expect(daemonATasksCollection.has(taskB.id)).toBe(false)
		})
	})
})
