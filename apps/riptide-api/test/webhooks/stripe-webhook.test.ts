import { describe, expect, test } from 'vitest'

import {
	createStripeWebhookFixture,
	serializeWebhook,
	signWebhook,
	trackedWebhookEvent,
	untrackedWebhookEvent,
} from '../fixtures/stripe-webhook.fixture'

describe('POST /webhooks/stripe', () => {
	test('A correctly signed tracked event should synchronize its customer cache', async () => {
		const fixture = await createStripeWebhookFixture()
		const body = serializeWebhook(trackedWebhookEvent())
		const signature = await signWebhook(body)

		const response = await fixture.request(body, signature)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true })
		expect(await fixture.cacheForTrackedCustomer()).toMatchObject({
			subscriptionId: 'sub_webhook',
			status: 'active',
		})
	})

	test('A semantically identical payload with different signed bytes should be rejected before synchronization', async () => {
		const fixture = await createStripeWebhookFixture()
		const signedBody = serializeWebhook(trackedWebhookEvent(), true)
		const signature = await signWebhook(signedBody)
		const transmittedBody = serializeWebhook(trackedWebhookEvent())

		const response = await fixture.request(transmittedBody, signature)

		expect(response.status).toBe(400)
		expect(await fixture.cacheForTrackedCustomer()).toBeNull()
	})

	test('A correctly signed untracked event should acknowledge without synchronizing', async () => {
		const fixture = await createStripeWebhookFixture()
		const body = serializeWebhook(untrackedWebhookEvent())
		const signature = await signWebhook(body)

		const response = await fixture.request(body, signature)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true })
		expect(await fixture.cacheForTrackedCustomer()).toBeNull()
	})

	test('A tracked event whose billing synchronization fails should return 500', async () => {
		const fixture = await createStripeWebhookFixture({ failSync: true })
		const body = serializeWebhook(trackedWebhookEvent())
		const signature = await signWebhook(body)

		const response = await fixture.request(body, signature)

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({ error: 'Stripe webhook processing failed' })
	})
})
