import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { hasCommand } from './fixtures/cli'
import { createStripeFixture } from './fixtures/stripe'

const CI = !!process.env.CI
const canRunLiveStripe = !!process.env.STRIPE_SECRET_KEY && hasCommand('stripe')

describe.skipIf(CI || !canRunLiveStripe)('stripe promotion codes on trial subscriptions', () => {
	let fixture: Awaited<ReturnType<typeof createStripeFixture>>

	beforeAll(async () => {
		fixture = await createStripeFixture()
	})

	afterAll(async () => {
		await fixture.shutdown()
	})

	test('applies a promotion code to a trialing subscription without a default payment method', async () => {
		const clock = await fixture.createTestClock(`promotion-code-${Date.now()}`)
		await fixture.waitForClockReady(clock.id)
		const customer = await fixture.createClockedCustomer(clock.id)
		const price = await fixture.stripe.prices.create({
			currency: 'usd',
			unit_amount: 1000,
			recurring: { interval: 'month' },
			product_data: { name: `Promotion code learning test ${Date.now()}` },
		})
		const coupon = await fixture.stripe.coupons.create({
			percent_off: 25,
			duration: 'once',
			name: `Learning coupon ${Date.now()}`,
		})
		const promo = await fixture.stripe.promotionCodes.create({
			promotion: { type: 'coupon', coupon: coupon.id },
			code: `LEARN${Date.now()}`,
		})
		const subscription = await fixture.stripe.subscriptions.create({
			customer: customer.id,
			items: [{ price: price.id }],
			trial_period_days: 14,
			trial_settings: {
				end_behavior: {
					missing_payment_method: 'cancel',
				},
			},
		})

		await fixture.stripe.subscriptions.update(subscription.id, {
			discounts: [{ promotion_code: promo.id }],
		})

		const retrieved = await fixture.stripe.subscriptions.retrieve(subscription.id, {
			expand: ['discounts', 'discounts.promotion_code', 'discounts.source.coupon'],
		})
		const discount = (retrieved as any).discounts?.[0]
		const promotionCode = discount?.promotion_code
		const sourceCoupon = discount?.source?.coupon

		expect(retrieved.status).toBe('trialing')
		expect(retrieved.default_payment_method).toBeNull()
		expect(promotionCode?.id).toBe(promo.id)
		expect(sourceCoupon?.id).toBe(coupon.id)

		const replacementCoupon = await fixture.stripe.coupons.create({
			percent_off: 50,
			duration: 'once',
			name: `Repl coupon ${Date.now()}`,
		})
		const replacementPromo = await fixture.stripe.promotionCodes.create({
			promotion: { type: 'coupon', coupon: replacementCoupon.id },
			code: `REPL${Date.now()}`,
		})

		await fixture.stripe.subscriptions.update(subscription.id, {
			discounts: [{ promotion_code: replacementPromo.id }],
		})

		const replaced = await fixture.stripe.subscriptions.retrieve(subscription.id, {
			expand: ['discounts', 'discounts.promotion_code', 'discounts.source.coupon'],
		})
		const replacementDiscount = (replaced as any).discounts?.[0]

		expect(replacementDiscount?.promotion_code?.id).toBe(replacementPromo.id)
		expect(replacementDiscount?.source?.coupon?.id).toBe(replacementCoupon.id)
	}, 30000)
})
