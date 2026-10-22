import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer } from 'effect'
import { afterAll, beforeAll } from 'vitest'

import { BillingCheckoutCompletionServiceLive } from '../../src/effects/services/billing-checkout-completion/billing-checkout-completion.live'
import { BillingCheckoutCompletionService } from '../../src/effects/services/billing-checkout-completion/billing-checkout-completion.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import {
	checkoutSessionResponse,
	makeStripeTestLayer,
	stripeErrorResponse,
	stripeResponse,
	subscriptionResponse,
} from '../fixtures/effect-stripe'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

let db: PostgresJsDatabase
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
	const testDb = await createTestDb('billing_checkout_completion_live_stripe')
	db = testDb.db
	cleanup = testDb.cleanup
}, 60000)

afterAll(async () => cleanup?.(), 30000)

describe('BillingCheckoutCompletionService', () => {
	it.effect(
		'BillingCheckoutCompletionService should cancel Starter before persisting Pro billing state',
		({ expect }) => {
			const fixture = makeStripeTestLayer({
				postgresLayer: PostgresDbLive(db),
				responses: [
					stripeResponse(
						checkoutSessionResponse({
							id: 'cs_upgrade',
							customerId: 'cus_upgrade',
							subscriptionId: 'sub_pro',
						}),
					),
					stripeResponse(subscriptionResponse({ id: 'sub_pro', customerId: 'cus_upgrade' })),
					stripeResponse({
						object: 'list',
						has_more: false,
						data: [
							subscriptionResponse({
								id: 'sub_starter',
								customerId: 'cus_upgrade',
								priceId: 'price_starter',
							}),
							subscriptionResponse({ id: 'sub_pro', customerId: 'cus_upgrade', created: 2 }),
						],
					}),
					stripeResponse(
						subscriptionResponse({
							id: 'sub_starter',
							customerId: 'cus_upgrade',
							priceId: 'price_starter',
							status: 'canceled',
						}),
					),
					stripeResponse({
						object: 'list',
						has_more: false,
						data: [subscriptionResponse({ id: 'sub_pro', customerId: 'cus_upgrade' })],
					}),
					stripeResponse({
						object: 'list',
						data: [
							{
								id: 'in_paid',
								object: 'invoice',
								status: 'paid',
								customer: 'cus_upgrade',
								subscription: 'sub_pro',
							},
						],
					}),
				],
			})
			return Effect.gen(function* () {
				const organizationId = yield* insertOrganization('cus_upgrade')
				const completion = yield* BillingCheckoutCompletionService
				const redirect = yield* completion.finalizeStarterToProUpgradeFromRedirect({
					url: 'https://api.test/callback?session_id=cs_upgrade&client=ui',
				})
				const persisted = yield* Effect.promise(() => fixture.kv.getSubscriptionCache('cus_upgrade'))

				expect(redirect.redirectUrl).toBe(
					'https://app.example.test/settings/billing?billing=starter_to_pro_finalized',
				)
				expect(fixture.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual(
					[
						'GET /v1/checkout/sessions/cs_upgrade',
						'GET /v1/subscriptions/sub_pro',
						'GET /v1/subscriptions',
						'DELETE /v1/subscriptions/sub_starter',
						'GET /v1/subscriptions',
						'GET /v1/invoices',
					],
				)
				expect(persisted).toMatchObject({ organizationId, subscriptionId: 'sub_pro', priceId: 'price_pro' })
			}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
		},
	)

	it.effect('BillingCheckoutCompletionService should not cancel Starter for an incomplete checkout', ({ expect }) => {
		const fixture = makeStripeTestLayer({
			responses: [stripeResponse(checkoutSessionResponse({ id: 'cs_open', status: 'open' }))],
		})
		return Effect.gen(function* () {
			const completion = yield* BillingCheckoutCompletionService
			const redirect = yield* completion.finalizeStarterToProUpgradeFromRedirect({
				url: 'https://api.test/callback?session_id=cs_open&client=ui',
			})

			expect(redirect.redirectUrl).toContain('billing_error=checkout_invalid_session')
			expect(fixture.requests).toHaveLength(1)
			expect(fixture.requests.some((request) => request.method === 'DELETE')).toBe(false)
		}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
	})

	it.effect('BillingCheckoutCompletionService should redirect safely when Stripe is unavailable', ({ expect }) => {
		const fixture = makeStripeTestLayer({ responses: [stripeErrorResponse(503, 'req_unavailable', 'api_error')] })
		return Effect.gen(function* () {
			const completion = yield* BillingCheckoutCompletionService
			const redirect = yield* completion.finalizeStarterToProUpgradeFromRedirect({
				url: 'https://api.test/callback?session_id=cs_unavailable&client=cloud',
			})

			expect(redirect.redirectUrl).toBe('https://cloud.example.test/settings?billing_error=checkout_unavailable')
			expect(fixture.requests).toHaveLength(1)
		}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
	})

	it.effect('BillingCheckoutCompletionService should redirect safely for a malformed callback URL', ({ expect }) => {
		const fixture = makeStripeTestLayer({ responses: [] })
		return Effect.gen(function* () {
			const completion = yield* BillingCheckoutCompletionService
			const redirect = yield* completion.resyncFromCheckoutRedirect({ url: 'not a valid URL' })

			expect(redirect.redirectUrl).toBe('https://cloud.example.test/settings?billing_error=checkout_unavailable')
			expect(fixture.requests).toHaveLength(0)
		}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
	})

	it.effect('BillingCheckoutCompletionService should contain defects during completion', ({ expect }) => {
		const fixture = makeStripeTestLayer({ responses: [] })
		return Effect.gen(function* () {
			const completion = yield* BillingCheckoutCompletionService
			const redirect = yield* completion.resyncFromCheckoutRedirect({
				url: 'https://api.test/callback?session_id=cs_defect&client=cloud',
			})

			expect(redirect.redirectUrl).toBe('https://cloud.example.test/settings?billing_error=checkout_unavailable')
			expect(fixture.requests).toHaveLength(1)
		}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
	})

	it.effect(
		'BillingCheckoutCompletionService should not cancel Starter for a missing Pro subscription',
		({ expect }) => {
			const fixture = makeStripeTestLayer({
				responses: [
					stripeResponse(
						checkoutSessionResponse({
							id: 'cs_missing_pro',
							customerId: 'cus_missing',
							subscriptionId: 'sub_missing',
						}),
					),
					stripeErrorResponse(404, 'req_missing_pro', 'resource_missing'),
				],
			})
			return Effect.gen(function* () {
				const completion = yield* BillingCheckoutCompletionService
				const redirect = yield* completion.finalizeStarterToProUpgradeFromRedirect({
					url: 'https://api.test/callback?session_id=cs_missing_pro&client=ui',
				})

				expect(redirect.redirectUrl).toContain('billing_error=checkout_unavailable')
				expect(fixture.requests).toHaveLength(2)
				expect(fixture.requests.some((request) => request.method === 'DELETE')).toBe(false)
			}).pipe(Effect.provide(makeCompletionLayer(fixture.layer)))
		},
	)
})

function makeCompletionLayer(stripeLayer: ReturnType<typeof makeStripeTestLayer>['layer']) {
	return Layer.mergeAll(
		BillingCheckoutCompletionServiceLive.pipe(
			Layer.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						APP_ORIGIN: 'https://app.example.test',
						CLOUD_ORIGIN: 'https://cloud.example.test',
						STRIPE_PRICE_PRO: 'price_pro',
						STRIPE_PRICE_STARTER: 'price_starter',
					}),
				),
			),
		),
		stripeLayer,
		PostgresDbLive(db),
	)
}

function insertOrganization(customerId: string) {
	return Effect.promise(async () => {
		const [organization] = await db
			.insert(organizations)
			.values({
				name: `Completion ${customerId}`,
				workos_organization_id: `org_${randomUUID()}`,
				stripe_customer_id: customerId,
			})
			.returning()
		if (!organization) throw new Error('Failed to insert organization fixture')
		return organization.id
	})
}
