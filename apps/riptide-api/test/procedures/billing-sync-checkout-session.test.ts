import { randomUUID } from 'node:crypto'

import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { BillingAccessLive } from '../../src/effects/services/billing/billing-access-service-live'
import { syncCheckoutSessionProcedure } from '../../src/orpc/api/billing/sync-checkout-session'
import { strictStripeEffectLayer } from '../fixtures/strict-stripe-effect.fixture'
import { createMockApiAuth, createMockApiContext, createMockStripeService } from '../mocks'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.syncCheckoutSession', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('billing_sync_checkout_session')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Sync Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) {
			throw new Error('Unable to insert billing sync organization')
		}

		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeCache(overrides?: Partial<STRIPE_SUB_CACHE>): STRIPE_SUB_CACHE {
		return {
			customerId: stripeCustomerId,
			organizationId,
			subscriptionId: 'sub_sync_123',
			status: 'active',
			priceId: 'price_sync_123',
			currentPeriodEnd: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
			hasPaidInvoice: true,
			hasPaymentMethod: true,
			pastDueAt: null,
			syncedAt: Date.now(),
			...overrides,
		}
	}

	function buildContext(overrides?: { role?: string; roles?: string[]; cache?: STRIPE_SUB_CACHE }) {
		const auth = createMockApiAuth({
			organizationId,
			workosOrganizationId: `workos_${organizationId}`,
			role: overrides?.role ?? 'admin',
			roles: overrides?.roles ?? ['admin'],
		})

		const syncCustomerBillingToKv = vi.fn(({ customerId }: { customerId: string }) =>
			Effect.succeed({ ...(overrides?.cache ?? makeCache()), customerId }),
		)
		const stripe = createMockStripeService()
		const effectRuntime = createRuntimeWithTestPostgresLayer(db, {
			stripe: strictStripeEffectLayer({ syncCustomerBillingToKv }),
			billingAccess: BillingAccessLive,
		})

		return {
			auth,
			syncCustomerBillingToKv,
			context: createMockApiContext({
				auth,
				services: {
					db,
					dbReadReplica: db,
					stripe,
					effectRuntime,
				},
			}),
		}
	}

	test('syncs checkout session from stripe cache', async () => {
		const cache = makeCache({ status: 'trialing', syncedAt: Date.now() + 1000 })
		const ctx = buildContext({ cache })

		const result = await call(syncCheckoutSessionProcedure, {}, { context: ctx.context })

		expect(result.subscriptionStatus).toBe('trialing')
		expect(result.syncedAt).toBe(cache.syncedAt)
		expect(ctx.syncCustomerBillingToKv).toHaveBeenCalledTimes(1)
		expect(ctx.syncCustomerBillingToKv).toHaveBeenCalledWith({ customerId: stripeCustomerId })
	})

	test('rejects non-admin users', async () => {
		const ctx = buildContext({ role: '', roles: [] })

		await expect(call(syncCheckoutSessionProcedure, {}, { context: ctx.context })).rejects.toThrow()
	})

	test('rejects organizations without stripe_customer_id', async () => {
		const [orgWithoutCustomer] = await db
			.insert(organizations)
			.values({
				name: 'No Stripe Org for Sync',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: null,
			})
			.returning()

		if (!orgWithoutCustomer) {
			throw new Error('Unable to insert org without stripe customer for sync test')
		}

		const auth = createMockApiAuth({
			organizationId: orgWithoutCustomer.id,
			workosOrganizationId: `workos_${orgWithoutCustomer.id}`,
			role: 'admin',
			roles: ['admin'],
		})

		await expect(
			call(
				syncCheckoutSessionProcedure,
				{},
				{
					context: createMockApiContext({
						auth,
						services: {
							db,
							dbReadReplica: db,
							stripe: createMockStripeService(),
						},
					}),
				},
			),
		).rejects.toThrow()
	})
})
