import { randomUUID } from 'node:crypto'

import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { createOrganizationProcedure } from '../../src/orpc/api/auth/user/organizations-create'
import { createMockApiContextNoOrg, createMockStripeService, StatefulMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('organizations.create', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	const userId = 'user_creator_123'
	const mockAuth = {
		userId,
		role: '',
		roles: [] as string[],
		permissions: [] as string[],
		entitlements: [] as string[],
		sessionId: 'test-session',
	}

	const createWorkos = (email = 'creator@humanlayer.dev') => {
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: userId, email })
		return workos
	}

	const buildSubscriptionCache = (overrides: Partial<STRIPE_SUB_CACHE> = {}): STRIPE_SUB_CACHE => ({
		customerId: overrides.customerId ?? 'cus_sync',
		organizationId: overrides.organizationId ?? null,
		subscriptionId: overrides.subscriptionId ?? 'sub_sync',
		status: overrides.status ?? 'active',
		priceId: overrides.priceId ?? 'price_starter',
		currentPeriodEnd: overrides.currentPeriodEnd ?? 1_900_000_000,
		hasPaidInvoice: overrides.hasPaidInvoice ?? false,
		hasPaymentMethod: overrides.hasPaymentMethod ?? false,
		pastDueAt: overrides.pastDueAt ?? null,
		syncedAt: overrides.syncedAt ?? Date.now(),
	})

	beforeAll(async () => {
		const testDb = await createTestDb('organizations_create')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	test('Successfully creates organization in DB, WorkOS, and Stripe provisioning path', async () => {
		const workos = createWorkos()
		const ensureProTrialSubscription = vi.fn(async () => ({
			subscriptionId: 'sub_pro_trial_should_not_be_used',
			created: true,
		}))
		const stripe = createMockStripeService({
			verifyWebhook: vi.fn(async () => {
				throw new Error('not used')
			}),
			ensureStripeCustomerForOrg: vi.fn(async ({ organizationId }) => ({
				customerId: `cus_${organizationId}`,
				created: true,
			})),
			ensureBillingOrgMappings: vi.fn(async () => {}),
			ensureStarterSubscription: vi.fn(async () => ({
				subscriptionId: 'sub_starter',
				created: true,
			})),
			ensureProTrialSubscription,
			deleteCustomer: vi.fn(async () => {}),
		})

		const orgName = 'New Test Org'
		const result = await call(
			createOrganizationProcedure,
			{ name: orgName, eulaAccepted: true },
			{
				context: createMockApiContextNoOrg({
					auth: mockAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						stripe,
					},
				}),
			},
		)

		expect(result.organizationName).toBe(orgName)
		expect(result.organizationId).toBeDefined()
		expect(result.stripeCustomerId).toBe(`cus_${result.organizationId}`)

		const [dbOrg] = await db.select().from(organizations).where(eq(organizations.id, result.organizationId))
		expect(dbOrg).toBeDefined()
		expect(dbOrg?.name).toBe(orgName)
		expect(dbOrg?.stripe_customer_id).toBe(result.stripeCustomerId)

		const workosOrg = Array.from(workos._organizations.values()).find((org) => org.name === orgName)
		expect(workosOrg).toBeDefined()
		expect(workosOrg?.metadata.internal_org_id).toBe(result.organizationId)
		// stripeCustomerId must be a top-level WorkOS field (enables Seat Sync),
		// not a metadata key.
		expect(workosOrg?.stripeCustomerId).toBe(result.stripeCustomerId)

		expect(stripe.ensureStripeCustomerForOrg).toHaveBeenCalledTimes(1)
		expect(stripe.ensureBillingOrgMappings).toHaveBeenCalledTimes(1)
		expect(stripe.ensureStarterSubscription).toHaveBeenCalledTimes(1)
		expect(ensureProTrialSubscription).not.toHaveBeenCalled()
		expect(stripe.ensureStarterSubscription).toHaveBeenCalledWith({
			customerId: `cus_${result.organizationId}`,
			quantity: 1,
		})

		const memberships = Array.from(workos._memberships.values())
		const userMembership = memberships.find((membership) => membership.userId === userId)
		expect(userMembership).toBeDefined()
		expect(userMembership?.role.slug).toBe('admin')
	})

	test('Billing provisioning failure rolls back DB org and returns error', async () => {
		const workos = createWorkos()
		const stripe = createMockStripeService({
			verifyWebhook: vi.fn(async () => {
				throw new Error('not used')
			}),
			ensureStripeCustomerForOrg: vi.fn(async ({ organizationId }) => ({
				customerId: `cus_${organizationId}`,
				created: true,
			})),
			ensureBillingOrgMappings: vi.fn(async () => {}),
			ensureStarterSubscription: vi.fn(async () => {
				throw new Error('subscription provisioning failed')
			}),
			deleteCustomer: vi.fn(async () => {}),
		})

		const orgName = `Rollback Org ${randomUUID()}`

		await expect(
			call(
				createOrganizationProcedure,
				{ name: orgName, eulaAccepted: true },
				{
					context: createMockApiContextNoOrg({
						auth: mockAuth,
						services: {
							workos,
							db,
							dbReadReplica: db,
							stripe,
						},
					}),
				},
			),
		).rejects.toThrow()

		const orgsWithName = await db.select().from(organizations).where(eq(organizations.name, orgName))
		expect(orgsWithName.length).toBe(0)
		expect(stripe.deleteCustomer).toHaveBeenCalledTimes(1)
		expect(workos._memberships.size).toBe(0)
	})

	test('Provisioning is idempotent when stripe customer already exists', async () => {
		const workos = createWorkos()
		const existingCustomerId = `cus_existing_${Date.now()}`

		const [existingOrg] = await db
			.insert(organizations)
			.values({
				name: `Existing Org ${Date.now()}`,
				workos_organization_id: `workos_existing_${Date.now()}`,
				stripe_customer_id: existingCustomerId,
			})
			.returning()

		if (!existingOrg) {
			throw new Error('Failed to seed existing organization for idempotency test')
		}

		const stripe = createMockStripeService({
			verifyWebhook: vi.fn(async () => {
				throw new Error('not used')
			}),
			ensureStripeCustomerForOrg: vi.fn(async ({ existingCustomerId: inputCustomerId }) => ({
				customerId: inputCustomerId ?? existingCustomerId,
				created: false,
			})),
			ensureBillingOrgMappings: vi.fn(async () => {}),
			ensureStarterSubscription: vi.fn(async () => ({
				subscriptionId: 'sub_existing',
				created: false,
			})),
			deleteCustomer: vi.fn(async () => {}),
		})

		const result = await call(
			createOrganizationProcedure,
			{ name: `Idempotent Org ${Date.now()}`, eulaAccepted: true },
			{
				context: createMockApiContextNoOrg({
					auth: mockAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						stripe,
					},
				}),
			},
		)

		expect(result.stripeCustomerId).toBeDefined()
		expect(stripe.ensureStripeCustomerForOrg).toHaveBeenCalledTimes(1)
		expect(stripe.ensureStarterSubscription).toHaveBeenCalledTimes(1)

		const [newOrg] = await db
			.select()
			.from(organizations)
			.where(and(eq(organizations.id, result.organizationId), isNotNull(organizations.stripe_customer_id)))
		expect(newOrg?.stripe_customer_id).toBe(result.stripeCustomerId)
	})

	test('creates only initial invites that fit within Starter free capacity', async () => {
		const workos = createWorkos()
		const stripe = createMockStripeService({
			verifyWebhook: vi.fn(async () => {
				throw new Error('not used')
			}),
			ensureStripeCustomerForOrg: vi.fn(async ({ organizationId }) => ({
				customerId: `cus_${organizationId}`,
				created: true,
			})),
			ensureBillingOrgMappings: vi.fn(async () => {}),
			ensureStarterSubscription: vi.fn(async () => ({
				subscriptionId: 'sub_starter',
				created: true,
			})),
			deleteCustomer: vi.fn(async () => {}),
		})

		const inviteEmails = ['one@example.com', 'two@example.com', 'three@example.com']
		const result = await call(
			createOrganizationProcedure,
			{ name: `Invite Capacity Org ${randomUUID()}`, eulaAccepted: true, inviteEmails },
			{
				context: createMockApiContextNoOrg({
					auth: mockAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						stripe,
					},
				}),
			},
		)

		expect(result.failedInvites).toEqual(['three@example.com'])
		expect(
			Array.from(workos._invitations.values())
				.map((invitation) => invitation.email)
				.sort(),
		).toEqual(['one@example.com', 'two@example.com'])
	})

	test('WorkOS creation failure prevents DB org creation', async () => {
		const failingWorkos = new StatefulMockWorkosService()
		failingWorkos.addUser({ id: userId, email: 'creator@humanlayer.dev' })
		failingWorkos.organizations.createOrganization = async () => {
			throw new Error('WorkOS API error')
		}

		const uniqueOrgName = `Failing Org ${randomUUID()}`

		await expect(
			call(
				createOrganizationProcedure,
				{ name: uniqueOrgName, eulaAccepted: true },
				{
					context: createMockApiContextNoOrg({
						auth: mockAuth,
						services: {
							workos: failingWorkos,
							db,
							dbReadReplica: db,
						},
					}),
				},
			),
		).rejects.toThrow()

		const orgsWithName = await db.select().from(organizations).where(eq(organizations.name, uniqueOrgName))
		expect(orgsWithName.length).toBe(0)
	})

	test('Rejects org creation for non-humanlayer.dev email domain', async () => {
		const workos = createWorkos('user@other.com')

		await expect(
			call(
				createOrganizationProcedure,
				{ name: 'Unauthorized Org', eulaAccepted: true },
				{
					context: createMockApiContextNoOrg({
						auth: mockAuth,
						services: {
							workos,
							db,
							dbReadReplica: db,
						},
					}),
				},
			),
		).rejects.toThrow()

		expect(workos._organizations.size).toBe(0)
	})

	test('Rejects org creation when BLOCK_NEW_ORG_CREATION is enabled', async () => {
		const originalBlock = process.env.BLOCK_NEW_ORG_CREATION
		process.env.BLOCK_NEW_ORG_CREATION = 'true'

		try {
			const workos = createWorkos('user@acme.com')

			let thrown: unknown
			try {
				await call(
					createOrganizationProcedure,
					{ name: 'Blocked Org', eulaAccepted: true },
					{
						context: createMockApiContextNoOrg({
							auth: mockAuth,
							services: {
								workos,
								db,
								dbReadReplica: db,
							},
						}),
					},
				)
			} catch (error) {
				thrown = error
			}

			expect(thrown).toBeDefined()
			const orpcError = thrown as { code?: string; data?: { message?: string } }
			expect(orpcError.code).toBe('BAD_REQUEST')
			expect(orpcError.data?.message).toContain('no longer accepting new organization signups')

			expect(workos._organizations.size).toBe(0)
		} finally {
			if (originalBlock === undefined) {
				delete process.env.BLOCK_NEW_ORG_CREATION
			} else {
				process.env.BLOCK_NEW_ORG_CREATION = originalBlock
			}
		}
	})

	test('Allows HumanLayer staff to create orgs when BLOCK_NEW_ORG_CREATION is enabled', async () => {
		const originalBlock = process.env.BLOCK_NEW_ORG_CREATION
		const originalStage = process.env.STAGE
		process.env.BLOCK_NEW_ORG_CREATION = 'true'
		// non-dev stage so the dev-only humanlayer.dev restriction does not apply
		process.env.STAGE = 'prod'

		try {
			for (const email of ['staff@humanlayer.dev', 'staff@humanlayer.com']) {
				const workos = createWorkos(email)
				const stripe = createMockStripeService({
					verifyWebhook: vi.fn(async () => {
						throw new Error('not used')
					}),
					ensureStripeCustomerForOrg: vi.fn(async ({ organizationId }) => ({
						customerId: `cus_${organizationId}`,
						created: true,
					})),
					ensureBillingOrgMappings: vi.fn(async () => {}),
					ensureStarterSubscription: vi.fn(async () => ({
						subscriptionId: 'sub_starter',
						created: true,
					})),
					deleteCustomer: vi.fn(async () => {}),
				})

				const result = await call(
					createOrganizationProcedure,
					{ name: `Staff Org ${email}`, eulaAccepted: true },
					{
						context: createMockApiContextNoOrg({
							auth: mockAuth,
							services: {
								workos,
								db,
								dbReadReplica: db,
								stripe,
							},
						}),
					},
				)

				expect(result.organizationId).toBeDefined()
				expect(result.organizationName).toBe(`Staff Org ${email}`)
			}
		} finally {
			if (originalBlock === undefined) {
				delete process.env.BLOCK_NEW_ORG_CREATION
			} else {
				process.env.BLOCK_NEW_ORG_CREATION = originalBlock
			}
			if (originalStage === undefined) {
				delete process.env.STAGE
			} else {
				process.env.STAGE = originalStage
			}
		}
	})

	test('Allows org creation for non-humanlayer.dev email in non-dev environment', async () => {
		const originalStage = process.env.STAGE
		const originalBlock = process.env.BLOCK_NEW_ORG_CREATION
		process.env.STAGE = 'prod'
		delete process.env.BLOCK_NEW_ORG_CREATION

		try {
			const workos = createWorkos('user@other.com')
			const stripe = createMockStripeService({
				verifyWebhook: vi.fn(async () => {
					throw new Error('not used')
				}),
				ensureStripeCustomerForOrg: vi.fn(async ({ organizationId }) => ({
					customerId: `cus_${organizationId}`,
					created: true,
				})),
				ensureBillingOrgMappings: vi.fn(async () => {}),
				ensureStarterSubscription: vi.fn(async () => ({
					subscriptionId: 'sub_prod',
					created: true,
				})),
				deleteCustomer: vi.fn(async () => {}),
			})

			const result = await call(
				createOrganizationProcedure,
				{ name: 'Prod Org', eulaAccepted: true },
				{
					context: createMockApiContextNoOrg({
						auth: mockAuth,
						services: {
							workos,
							db,
							dbReadReplica: db,
							stripe,
						},
					}),
				},
			)

			expect(result.organizationId).toBeDefined()
			expect(result.organizationName).toBe('Prod Org')
			expect(result.stripeCustomerId).toBeDefined()
		} finally {
			if (originalStage === undefined) {
				delete process.env.STAGE
			} else {
				process.env.STAGE = originalStage
			}
			if (originalBlock === undefined) {
				delete process.env.BLOCK_NEW_ORG_CREATION
			} else {
				process.env.BLOCK_NEW_ORG_CREATION = originalBlock
			}
		}
	})
})
