import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { resyncSeatsProcedure } from '../../src/orpc/api/billing/resync-seats'
import { createMockApiAuth, createMockApiContext, createMockStripeService, createMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.resyncSeats', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let workosOrganizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('billing_resync_seats')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		workosOrganizationId = `workos_${randomUUID()}`
		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Resync Org',
				workos_organization_id: workosOrganizationId,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) {
			throw new Error('Unable to insert billing resync organization')
		}

		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext(overrides?: { role?: string; roles?: string[]; syncError?: Error }) {
		const auth = createMockApiAuth({
			organizationId,
			workosOrganizationId,
			role: overrides?.role ?? 'admin',
			roles: overrides?.roles ?? ['admin'],
		})

		const countActiveOrganizationMemberships = vi.fn(async () => {
			if (overrides?.syncError) {
				throw overrides.syncError
			}
			return 4
		})
		const findCurrentSubscriptionItemForCustomer = vi.fn(async () => ({
			subscriptionId: 'sub_123',
			subscriptionItemId: 'si_123',
			priceId: 'price_pro_test',
			quantity: 2,
		}))
		const updateSubscriptionItemQuantity = vi.fn(async () => ({ subscriptionItemId: 'si_123', quantity: 4 }))

		return {
			countActiveOrganizationMemberships,
			findCurrentSubscriptionItemForCustomer,
			updateSubscriptionItemQuantity,
			context: createMockApiContext({
				auth,
				services: {
					workos: createMockWorkosService({ countActiveOrganizationMemberships }),
					db,
					dbReadReplica: db,
					stripe: createMockStripeService({
						findCurrentSubscriptionItemForCustomer,
						updateSubscriptionItemQuantity,
					}),
				},
			}),
		}
	}

	test('requires organization admin authorization', async () => {
		const ctx = buildContext({ role: 'member', roles: ['member'] })

		await expect(call(resyncSeatsProcedure, {}, { context: ctx.context })).rejects.toThrow()
		expect(ctx.countActiveOrganizationMemberships).toHaveBeenCalledTimes(0)
	})

	test('returns observed seat sync result', async () => {
		const ctx = buildContext()

		const result = await call(resyncSeatsProcedure, {}, { context: ctx.context })

		expect(result).toEqual({
			seatCount: 4,
			subscriptionId: 'sub_123',
			subscriptionItemId: 'si_123',
			stripeQuantityChanged: true,
		})
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledWith(stripeCustomerId)
		expect(ctx.countActiveOrganizationMemberships).toHaveBeenCalledWith(workosOrganizationId)
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_123',
			quantity: 4,
			prorationBehavior: 'create_prorations',
		})
	})

	test('surfaces sync failures', async () => {
		const ctx = buildContext({ syncError: new Error('WorkOS unavailable') })

		try {
			await call(resyncSeatsProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toBe('Failed to re-sync seat count')
		}
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledTimes(0)
	})
})
