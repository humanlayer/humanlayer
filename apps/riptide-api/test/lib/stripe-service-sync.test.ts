import { describe, expect, test } from 'vitest'

import { StripeService } from '../../src/lib/stripe-service'
import { makeTestBillingKvRuntime } from '../fixtures/billing-kv-runtime'
import { createMockStripeBillingClient } from '../fixtures/mock-stripe-billing'

const webhookSecret = 'whsec_phase_3_sync_test'
const billingKvRuntime = makeTestBillingKvRuntime()

describe('StripeService replay hardening', () => {
	test('createCheckoutSession builds server-owned API resync URL for Cloud', async () => {
		const previousApiOrigin = process.env.RIPTIDE_API_ORIGIN
		const previousAppOrigin = process.env.APP_ORIGIN
		const previousCloudOrigin = process.env.CLOUD_ORIGIN
		process.env.RIPTIDE_API_ORIGIN = 'https://api.example.test'
		process.env.APP_ORIGIN = 'https://app.example.test'
		process.env.CLOUD_ORIGIN = 'https://cloud.example.test'

		try {
			const customerId = 'cus_checkout_cloud'
			const organizationId = 'org_checkout_cloud'
			const checkoutAttemptId = '00000000-0000-4000-8000-000000000001'
			const mockStripe = createMockStripeBillingClient({ customerId, organizationId })
			const service = new StripeService(mockStripe, webhookSecret, {
				billingKvRuntime,
				proPriceId: 'price_pro',
				starterPriceId: 'price_starter',
			})

			await service.createCheckoutSession({
				checkoutAttemptId,
				customerId,
				organizationId,
				client: 'cloud',
				quantity: 2,
				promoCode: 'promo_123',
			})

			expect((mockStripe as any).__test.checkoutSessions[0]).toMatchObject({
				success_url:
					'https://api.example.test/billing/checkout/resync?session_id={CHECKOUT_SESSION_ID}&client=cloud',
				cancel_url: 'https://cloud.example.test/settings',
				metadata: {
					organizationId,
					internal_org_id: organizationId,
					organization_id: organizationId,
				},
			})
			expect((mockStripe as any).__test.checkoutSessions[0].metadata).not.toHaveProperty('return_client')
			expect((mockStripe as any).__test.checkoutSessionRequestOptions[0]).toEqual({
				idempotencyKey: `checkout:${organizationId}:${checkoutAttemptId}`,
			})
		} finally {
			process.env.RIPTIDE_API_ORIGIN = previousApiOrigin
			process.env.APP_ORIGIN = previousAppOrigin
			process.env.CLOUD_ORIGIN = previousCloudOrigin
		}
	})

	test('createProUpgradeCheckoutSession builds server-owned finalizer URL and no upgrade metadata', async () => {
		const previousApiOrigin = process.env.RIPTIDE_API_ORIGIN
		const previousAppOrigin = process.env.APP_ORIGIN
		const previousCloudOrigin = process.env.CLOUD_ORIGIN
		process.env.RIPTIDE_API_ORIGIN = 'https://api.example.test'
		process.env.APP_ORIGIN = 'https://app.example.test'
		process.env.CLOUD_ORIGIN = 'https://cloud.example.test'

		try {
			const customerId = 'cus_upgrade_native'
			const organizationId = 'org_upgrade_native'
			const checkoutAttemptId = '00000000-0000-4000-8000-000000000002'
			const mockStripe = createMockStripeBillingClient({ customerId, organizationId })
			const service = new StripeService(mockStripe, webhookSecret, {
				billingKvRuntime,
				proPriceId: 'price_pro',
				starterPriceId: 'price_starter',
			})

			await service.createProUpgradeCheckoutSession({
				checkoutAttemptId,
				customerId,
				organizationId,
				client: 'native',
				quantity: 1,
			})

			expect((mockStripe as any).__test.checkoutSessions[0]).toMatchObject({
				success_url:
					'https://api.example.test/billing/checkout/finalize-starter-to-pro-upgrade?session_id={CHECKOUT_SESSION_ID}&client=native',
				cancel_url: 'https://app.example.test/billing/return',
			})
			expect((mockStripe as any).__test.checkoutSessions[0].metadata).not.toHaveProperty('upgrade')
			expect((mockStripe as any).__test.checkoutSessions[0].metadata).not.toHaveProperty('return_client')
			expect((mockStripe as any).__test.checkoutSessionRequestOptions[0]).toEqual({
				idempotencyKey: `checkout-upgrade:${organizationId}:${checkoutAttemptId}`,
			})
		} finally {
			process.env.RIPTIDE_API_ORIGIN = previousApiOrigin
			process.env.APP_ORIGIN = previousAppOrigin
			process.env.CLOUD_ORIGIN = previousCloudOrigin
		}
	})

	test('ensureStarterSubscription creates an active non-trial subscription with the Starter price', async () => {
		const customerId = 'cus_starter_create'
		const mockStripe = createMockStripeBillingClient({
			customerId,
			includeSubscription: false,
		})
		const service = new StripeService(mockStripe, webhookSecret, {
			billingKvRuntime,
			proPriceId: 'price_pro',
			starterPriceId: 'price_starter',
		})

		const result = await service.ensureStarterSubscription({ customerId, quantity: 3 })

		expect(result).toEqual({ subscriptionId: `sub_created_${customerId}`, created: true })
		expect((mockStripe as any).__test.createdSubscriptions[0]).toEqual({
			customer: customerId,
			items: [{ price: 'price_starter', quantity: 3 }],
		})
		expect((mockStripe as any).__test.createdSubscriptions[0]).not.toHaveProperty('trial_period_days')
		expect((mockStripe as any).__test.createdSubscriptions[0]).not.toHaveProperty('trial_settings')
	})

	test('findCurrentSubscriptionItemForCustomer returns the selected item price ID', async () => {
		const mockStripe = createMockStripeBillingClient({ priceId: 'price_selected_item' })
		const service = new StripeService(mockStripe, webhookSecret, {
			billingKvRuntime,
			proPriceId: 'price_pro',
			starterPriceId: 'price_starter',
		})

		await expect(service.findCurrentSubscriptionItemForCustomer('cus_test')).resolves.toEqual({
			subscriptionId: 'sub_test',
			subscriptionItemId: 'si_test',
			priceId: 'price_selected_item',
			quantity: 1,
		})
	})

	test('downgradeProToStarter creates Starter before canceling Pro', async () => {
		const customerId = 'cus_downgrade_success'
		const organizationId = 'org_downgrade_success'
		const mockStripe = createMockStripeBillingClient({
			customerId,
			organizationId,
			paidInvoiceCount: 1,
			existingSubscriptions: [{ id: 'sub_pro_active', status: 'active', priceId: 'price_pro' }],
		})
		const service = new StripeService(mockStripe, webhookSecret, {
			billingKvRuntime,
			proPriceId: 'price_pro',
			starterPriceId: 'price_starter',
		})

		const result = await service.downgradeProToStarter({ customerId, organizationId, quantity: 2 })

		expect(result).toMatchObject({
			starterSubscriptionId: `sub_created_${customerId}`,
			starterCreated: true,
			canceledProSubscriptionId: 'sub_pro_active',
		})
		expect((mockStripe as any).__test.createdSubscriptions[0]).toEqual({
			customer: customerId,
			items: [{ price: 'price_starter', quantity: 2 }],
		})
		expect((mockStripe as any).__test.subscriptionCancellations).toEqual(['sub_pro_active'])
		expect((mockStripe as any).__test.operationLog.indexOf('subscriptions.create')).toBeLessThan(
			(mockStripe as any).__test.operationLog.indexOf('subscriptions.cancel'),
		)
	})

	test('downgradeProToStarter does not cancel Pro when Starter creation fails', async () => {
		const customerId = 'cus_downgrade_starter_failure'
		const organizationId = 'org_downgrade_starter_failure'
		const mockStripe = createMockStripeBillingClient({
			customerId,
			organizationId,
			paidInvoiceCount: 1,
			subscriptionCreateError: new Error('starter create failed'),
			existingSubscriptions: [{ id: 'sub_pro_active', status: 'active', priceId: 'price_pro' }],
		})
		const service = new StripeService(mockStripe, webhookSecret, {
			billingKvRuntime,
			proPriceId: 'price_pro',
			starterPriceId: 'price_starter',
		})

		await expect(service.downgradeProToStarter({ customerId, organizationId, quantity: 2 })).rejects.toThrow(
			/starter create failed/i,
		)
		expect((mockStripe as any).__test.subscriptionCancellations).toEqual([])
		expect((mockStripe as any).__test.operationLog).not.toContain('subscriptions.cancel')
	})
})
