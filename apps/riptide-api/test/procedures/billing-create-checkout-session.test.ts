import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { createCheckoutSessionProcedure } from '../../src/orpc/api/billing/create-checkout-session'
import { createMockApiAuth, createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.createCheckoutSession', async () => {
	const checkoutAttemptId = '00000000-0000-4000-8000-000000000001'
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('billing_create_checkout_session')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Checkout Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) {
			throw new Error('Unable to insert billing checkout organization')
		}

		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext(overrides?: {
		role?: string
		roles?: string[]
		stripeCustomerId?: string | null
		seatCount?: number
		seatCountError?: Error
	}) {
		const auth = createMockApiAuth({
			organizationId,
			workosOrganizationId: `workos_${organizationId}`,
			role: overrides?.role ?? 'admin',
			roles: overrides?.roles ?? ['admin'],
		})

		const createCheckoutSession = vi.fn(async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }))
		const stripe = createMockStripeService({
			createCheckoutSession,
		})
		const countActiveOrganizationMemberships = vi.fn(async () => {
			if (overrides?.seatCountError) {
				throw overrides.seatCountError
			}
			return overrides?.seatCount ?? 3
		})

		return {
			auth,
			stripe,
			createCheckoutSession,
			countActiveOrganizationMemberships,
			context: createMockApiContext({
				auth,
				services: {
					workos: createMockWorkosService({ countActiveOrganizationMemberships }),
					db,
					dbReadReplica: db,
					stripe,
				},
			}),
		}
	}

	test('creates checkout session for admin org with linked customer', async () => {
		const ctx = buildContext()

		const result = await call(
			createCheckoutSessionProcedure,
			{ checkoutAttemptId, client: 'cloud', promoCode: 'promo_123' },
			{ context: ctx.context },
		)

		expect(result.url).toBe('https://checkout.stripe.com/c/pay/cs_test_123')
		expect(ctx.createCheckoutSession).toHaveBeenCalledTimes(1)
		expect(ctx.createCheckoutSession).toHaveBeenCalledWith({
			checkoutAttemptId,
			customerId: stripeCustomerId,
			organizationId,
			client: 'cloud',
			quantity: 3,
			promoCode: 'promo_123',
		})
		expect(ctx.countActiveOrganizationMemberships).toHaveBeenCalledTimes(1)
	})

	test('fails when active WorkOS seat count cannot be loaded', async () => {
		const ctx = buildContext({ seatCountError: new Error('WorkOS unavailable') })

		await expect(
			call(createCheckoutSessionProcedure, { checkoutAttemptId, client: 'cloud' }, { context: ctx.context }),
		).rejects.toThrow()
		expect(ctx.createCheckoutSession).toHaveBeenCalledTimes(0)
	})

	test('rejects non-admin users', async () => {
		const ctx = buildContext({ role: '', roles: [] })

		await expect(
			call(createCheckoutSessionProcedure, { checkoutAttemptId, client: 'cloud' }, { context: ctx.context }),
		).rejects.toThrow()
	})

	test('rejects organizations without stripe_customer_id', async () => {
		const [orgWithoutCustomer] = await db
			.insert(organizations)
			.values({
				name: 'No Stripe Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: null,
			})
			.returning()

		if (!orgWithoutCustomer) {
			throw new Error('Unable to insert org without stripe customer')
		}

		const auth = createMockApiAuth({
			organizationId: orgWithoutCustomer.id,
			workosOrganizationId: `workos_${orgWithoutCustomer.id}`,
			role: 'admin',
			roles: ['admin'],
		})

		await expect(
			call(
				createCheckoutSessionProcedure,
				{ checkoutAttemptId, client: 'cloud' },
				{
					context: createMockApiContext({
						auth,
						services: {
							db,
							dbReadReplica: db,
							stripe: createMockStripeService({
								createCheckoutSession: vi.fn(async () => ({
									url: 'https://checkout.stripe.com/c/pay/cs_test_missing',
								})),
							}),
						},
					}),
				},
			),
		).rejects.toThrow()
	})
})
