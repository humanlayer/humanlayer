import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { BillingAccessLive } from '../../src/effects/services/billing/billing-access-service-live'
import { applyPromotionCodeProcedure } from '../../src/orpc/api/billing/apply-promotion-code'
import { strictStripeEffectLayer } from '../fixtures/strict-stripe-effect.fixture'
import { createMockApiAuth, createMockApiContext, createMockStripeService } from '../mocks'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.applyPromotionCode', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let workosOrganizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('billing_apply_promotion_code')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		workosOrganizationId = `workos_${randomUUID()}`
		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Promo Org',
				workos_organization_id: workosOrganizationId,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) {
			throw new Error('Unable to insert billing promo organization')
		}

		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext(overrides?: {
		organizationId?: string
		role?: string
		roles?: string[]
		subscription?: {
			subscriptionId: string
			subscriptionItemId: string
			priceId: string
			quantity: number | null
		} | null
		promotionCode?: { id: string; code: string } | null
		applyError?: Error
	}) {
		const auth = createMockApiAuth({
			organizationId: overrides?.organizationId ?? organizationId,
			workosOrganizationId,
			role: overrides?.role ?? 'admin',
			roles: overrides?.roles ?? ['admin'],
		})

		const findCurrentSubscriptionItemForCustomer = vi.fn(async () =>
			overrides?.subscription === undefined
				? { subscriptionId: 'sub_123', subscriptionItemId: 'si_123', priceId: 'price_pro_test', quantity: 2 }
				: overrides.subscription,
		)
		const resolvePromotionCode = vi.fn(async () =>
			overrides?.promotionCode === undefined ? { id: 'promo_123', code: 'SAVE20' } : overrides.promotionCode,
		)
		const applyPromotionCode = vi.fn(async () => {
			if (overrides?.applyError) {
				throw overrides.applyError
			}

			return { subscriptionId: 'sub_123', promotionCodeId: 'promo_123', discountId: 'di_123' }
		})
		const syncCustomerBillingToKv = vi.fn((_input: { customerId: string }) =>
			Effect.succeed({
				customerId: stripeCustomerId,
				organizationId,
				subscriptionId: 'sub_123',
				status: 'active' as const,
				priceId: 'price_pro',
				currentPeriodEnd: null,
				hasPaidInvoice: true,
				hasPaymentMethod: true,
				pastDueAt: null,
				syncedAt: Date.now(),
			}),
		)
		const effectRuntime = createRuntimeWithTestPostgresLayer(db, {
			stripe: strictStripeEffectLayer({ syncCustomerBillingToKv }),
			billingAccess: BillingAccessLive,
		})

		return {
			findCurrentSubscriptionItemForCustomer,
			resolvePromotionCode,
			applyPromotionCode,
			syncCustomerBillingToKv,
			context: createMockApiContext({
				auth,
				services: {
					db,
					dbReadReplica: db,
					stripe: createMockStripeService({
						findCurrentSubscriptionItemForCustomer,
						resolvePromotionCode,
						applyPromotionCode,
					}),
					effectRuntime,
				},
			}),
		}
	}

	test('applies a promotion code for an admin org with an existing subscription', async () => {
		const ctx = buildContext()

		const result = await call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })

		expect(result).toEqual({
			subscriptionId: 'sub_123',
			promotionCodeId: 'promo_123',
			code: 'SAVE20',
			discountId: 'di_123',
		})
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledWith(stripeCustomerId)
		expect(ctx.resolvePromotionCode).toHaveBeenCalledWith('SAVE20')
		expect(ctx.applyPromotionCode).toHaveBeenCalledWith({ subscriptionId: 'sub_123', promotionCodeId: 'promo_123' })
		expect(ctx.syncCustomerBillingToKv).toHaveBeenCalledWith({ customerId: stripeCustomerId })
	})

	test('rejects non-admin users', async () => {
		const ctx = buildContext({ role: 'member', roles: ['member'] })

		await expect(call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })).rejects.toThrow()
		expect(ctx.resolvePromotionCode).toHaveBeenCalledTimes(0)
	})

	test('rejects organizations without stripe_customer_id', async () => {
		const [orgWithoutCustomer] = await db
			.insert(organizations)
			.values({
				name: 'No Stripe Promo Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: null,
			})
			.returning()

		if (!orgWithoutCustomer) {
			throw new Error('Unable to insert org without stripe customer')
		}

		const ctx = buildContext({ organizationId: orgWithoutCustomer.id })

		try {
			await call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })
			expect.unreachable('Should have thrown BAD_REQUEST')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BAD_REQUEST')
			expect(error.data.message).toMatch(/not linked/i)
		}
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledTimes(0)
	})

	test('treats malformed defined stripe_customer_id as internal organization data corruption', async () => {
		const [orgWithMalformedCustomer] = await db
			.insert(organizations)
			.values({
				name: 'Malformed Stripe Promo Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: 'sub_123',
			})
			.returning()

		if (!orgWithMalformedCustomer) {
			throw new Error('Unable to insert org with malformed stripe customer')
		}

		const ctx = buildContext({ organizationId: orgWithMalformedCustomer.id })

		try {
			await call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toMatch(/invalid billing organization data/i)
		}
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledTimes(0)
	})

	test('rejects when no current subscription exists', async () => {
		const ctx = buildContext({ subscription: null })

		try {
			await call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })
			expect.unreachable('Should have thrown BAD_REQUEST')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('BAD_REQUEST')
			expect(error.data.message).toMatch(/no active stripe subscription/i)
		}
		expect(ctx.resolvePromotionCode).toHaveBeenCalledTimes(0)
	})

	test('rejects invalid promotion codes without applying or syncing', async () => {
		const ctx = buildContext({ promotionCode: null })

		try {
			await call(applyPromotionCodeProcedure, { code: 'NOPE' }, { context: ctx.context })
			expect.unreachable('Should have thrown INVALID_PROMO_CODE')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVALID_PROMO_CODE')
			expect(error.data.message).toBe('This promo code is not valid.')
		}
		expect(ctx.applyPromotionCode).toHaveBeenCalledTimes(0)
		expect(ctx.syncCustomerBillingToKv).toHaveBeenCalledTimes(0)
	})

	test('does not sync Stripe KV state after apply failures', async () => {
		const ctx = buildContext({ applyError: new Error('Stripe update failed') })

		try {
			await call(applyPromotionCodeProcedure, { code: 'SAVE20' }, { context: ctx.context })
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toBe('Failed to apply promotion code')
		}
		expect(ctx.syncCustomerBillingToKv).toHaveBeenCalledTimes(0)
	})
})
