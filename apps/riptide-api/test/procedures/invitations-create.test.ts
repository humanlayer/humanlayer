import { randomUUID } from 'node:crypto'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { AccessRequestUnavailableError } from '../../src/effects/services/access-request/access-request-errors'
import { AccessRequestService } from '../../src/effects/services/access-request/access-request.service'
import { makeWorkosServiceLive } from '../../src/effects/services/workos/workos.service'
import { createAdminInvitationProcedure as liveCreateAdminInvitationProcedure } from '../../src/orpc/api/auth/admin/invitations-create'
import type { Services } from '../../src/orpc/base'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import { createMockApiAuth, createMockApiContext, StatefulMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const noopAccessRequestsLayer = Layer.succeed(AccessRequestService, {
	requestArtifactAccess: () => Effect.die('requestArtifactAccess not used in invitation tests'),
	createAccessRequest: () => Effect.die('createAccessRequest not used in invitation tests'),
	sendInviteAndResolveRequests: () => Effect.void,
	backfillRequesterUserId: () => Effect.void,
	archiveRequest: () => Effect.void,
})

async function seedBilling(kv: TestBillingKvService, organizationId: string, priceId: string) {
	const customerId = `cus_${organizationId}`
	await kv.setOrgCustomerId(organizationId, customerId)
	await kv.setSubscriptionCache(customerId, {
		customerId,
		organizationId,
		subscriptionId: `sub_${organizationId}`,
		status: 'active',
		priceId,
		currentPeriodEnd: 1_900_000_000,
		hasPaidInvoice: false,
		hasPaymentMethod: false,
		pastDueAt: null,
		syncedAt: Date.now(),
	})
}

describe('api/auth/admin/invitations/create', () => {
	function makeContext(orgId: string, userId: string, serviceOverrides?: Partial<Services>) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId: orgId, workosOrganizationId: orgId, role: 'admin' }),
			services: { db: {} as any, dbReadReplica: {} as any, ...serviceOverrides },
		})
	}

	function bindProcedure(workos: StatefulMockWorkosService, kv?: TestBillingKvService) {
		const runtime = createRuntimeWithTestPostgresLayer({} as any, {
			workos: makeWorkosServiceLive(workos),
			accessRequests: noopAccessRequestsLayer,
			...(kv ? { billingKv: billingKvLayerFromTestService(kv) } : {}),
		})
		return bindProcedureToRuntime(liveCreateAdminInvitationProcedure, runtime)
	}

	test('Successfully creates an invitation', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_admin123'
		const orgId = 'org_workos_123'

		workos.addUser({ id: userId, email: 'admin@example.com' })
		workos.addOrganization({ id: orgId, name: 'Test Org' })
		workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })

		const result = await call(
			bindProcedure(workos),
			{ email: 'newuser@example.com' },
			{ context: makeContext(orgId, userId) },
		)

		expect(result.invitation.email).toBe('newuser@example.com')
		expect(result.invitation.state).toBe('pending')
	})

	test('Returns ALREADY_INVITED when email already has pending invitation', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_admin456'
		const orgId = 'org_workos_456'
		const targetEmail = 'invited@example.com'

		workos.addUser({ id: userId, email: 'admin@example.com' })
		workos.addOrganization({ id: orgId, name: 'Test Org' })
		workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
		workos.addInvitation({ email: targetEmail, organizationId: orgId, state: 'pending' })

		try {
			await call(bindProcedure(workos), { email: targetEmail }, { context: makeContext(orgId, userId) })
			expect.unreachable('Should have thrown ALREADY_INVITED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('ALREADY_INVITED')
			expect(error.data.message).toContain('already been sent')
		}
	})

	test('Allows invitation to same email in different organization', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_admin789'
		const orgId1 = 'org_workos_789a'
		const orgId2 = 'org_workos_789b'
		const targetEmail = 'crossorg@example.com'

		workos.addUser({ id: userId, email: 'admin@example.com' })
		workos.addOrganization({ id: orgId1, name: 'Org One' })
		workos.addOrganization({ id: orgId2, name: 'Org Two' })
		workos.addMembership({ userId, organizationId: orgId2, role: { slug: 'admin' } })
		workos.addInvitation({ email: targetEmail, organizationId: orgId1, state: 'pending' })

		const result = await call(
			bindProcedure(workos),
			{ email: targetEmail },
			{ context: makeContext(orgId2, userId) },
		)

		expect(result.invitation.email).toBe(targetEmail)
		expect(result.invitation.state).toBe('pending')
	})

	test('Allows invitation when previous invitation was revoked', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_admin_revoked'
		const orgId = 'org_workos_revoked'
		const targetEmail = 'revoked@example.com'

		workos.addUser({ id: userId, email: 'admin@example.com' })
		workos.addOrganization({ id: orgId, name: 'Test Org' })
		workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
		workos.addInvitation({ email: targetEmail, organizationId: orgId, state: 'revoked' })

		const result = await call(
			bindProcedure(workos),
			{ email: targetEmail },
			{ context: makeContext(orgId, userId) },
		)

		expect(result.invitation.email).toBe(targetEmail)
		expect(result.invitation.state).toBe('pending')
	})

	test('allows Starter invitation while active plus pending stays within free capacity', async () => {
		vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter')
		try {
			const workos = new StatefulMockWorkosService()
			const kv = new TestBillingKvService()
			const userId = 'user_starter_below'
			const orgId = 'org_starter_below'
			workos.addUser({ id: userId, email: 'admin@example.com' })
			workos.addOrganization({ id: orgId, name: 'Starter Org' })
			workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
			await seedBilling(kv, orgId, 'price_starter')

			const result = await call(
				bindProcedure(workos, kv),
				{ email: 'second@example.com' },
				{ context: makeContext(orgId, userId) },
			)

			expect(result.invitation.email).toBe('second@example.com')
		} finally {
			vi.unstubAllEnvs()
		}
	})

	test('blocks Starter invitation at free capacity without creating invitation', async () => {
		vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter')
		try {
			const workos = new StatefulMockWorkosService()
			const kv = new TestBillingKvService()
			const userId = 'user_starter_full'
			const orgId = 'org_starter_full'
			workos.addUser({ id: userId, email: 'admin@example.com' })
			workos.addOrganization({ id: orgId, name: 'Starter Org' })
			workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
			workos.addMembership({ userId: 'user_2', organizationId: orgId })
			workos.addMembership({ userId: 'user_3', organizationId: orgId })
			await seedBilling(kv, orgId, 'price_starter')

			let caughtError: any = null
			try {
				await call(
					bindProcedure(workos, kv),
					{ email: 'blocked@example.com' },
					{ context: makeContext(orgId, userId) },
				)
			} catch (error) {
				caughtError = error
			}

			expect(caughtError?.code).toBe('UPGRADE_REQUIRED')
			expect(caughtError?.data).toMatchObject({ currentActiveSeats: 3, pendingInvitations: 0, freeCapacity: 3 })
			expect(Array.from(workos._invitations.values()).some((inv) => inv.email === 'blocked@example.com')).toBe(
				false,
			)
		} finally {
			vi.unstubAllEnvs()
		}
	})

	test('counts pending invitations toward Starter free capacity', async () => {
		vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter')
		try {
			const workos = new StatefulMockWorkosService()
			const kv = new TestBillingKvService()
			const userId = 'user_starter_pending'
			const orgId = 'org_starter_pending'
			workos.addUser({ id: userId, email: 'admin@example.com' })
			workos.addOrganization({ id: orgId, name: 'Starter Org' })
			workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
			workos.addMembership({ userId: 'user_2', organizationId: orgId })
			workos.addInvitation({ email: 'pending@example.com', organizationId: orgId, state: 'pending' })
			await seedBilling(kv, orgId, 'price_starter')

			await expect(
				call(
					bindProcedure(workos, kv),
					{ email: 'blocked-pending@example.com' },
					{ context: makeContext(orgId, userId) },
				),
			).rejects.toMatchObject({ code: 'UPGRADE_REQUIRED' })
		} finally {
			vi.unstubAllEnvs()
		}
	})

	test('does not gate Pro invitations', async () => {
		vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter')
		try {
			const workos = new StatefulMockWorkosService()
			const kv = new TestBillingKvService()
			const userId = 'user_pro'
			const orgId = 'org_pro'
			workos.addUser({ id: userId, email: 'admin@example.com' })
			workos.addOrganization({ id: orgId, name: 'Pro Org' })
			workos.addMembership({ userId, organizationId: orgId, role: { slug: 'admin' } })
			workos.addMembership({ userId: 'user_2', organizationId: orgId })
			workos.addMembership({ userId: 'user_3', organizationId: orgId })
			await seedBilling(kv, orgId, 'price_pro')

			const result = await call(
				bindProcedure(workos, kv),
				{ email: 'pro-invite@example.com' },
				{ context: makeContext(orgId, userId) },
			)

			expect(result.invitation.email).toBe('pro-invite@example.com')
		} finally {
			vi.unstubAllEnvs()
		}
	})
})

describe('api/auth/admin/invitations/create - access request resolution', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let workosOrgId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('invitations_create_access_request')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		workosOrgId = `workos-invite-${randomUUID()}`

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Invite Resolution Org', workos_organization_id: workosOrgId })
			.returning()
		if (!org) throw new Error('Failed to create org')
		organizationId = org.id

		const content = '# Invitable artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'invitable.md',
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

	function makeAdminContext(adminUserId: string) {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId: adminUserId,
				organizationId,
				workosOrganizationId: workosOrgId,
				role: 'admin',
			}),
			services: { db, dbReadReplica: db },
		})
	}

	function bindProcedure(workos: StatefulMockWorkosService, accessRequests?: Layer.Layer<AccessRequestService>) {
		const runtime = createRuntimeWithTestPostgresLayer(db, {
			workos: makeWorkosServiceLive(workos),
			...(accessRequests ? { accessRequests } : {}),
		})
		return bindProcedureToRuntime(liveCreateAdminInvitationProcedure, runtime)
	}

	async function seedPendingRequest(requesterEmail: string) {
		const [row] = await db
			.insert(accessRequests)
			.values({
				organization_id: organizationId,
				artifact_id: artifactId,
				artifact_title_snapshot: 'invitable.md',
				artifact_owner_user_id: 'artifact-owner',
				requester_email: requesterEmail,
				status: 'pending',
				notification_status: 'not_started',
			})
			.returning()
		if (!row) throw new Error('Failed to create access request')
		return row
	}

	test('successful invite resolves matching access requests', async () => {
		const workos = new StatefulMockWorkosService()
		const adminUserId = `admin-${randomUUID()}`
		const requesterEmail = `resolve-test-${randomUUID()}@example.com`

		workos.addUser({ id: adminUserId, email: 'admin@example.com' })
		workos.addOrganization({ id: workosOrgId, name: 'Invite Resolution Org' })
		workos.addMembership({ userId: adminUserId, organizationId: workosOrgId, role: { slug: 'admin' } })

		const request = await seedPendingRequest(requesterEmail)

		await call(bindProcedure(workos), { email: requesterEmail }, { context: makeAdminContext(adminUserId) })

		const [updated] = await db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1)
		expect(updated?.status).toBe('invited')
		expect(updated?.resolved_at).toBeDefined()
		expect(updated?.resolved_by_user_id).toBe(adminUserId)
	})

	test('ALREADY_INVITED still resolves matching access requests', async () => {
		const workos = new StatefulMockWorkosService()
		const adminUserId = `admin-already-invited-${randomUUID()}`
		const requesterEmail = `already-invited-${randomUUID()}@example.com`

		workos.addUser({ id: adminUserId, email: 'admin@example.com' })
		workos.addOrganization({ id: workosOrgId, name: 'Invite Resolution Org' })
		workos.addMembership({ userId: adminUserId, organizationId: workosOrgId, role: { slug: 'admin' } })
		workos.addInvitation({ email: requesterEmail, organizationId: workosOrgId, state: 'pending' })

		const request = await seedPendingRequest(requesterEmail)

		let caughtError: any = null
		try {
			await call(bindProcedure(workos), { email: requesterEmail }, { context: makeAdminContext(adminUserId) })
		} catch (e) {
			caughtError = e
		}
		expect(caughtError).toBeTruthy()
		expect(isDefinedError(caughtError)).toBe(true)
		expect(caughtError.code).toBe('ALREADY_INVITED')

		const [updated] = await db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1)
		expect(updated?.status).toBe('invited')
		expect(updated?.resolved_by_user_id).toBe(adminUserId)
	})

	test('resolution failure does not fail the invite response', async () => {
		const workos = new StatefulMockWorkosService()
		const adminUserId = `admin-fail-resolve-${randomUUID()}`
		const requesterEmail = `fail-resolve-${randomUUID()}@example.com`

		workos.addUser({ id: adminUserId, email: 'admin@example.com' })
		workos.addOrganization({ id: workosOrgId, name: 'Invite Resolution Org' })
		workos.addMembership({ userId: adminUserId, organizationId: workosOrgId, role: { slug: 'admin' } })

		const failingAccessRequests = Layer.succeed(AccessRequestService, {
			requestArtifactAccess: () => Effect.die('not used'),
			createAccessRequest: () => Effect.die('not used'),
			sendInviteAndResolveRequests: () =>
				Effect.fail(
					new AccessRequestUnavailableError({
						operation: 'test resolution failure',
						cause: new Error('DB error during resolution'),
					}),
				),
			backfillRequesterUserId: () => Effect.void,
			archiveRequest: () => Effect.void,
		})

		const result = await call(
			bindProcedure(workos, failingAccessRequests),
			{ email: requesterEmail },
			{ context: makeAdminContext(adminUserId) },
		)

		expect(result.invitation.email).toBe(requesterEmail)
		expect(result.invitation.state).toBe('pending')
	})
})
