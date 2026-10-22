import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { billingInfoProcedure } from '../../src/orpc/api/auth/admin/billing-info'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import { createMockApiAuth, createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { createDefaultTestEffectRuntime } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('auth.admin.billing.info', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	// IDs for each scenario org created in beforeAll
	let notLinkedOrgId: string
	let linkedOrgId: string
	let linkedCustomerId: string
	let enrolledOrgId: string
	let enrolledCustomerId: string
	let enrolledSubscriptionId: string

	const workosOrgId1 = `workos_billing_not_linked_${randomUUID()}`
	const workosOrgId2 = `workos_billing_linked_${randomUUID()}`
	const workosOrgId3 = `workos_billing_enrolled_${randomUUID()}`

	beforeAll(async () => {
		const testDb = await createTestDb('billing_info')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		linkedCustomerId = `cus_linked_${randomUUID().slice(0, 8)}`
		enrolledCustomerId = `cus_enrolled_${randomUUID().slice(0, 8)}`
		enrolledSubscriptionId = `sub_enrolled_${randomUUID().slice(0, 8)}`

		// Org 1: not linked (no stripe_customer_id)
		const [org1] = await db
			.insert(organizations)
			.values({ name: 'Billing Not Linked Org', workos_organization_id: workosOrgId1 })
			.returning()
		if (!org1) throw new Error('Unable to insert org1')
		notLinkedOrgId = org1.id

		// Org 2: billing_linked (has stripe_customer_id, no KV subscription cache)
		const [org2] = await db
			.insert(organizations)
			.values({
				name: 'Billing Linked Org',
				workos_organization_id: workosOrgId2,
				stripe_customer_id: linkedCustomerId,
			})
			.returning()
		if (!org2) throw new Error('Unable to insert org2')
		linkedOrgId = org2.id

		// Org 3: billing_enrolled (has stripe_customer_id + KV subscription cache)
		const [org3] = await db
			.insert(organizations)
			.values({
				name: 'Billing Enrolled Org',
				workos_organization_id: workosOrgId3,
				stripe_customer_id: enrolledCustomerId,
			})
			.returning()
		if (!org3) throw new Error('Unable to insert org3')
		enrolledOrgId = org3.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext(orgId: string, kv?: TestBillingKvService, stripe = createMockStripeService()) {
		const countActiveOrganizationMemberships = vi.fn(async () => 3)
		const countPendingInvitations = vi.fn(async () => 1)
		const auth = createMockApiAuth({
			organizationId: orgId,
			workosOrganizationId: `workos_${orgId}`,
			role: 'admin',
			roles: ['admin'],
		})

		return {
			context: createMockApiContext({
				auth,
				services: {
					workos: createMockWorkosService({ countActiveOrganizationMemberships, countPendingInvitations }),
					db,
					dbReadReplica: db,
					...(kv
						? {
								effectRuntime: createDefaultTestEffectRuntime({
									billingKv: billingKvLayerFromTestService(kv),
								}),
							}
						: {}),
					stripe,
				},
			}),
		}
	}

	test('returns not_linked when org has no stripe_customer_id', async () => {
		const getCurrentSubscriptionDetails = vi.fn(async () => null)
		const getUpcomingInvoice = vi.fn(async () => null)
		const result = await call(
			billingInfoProcedure,
			{},
			buildContext(
				notLinkedOrgId,
				new TestBillingKvService(),
				createMockStripeService({ getCurrentSubscriptionDetails, getUpcomingInvoice }),
			),
		)

		expect(result.rolloutDisplayState).toBe('not_linked')
		expect(result.tier).toBeNull()
		expect(result.subscriptionStatus).toBeNull()
		expect(result.hasPaymentMethod).toBeNull()
		expect(result.paymentMethod).toBeNull()
		expect(result.discount).toBeNull()
		expect(result.nextInvoice).toBeNull()
		expect(result.stripeCustomerId).toBeNull()
		expect(result.subscriptionId).toBeNull()
		expect(result.activeSeatCount).toBe(3)
		expect(getCurrentSubscriptionDetails).not.toHaveBeenCalled()
		expect(getUpcomingInvoice).not.toHaveBeenCalled()
	})

	test('returns billing_linked when org has stripe_customer_id but no current subscription', async () => {
		const kv = new TestBillingKvService()
		const getCurrentSubscriptionDetails = vi.fn(async () => null)
		const getUpcomingInvoice = vi.fn(async () => null)

		const result = await call(
			billingInfoProcedure,
			{},
			buildContext(
				linkedOrgId,
				kv,
				createMockStripeService({ getCurrentSubscriptionDetails, getUpcomingInvoice }),
			),
		)

		expect(result.rolloutDisplayState).toBe('billing_linked')
		expect(result.tier).toBeNull()
		expect(result.subscriptionStatus).toBe('none')
		expect(result.hasPaymentMethod).toBeNull()
		expect(result.paymentMethod).toBeNull()
		expect(result.discount).toBeNull()
		expect(result.nextInvoice).toBeNull()
		expect(result.stripeCustomerId).toBe(linkedCustomerId)
		expect(result.subscriptionId).toBeNull()
		expect(result.activeSeatCount).toBe(3)
		expect(getCurrentSubscriptionDetails).toHaveBeenCalledWith(linkedCustomerId)
		expect(getUpcomingInvoice).not.toHaveBeenCalled()
	})

	test('treats malformed defined stripe_customer_id as internal organization data corruption', async () => {
		const [orgWithMalformedCustomer] = await db
			.insert(organizations)
			.values({
				name: 'Billing Malformed Org',
				workos_organization_id: `workos_billing_malformed_${randomUUID()}`,
				stripe_customer_id: 'sub_123',
			})
			.returning()

		if (!orgWithMalformedCustomer) {
			throw new Error('Unable to insert malformed billing org')
		}

		try {
			await call(billingInfoProcedure, {}, buildContext(orgWithMalformedCustomer.id, new TestBillingKvService()))
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toMatch(/invalid billing organization data/i)
		}
	})

	test('returns billing_enrolled with live card, discount, and upcoming invoice details', async () => {
		const kv = new TestBillingKvService()
		await kv.setSubscriptionCache(enrolledCustomerId, {
			customerId: enrolledCustomerId,
			organizationId: enrolledOrgId,
			subscriptionId: enrolledSubscriptionId,
			status: 'trialing',
			priceId: null,
			currentPeriodEnd: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
			hasPaidInvoice: false,
			hasPaymentMethod: false,
			pastDueAt: null,
			syncedAt: Date.now(),
		})
		const getCurrentSubscriptionDetails = vi.fn(async () => ({
			subscriptionId: enrolledSubscriptionId,
			paymentMethod: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
			discount: {
				id: 'di_test',
				promotionCodeId: 'promo_test',
				code: 'TRIAL50',
				name: 'Half off',
				percentOff: 50,
				amountOff: null,
				currency: null,
				duration: 'once',
			},
		}))
		const getUpcomingInvoice = vi.fn(async () => ({ amountDue: 500, currency: 'usd' }))

		const result = await call(
			billingInfoProcedure,
			{},
			buildContext(
				enrolledOrgId,
				kv,
				createMockStripeService({ getCurrentSubscriptionDetails, getUpcomingInvoice }),
			),
		)

		expect(result.rolloutDisplayState).toBe('billing_enrolled')
		expect(result.subscriptionStatus).toBe('trialing')
		expect(result.hasPaymentMethod).toBe(false)
		expect(result.paymentMethod).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 })
		expect(result.discount).toEqual({
			id: 'di_test',
			promotionCodeId: 'promo_test',
			code: 'TRIAL50',
			name: 'Half off',
			percentOff: 50,
			amountOff: null,
			currency: null,
			duration: 'once',
		})
		expect(result.nextInvoice).toEqual({ amountDue: 500, currency: 'usd' })
		expect(result.stripeCustomerId).toBe(enrolledCustomerId)
		expect(result.subscriptionId).toBe(enrolledSubscriptionId)
		expect(result.tier).toBeNull() // no price ID means null tier
		expect(result.activeSeatCount).toBe(3)
		expect(getCurrentSubscriptionDetails).toHaveBeenCalledWith(enrolledCustomerId)
		expect(getUpcomingInvoice).toHaveBeenCalledWith(enrolledSubscriptionId)
	})

	test('returns billing_enrolled when upcoming invoice is unavailable', async () => {
		const kv = new TestBillingKvService()
		await kv.setSubscriptionCache(enrolledCustomerId, {
			customerId: enrolledCustomerId,
			organizationId: enrolledOrgId,
			subscriptionId: enrolledSubscriptionId,
			status: 'active',
			priceId: null,
			currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
			hasPaidInvoice: true,
			hasPaymentMethod: true,
			pastDueAt: null,
			syncedAt: Date.now(),
		})
		const getCurrentSubscriptionDetails = vi.fn(async () => ({
			subscriptionId: enrolledSubscriptionId,
			paymentMethod: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
			discount: null,
		}))
		const getUpcomingInvoice = vi.fn(async () => null)

		const result = await call(
			billingInfoProcedure,
			{},
			buildContext(
				enrolledOrgId,
				kv,
				createMockStripeService({ getCurrentSubscriptionDetails, getUpcomingInvoice }),
			),
		)

		expect(result.rolloutDisplayState).toBe('billing_enrolled')
		expect(result.subscriptionStatus).toBe('active')
		expect(result.paymentMethod).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 })
		expect(result.discount).toBeNull()
		expect(result.nextInvoice).toBeNull()
		expect(getUpcomingInvoice).toHaveBeenCalledWith(enrolledSubscriptionId)
	})

	test('derives Starter tier from the configured Starter price while remaining billing_enrolled', async () => {
		vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter_test')
		try {
			const kv = new TestBillingKvService()
			await kv.setSubscriptionCache(enrolledCustomerId, {
				customerId: enrolledCustomerId,
				organizationId: enrolledOrgId,
				subscriptionId: enrolledSubscriptionId,
				status: 'active',
				priceId: 'price_starter_test',
				currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
				hasPaidInvoice: true,
				hasPaymentMethod: false,
				pastDueAt: null,
				syncedAt: Date.now(),
			})
			const getCurrentSubscriptionDetails = vi.fn(async () => null)
			const getUpcomingInvoice = vi.fn(async () => null)

			const result = await call(
				billingInfoProcedure,
				{},
				buildContext(
					enrolledOrgId,
					kv,
					createMockStripeService({ getCurrentSubscriptionDetails, getUpcomingInvoice }),
				),
			)

			expect(result.rolloutDisplayState).toBe('billing_enrolled')
			expect(result.tier).toBe('starter')
			expect(result.subscriptionStatus).toBe('active')
			expect(result.subscriptionId).toBe(enrolledSubscriptionId)
		} finally {
			vi.unstubAllEnvs()
		}
	})

	test('returns FORBIDDEN for non-admin user', async () => {
		const nonAdminAuth = createMockApiAuth({
			organizationId: notLinkedOrgId,
			workosOrganizationId: workosOrgId1,
			role: '',
			roles: [],
		})

		await expect(
			call(
				billingInfoProcedure,
				{},
				{
					context: createMockApiContext({
						auth: nonAdminAuth,
						services: { db, dbReadReplica: db },
					}),
				},
			),
		).rejects.toThrow()
	})
})
