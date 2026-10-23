import { randomUUID } from 'node:crypto'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, ORPCError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { artifactInfoProcedure } from '../../src/orpc/api/public/artifacts/info'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { StatefulMockWorkosService } from '../mocks/workos-service.mock'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const uuid = () => randomUUID() as `${string}-${string}-${string}-${string}-${string}`
const requesterEmail = 'requester-status@example.com'

describe('public artifacts info', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrganizationId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('public_artifacts_info')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Public Lookup Org', workos_organization_id: 'workos-public-lookup' })
			.returning()
		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: 'workos-other-lookup' })
			.returning()
		if (!org || !otherOrg) throw new Error('Failed to create organizations')

		organizationId = org.id
		otherOrganizationId = otherOrg.id

		const content = '# Private artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'private.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const makeContext = (
		auth: ReturnType<typeof createMockApiAuth> | null,
		workos?: StatefulMockWorkosService,
		requestIp: string = randomUUID(),
	) => ({
		...createMockApiContext({ auth, services: { db, dbReadReplica: db, ...(workos ? { workos } : {}) } }),
		requestIp,
	})

	test('throws NOT_FOUND for nonexistent artifact', async () => {
		try {
			await call(artifactInfoProcedure, { artifactId: uuid() }, { context: makeContext(null) })
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})

	test('returns accessible:true when caller in same org', async () => {
		const result = await call(
			artifactInfoProcedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ organizationId })) },
		)

		expect(result).toEqual({ exists: true, accessible: true })
	})

	test('returns inaccessible payload when caller in different org', async () => {
		const result = await call(
			artifactInfoProcedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ organizationId: otherOrganizationId })) },
		)

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: null,
			myRequestStatus: 'none',
			lastRequestedAt: null,
		})
	})

	test('throws NOT_FOUND when org has feature disabled', async () => {
		const [disabledOrg] = await db
			.insert(organizations)
			.values({ name: 'Disabled Org', workos_organization_id: 'workos-disabled-lookup' })
			.returning()
		if (!disabledOrg) throw new Error('Failed to create disabled org')

		await db.insert(organizationSettings).values({
			organization_id: disabledOrg.id,
			access_requests_enabled: false,
		})

		const content = '# Disabled artifact'
		const [disabledArtifact] = await db
			.insert(artifacts)
			.values({
				organization_id: disabledOrg.id,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'disabled.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!disabledArtifact) throw new Error('Failed to create disabled artifact')

		try {
			await call(
				artifactInfoProcedure,
				{ artifactId: disabledArtifact.id },
				{ context: makeContext(createMockApiAuth({ organizationId: otherOrganizationId })) },
			)
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})

	test('returns inaccessible for anonymous caller without leaking myRequestStatus', async () => {
		const result = await call(artifactInfoProcedure, { artifactId }, { context: makeContext(null) })

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: null,
			myRequestStatus: 'none',
			lastRequestedAt: null,
		})
	})

	test('surfaces the primary verified domain for org branding', async () => {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({
			id: 'workos-public-lookup',
			name: 'Public Lookup Org',
			domains: [
				{ id: 'dom-pending', domain: 'pending.example.com', state: 'pending' },
				{ id: 'dom-verified', domain: 'acme.com', state: 'verified' },
			],
		})

		const result = await call(artifactInfoProcedure, { artifactId }, { context: makeContext(null, workos) })

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: 'acme.com',
			myRequestStatus: 'none',
			lastRequestedAt: null,
		})
	})

	test('returns domain:null when org has no verified domain', async () => {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({
			id: 'workos-public-lookup',
			name: 'Public Lookup Org',
			domains: [{ id: 'dom-pending', domain: 'pending.example.com', state: 'pending' }],
		})

		const result = await call(artifactInfoProcedure, { artifactId }, { context: makeContext(null, workos) })

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: null,
			myRequestStatus: 'none',
			lastRequestedAt: null,
		})
	})

	test('returns domain:null when getOrganization fails (fail-open)', async () => {
		// StatefulMockWorkosService.getOrganization throws when the org isn't seeded,
		// simulating a WorkOS lookup failure; the handler must fall open to domain:null.
		const workos = new StatefulMockWorkosService()

		const result = await call(artifactInfoProcedure, { artifactId }, { context: makeContext(null, workos) })

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: null,
			myRequestStatus: 'none',
			lastRequestedAt: null,
		})
	})

	test('resolves myRequestStatus by authenticated email', async () => {
		const requestedAt = new Date()
		await db.insert(accessRequests).values({
			organization_id: organizationId,
			artifact_id: artifactId,
			artifact_title_snapshot: 'private.md',
			artifact_owner_user_id: 'artifact-owner',
			requester_user_id: 'status-user',
			requester_email: requesterEmail,
			requested_at: requestedAt,
		})

		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'test-user-id', email: requesterEmail })
		const result = await call(
			artifactInfoProcedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ organizationId: otherOrganizationId }), workos) },
		)

		expect(result).toEqual({
			exists: true,
			accessible: false,
			organizationName: 'Public Lookup Org',
			domain: null,
			myRequestStatus: 'pending',
			lastRequestedAt: requestedAt.toISOString(),
		})
	})
})
