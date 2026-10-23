import { randomUUID } from 'node:crypto'

import type { STRIPE_SUB_CACHE } from '@humanlayer/billing/types'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { downgradeToStarterProcedure } from '../../src/orpc/api/billing/downgrade-to-starter'
import { billingKvLayerFromTestService } from '../fixtures/billing-kv-runtime'
import { createBillingLifecycleFixture } from '../fixtures/billing-lifecycle'
import {
	billingAccessLayer,
	createMockApiAuth,
	createMockApiContext,
	createMockStripeService,
	createMockWorkosService,
} from '../mocks'
import { createDefaultTestEffectRuntime } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.downgradeToStarter', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let unlinkedOrganizationId: string
	let workosOrganizationId: string
	let stripeCustomerId: string

	const proPriceId = 'price_pro_downgrade_test'
	const starterPriceId = 'price_starter_downgrade_test'

	beforeAll(async () => {
		const testDb = await createTestDb('billing_downgrade_to_starter')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		workosOrganizationId = `workos_downgrade_${randomUUID()}`
		stripeCustomerId = `cus_downgrade_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Downgrade Org',
				workos_organization_id: workosOrganizationId,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()
		if (!organization) throw new Error('Unable to insert downgrade organization')
		organizationId = organization.id

		const [unlinkedOrganization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Downgrade Unlinked Org',
				workos_organization_id: `workos_downgrade_unlinked_${randomUUID()}`,
			})
			.returning()
		if (!unlinkedOrganization) throw new Error('Unable to insert unlinked downgrade organization')
		unlinkedOrganizationId = unlinkedOrganization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function cache(overrides?: Partial<STRIPE_SUB_CACHE>): STRIPE_SUB_CACHE {
		return {
			customerId: stripeCustomerId,
			organizationId,
			subscriptionId: 'sub_pro_existing',
			status: 'active',
			priceId: proPriceId,
			currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
			hasPaidInvoice: true,
			hasPaymentMethod: true,
			pastDueAt: null,
			syncedAt: Date.now(),
			...overrides,
		}
	}

	async function buildContext(input?: {
		organization?: string
		kvCache?: STRIPE_SUB_CACHE | null
		activeMembers?: number
		pendingInvitations?: number
		stripeOverrides?: Parameters<typeof createMockStripeService>[0]
	}) {
		const billingFixture = await createBillingLifecycleFixture({ organizationId, customerId: stripeCustomerId })
		const kv = billingFixture.kv
		if (input?.kvCache !== undefined) {
			if (input.kvCache) {
				await billingFixture.seedCache(input.kvCache)
			}
		} else {
			await billingFixture.seedCache(cache())
		}

		const countActiveOrganizationMemberships = vi.fn(async () => input?.activeMembers ?? 2)
		const countPendingInvitations = vi.fn(async () => input?.pendingInvitations ?? 1)
		const findActivePaidProSubscription = vi.fn(async () => ({ subscriptionId: 'sub_pro_existing' }))
		const findNonCanceledStarterSubscription = vi.fn(async () => null)
		const downgradeProToStarter = vi.fn(async () => ({
			starterSubscriptionId: 'sub_starter_existing',
			starterCreated: true,
			canceledProSubscriptionId: 'sub_pro_existing',
			cache: cache({
				subscriptionId: 'sub_starter_existing',
				priceId: starterPriceId,
			}),
		}))
		const refreshStripeBillingCache = vi.fn(async () =>
			cache({ subscriptionId: 'sub_starter_existing', priceId: starterPriceId }),
		)

		return {
			kv,
			countActiveOrganizationMemberships,
			countPendingInvitations,
			findActivePaidProSubscription,
			findNonCanceledStarterSubscription,
			downgradeProToStarter,
			context: createMockApiContext({
				auth: createMockApiAuth({
					organizationId: input?.organization ?? organizationId,
					workosOrganizationId,
					role: 'admin',
					roles: ['admin'],
				}),
				services: {
					workos: createMockWorkosService({ countActiveOrganizationMemberships, countPendingInvitations }),
					db,
					dbReadReplica: db,
					effectRuntime: createDefaultTestEffectRuntime({
						billingKv: billingKvLayerFromTestService(kv),
						billingAccess: billingAccessLayer({ refreshStripeBillingCache }),
					}),
					stripe: createMockStripeService({
						prices: { pro: proPriceId, starter: starterPriceId },
						isProPriceId: (priceId) => priceId === proPriceId,
						isStarterPriceId: (priceId) => priceId === starterPriceId,
						findActivePaidProSubscription,
						findNonCanceledStarterSubscription,
						downgradeProToStarter,
						...input?.stripeOverrides,
					}),
				},
			}),
		}
	}

	test('downgrades eligible Pro organizations and returns capacity plus subscription ids', async () => {
		const ctx = await buildContext()

		const result = await call(downgradeToStarterProcedure, {}, { context: ctx.context })

		expect(result).toEqual({
			success: true,
			activeMemberCount: 2,
			pendingInvitationCount: 1,
			freeCapacity: 3,
			starterSubscriptionId: 'sub_starter_existing',
			canceledProSubscriptionId: 'sub_pro_existing',
			subscriptionStatus: 'active',
		})
		expect(ctx.countActiveOrganizationMemberships).toHaveBeenCalledWith(workosOrganizationId)
		expect(ctx.countPendingInvitations).toHaveBeenCalledWith({ workosOrganizationId })
		expect(ctx.findActivePaidProSubscription).toHaveBeenCalledWith({ customerId: stripeCustomerId })
		expect(ctx.downgradeProToStarter).toHaveBeenCalledWith({
			customerId: stripeCustomerId,
			organizationId,
			quantity: 2,
		})
	})

	test('treats an already completed Stripe downgrade as success and syncs cache', async () => {
		const findActivePaidProSubscription = vi.fn(async () => null)
		const findNonCanceledStarterSubscription = vi.fn(async () => ({ subscriptionId: 'sub_starter_existing' }))
		const ctx = await buildContext({
			activeMembers: 3,
			pendingInvitations: 0,
			stripeOverrides: {
				findActivePaidProSubscription,
				findNonCanceledStarterSubscription,
			},
		})

		const result = await call(downgradeToStarterProcedure, {}, { context: ctx.context })

		expect(result).toMatchObject({
			success: true,
			activeMemberCount: 3,
			pendingInvitationCount: 0,
			freeCapacity: 3,
			starterSubscriptionId: 'sub_starter_existing',
			canceledProSubscriptionId: null,
			subscriptionStatus: 'active',
		})
		expect(findActivePaidProSubscription).toHaveBeenCalledWith({ customerId: stripeCustomerId })
		expect(findNonCanceledStarterSubscription).toHaveBeenCalledWith({ customerId: stripeCustomerId })
		expect(ctx.downgradeProToStarter).toHaveBeenCalledTimes(0)
	})

	test('rejects over-capacity organizations before calling Stripe downgrade', async () => {
		const ctx = await buildContext({ activeMembers: 3, pendingInvitations: 1 })

		try {
			await call(downgradeToStarterProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown CAPACITY_EXCEEDED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('CAPACITY_EXCEEDED')
			expect(error.data).toMatchObject({ currentActiveSeats: 3, pendingInvitations: 1, freeCapacity: 3 })
		}
		expect(ctx.findActivePaidProSubscription).toHaveBeenCalledTimes(0)
		expect(ctx.downgradeProToStarter).toHaveBeenCalledTimes(0)
	})

	test('rejects organizations without a Stripe customer', async () => {
		const ctx = await buildContext({ organization: unlinkedOrganizationId })

		try {
			await call(downgradeToStarterProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown BAD_REQUEST')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BAD_REQUEST')
			expect(error.data.message).toMatch(/not linked to stripe billing/i)
		}
	})

	test('rejects organizations without synced subscription cache', async () => {
		const ctx = await buildContext({ kvCache: null })

		try {
			await call(downgradeToStarterProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown BAD_REQUEST')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BAD_REQUEST')
			expect(error.data.message).toMatch(/billing state is not synced/i)
		}
	})

	test('rejects non-Pro organizations', async () => {
		const ctx = await buildContext({ kvCache: cache({ priceId: starterPriceId }) })

		try {
			await call(downgradeToStarterProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown BAD_REQUEST')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BAD_REQUEST')
			expect(error.data.message).toMatch(/only pro organizations/i)
		}
	})

	test('surfaces Starter creation failures without reporting a completed downgrade', async () => {
		const downgradeProToStarter = vi.fn(async () => {
			throw new Error('starter creation failed')
		})
		const ctx = await buildContext({ stripeOverrides: { downgradeProToStarter } })

		try {
			await call(downgradeToStarterProcedure, {}, { context: ctx.context })
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toMatch(/failed to downgrade to starter/i)
		}
		expect(downgradeProToStarter).toHaveBeenCalledTimes(1)
	})
})
