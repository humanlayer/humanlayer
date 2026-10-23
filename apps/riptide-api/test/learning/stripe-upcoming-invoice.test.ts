import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { hasCommand } from './fixtures/cli'
import { createStripeFixture } from './fixtures/stripe'

const CI = !!process.env.CI
const canRunLiveStripe = !!process.env.STRIPE_SECRET_KEY && hasCommand('stripe')

describe.skipIf(CI || !canRunLiveStripe)('stripe upcoming invoices for trial subscriptions', () => {
	let fixture: Awaited<ReturnType<typeof createStripeFixture>>

	beforeAll(async () => {
		fixture = await createStripeFixture()
	})

	afterAll(async () => {
		await fixture.shutdown()
	})

	test('documents upcoming invoice behavior for trialing subscriptions', async () => {
		const clock = await fixture.createTestClock(`upcoming-invoice-${Date.now()}`)
		await fixture.waitForClockReady(clock.id)
		const customer = await fixture.createClockedCustomer(clock.id)
		const price = await fixture.stripe.prices.create({
			currency: 'usd',
			unit_amount: 1000,
			recurring: { interval: 'month' },
			product_data: { name: `Upcoming invoice learning test ${Date.now()}` },
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

		expect(subscription.status).toBe('trialing')
		expect(subscription.default_payment_method).toBeNull()
		await expect(fixture.stripe.invoices.createPreview({ subscription: subscription.id })).rejects.toMatchObject({
			code: 'invoice_upcoming_none',
		})

		const paidCustomer = await fixture.createClockedCustomer(clock.id)
		const paymentMethod = await fixture.stripe.paymentMethods.create({
			type: 'card',
			card: { token: 'tok_visa' },
		})
		await fixture.stripe.paymentMethods.attach(paymentMethod.id, { customer: paidCustomer.id })
		await fixture.stripe.customers.update(paidCustomer.id, {
			invoice_settings: { default_payment_method: paymentMethod.id },
		})
		const paidSubscription = await fixture.stripe.subscriptions.create({
			customer: paidCustomer.id,
			items: [{ price: price.id }],
			trial_period_days: 14,
			trial_settings: {
				end_behavior: {
					missing_payment_method: 'cancel',
				},
			},
		})
		const upcoming = await fixture.stripe.invoices.createPreview({ subscription: paidSubscription.id })

		expect(paidSubscription.status).toBe('trialing')
		expect(upcoming.currency).toBe('usd')
		expect(upcoming.amount_due).toBeGreaterThanOrEqual(0)

		const coupon = await fixture.stripe.coupons.create({
			percent_off: 25,
			duration: 'once',
			name: `Upcoming invoice coupon ${Date.now()}`,
		})
		const promo = await fixture.stripe.promotionCodes.create({
			promotion: { type: 'coupon', coupon: coupon.id },
			code: `UPCOMING${Date.now()}`,
		})

		await fixture.stripe.subscriptions.update(paidSubscription.id, {
			discounts: [{ promotion_code: promo.id }],
		})

		const discountedUpcoming = await fixture.stripe.invoices.createPreview({ subscription: paidSubscription.id })

		expect(discountedUpcoming.currency).toBe('usd')
		expect(discountedUpcoming.amount_due).toBeLessThanOrEqual(upcoming.amount_due)
	}, 30000)
})
