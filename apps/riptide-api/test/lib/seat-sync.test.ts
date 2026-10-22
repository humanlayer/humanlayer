import { organizations } from '@humanlayer/db/tables/organizations'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { syncOrganizationSeatQuantity } from '../../src/lib/seat-sync'
import { StripeService } from '../../src/lib/stripe-service'
import { makeTestBillingKvRuntime } from '../fixtures/billing-kv-runtime'
import { createMockStripeBillingClient } from '../fixtures/mock-stripe-billing'
import { createMockWorkosService } from '../mocks/workos-service.mock'
import { createTestDb } from '../utils/test-db'

let db: PostgresJsDatabase
let cleanupTestDb: (() => Promise<void>) | undefined
const stripePrices = {
	billingKvRuntime: makeTestBillingKvRuntime(),
	proPriceId: 'price_pro',
	starterPriceId: 'price_starter',
}

beforeAll(async () => {
	const testDb = await createTestDb('seat_sync')
	cleanupTestDb = testDb.cleanup
	db = testDb.db
})

afterAll(async () => {
	await cleanupTestDb?.()
	cleanupTestDb = undefined
})

async function insertOrganization(input?: { stripeCustomerId?: string | null }) {
	const [organization] = await db
		.insert(organizations)
		.values({
			name: 'Seat Sync Org',
			workos_organization_id: 'workos_org_test',
			stripe_customer_id: input && 'stripeCustomerId' in input ? input.stripeCustomerId : 'cus_test',
		})
		.returning()

	if (!organization) {
		throw new Error('Failed to insert test organization')
	}

	return organization
}

function createWorkosCounter(input: { count?: number; error?: Error }) {
	const calls: Array<{ workosOrganizationId: string }> = []
	const service = createMockWorkosService({
		countActiveOrganizationMemberships: async (workosOrganizationId: string) => {
			calls.push({ workosOrganizationId })
			if (input.error) {
				throw input.error
			}
			return input.count ?? 1
		},
	})

	return { service, calls }
}

describe('syncOrganizationSeatQuantity', () => {
	test('counts active WorkOS memberships and sets Stripe quantity with prorations', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 3 })
		const stripeClient = createMockStripeBillingClient({ priceId: 'price_starter', quantity: 1 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		const result = await syncOrganizationSeatQuantity(
			{ organizationId: organization.id, reason: 'customer_force_sync' },
			{ workosService: workos.service, stripeService, db },
		)

		expect(result.seatCount).toBe(3)
		expect(result.subscriptionId).toBe('sub_test')
		expect(result.subscriptionItemId).toBe('si_test')
		expect(result.previousQuantity).toBe(1)
		expect(result.currentQuantity).toBe(3)
		expect(result.stripeQuantityChanged).toBe(true)
		expect(workos.calls).toEqual([{ workosOrganizationId: 'workos_org_test' }])
		expect((stripeClient as any).__test.subscriptionItemUpdates).toEqual([
			{
				subscriptionItemId: 'si_test',
				quantity: 3,
				prorationBehavior: 'create_prorations',
			},
		])
	})

	test('reports no quantity change when Stripe already has the current seat count', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 2 })
		const stripeClient = createMockStripeBillingClient({ priceId: 'price_pro', quantity: 2 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		const result = await syncOrganizationSeatQuantity(
			{ organizationId: organization.id, reason: 'admin_force_sync' },
			{ workosService: workos.service, stripeService, db },
		)

		expect(result.previousQuantity).toBe(2)
		expect(result.seatCount).toBe(2)
		expect(result.currentQuantity).toBe(2)
		expect(result.stripeQuantityChanged).toBe(false)
		expect((stripeClient as any).__test.subscriptionItemUpdates[0].quantity).toBe(2)
	})

	test('repairs a configured Enterprise item above one while preserving the active seat count', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 5 })
		const stripeClient = createMockStripeBillingClient({ priceId: 'price_enterprise', quantity: 4 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		const result = await syncOrganizationSeatQuantity(
			{ organizationId: organization.id, reason: 'workos_webhook' },
			{ workosService: workos.service, stripeService, db },
		)

		expect(result.seatCount).toBe(5)
		expect(result.previousQuantity).toBe(4)
		expect(result.currentQuantity).toBe(1)
		expect(result.stripeQuantityChanged).toBe(true)
		expect((stripeClient as any).__test.subscriptionItemUpdates[0]).toMatchObject({ quantity: 1 })
	})

	test('keeps a custom Enterprise item at one and still writes when unchanged', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 5 })
		const stripeClient = createMockStripeBillingClient({ priceId: 'price_enterprise_custom', quantity: 1 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		const result = await syncOrganizationSeatQuantity(
			{ organizationId: organization.id, reason: 'admin_force_sync' },
			{ workosService: workos.service, stripeService, db },
		)

		expect(result.seatCount).toBe(5)
		expect(result.previousQuantity).toBe(1)
		expect(result.currentQuantity).toBe(1)
		expect(result.stripeQuantityChanged).toBe(false)
		expect((stripeClient as any).__test.subscriptionItemUpdates[0]).toMatchObject({ quantity: 1 })
	})

	test('treats an unknown item price as fixed at one', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 3 })
		const stripeClient = createMockStripeBillingClient({ priceId: 'price_unknown', quantity: 2 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		const result = await syncOrganizationSeatQuantity(
			{ organizationId: organization.id, reason: 'customer_force_sync' },
			{ workosService: workos.service, stripeService, db },
		)

		expect(result.seatCount).toBe(3)
		expect(result.currentQuantity).toBe(1)
		expect((stripeClient as any).__test.subscriptionItemUpdates[0]).toMatchObject({ quantity: 1 })
	})

	test('throws when the organization has no current subscription item', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ count: 1 })
		const stripeClient = createMockStripeBillingClient({ includeSubscription: false })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		await expect(
			syncOrganizationSeatQuantity(
				{ organizationId: organization.id, reason: 'customer_force_sync' },
				{ workosService: workos.service, stripeService, db },
			),
		).rejects.toThrow(/No active Stripe subscription item/)
		expect(workos.calls).toEqual([])
		expect((stripeClient as any).__test.subscriptionItemUpdates).toEqual([])
	})

	test('throws when the organization is not linked to a Stripe customer', async () => {
		const organization = await insertOrganization({ stripeCustomerId: null })
		const workos = createWorkosCounter({ count: 1 })
		const stripeClient = createMockStripeBillingClient()
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		await expect(
			syncOrganizationSeatQuantity(
				{ organizationId: organization.id, reason: 'customer_force_sync' },
				{ workosService: workos.service, stripeService, db },
			),
		).rejects.toThrow(/not linked to Stripe billing/)
	})

	test('propagates WorkOS counting failures without updating Stripe quantity', async () => {
		const organization = await insertOrganization()
		const workos = createWorkosCounter({ error: new Error('WorkOS unavailable') })
		const stripeClient = createMockStripeBillingClient({ quantity: 1 })
		const stripeService = new StripeService(stripeClient, 'whsec_test', stripePrices)

		await expect(
			syncOrganizationSeatQuantity(
				{ organizationId: organization.id, reason: 'workos_webhook' },
				{ workosService: workos.service, stripeService, db },
			),
		).rejects.toThrow(/WorkOS unavailable/)
		expect((stripeClient as any).__test.subscriptionItemUpdates).toEqual([])
	})
})

describe('WorkosService-compatible seat counting contract', () => {
	test('uses active membership count supplied by the injectable WorkOS service', async () => {
		const workos = createWorkosCounter({ count: 4 })

		await expect(workos.service.countActiveOrganizationMemberships('workos_org_test')).resolves.toBe(4)
		expect(workos.calls).toEqual([{ workosOrganizationId: 'workos_org_test' }])
	})
})
