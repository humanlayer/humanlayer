import { BillingKvService, BillingKvUnavailableError } from '@humanlayer/billing/billing-kv'
import { RedisCommandError, RedisService } from '@humanlayer/billing/redis'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import Stripe from 'stripe'

import type { EffectPostgresDbService, PostgresDbClient } from '../../src/effects/services/postgres/postgres-db.service'
import { PostgresDb } from '../../src/effects/services/postgres/postgres-db.service'
import { StripeHttpClientLive } from '../../src/effects/services/stripe/stripe-http-client.layer'
import { StripeHttpClient } from '../../src/effects/services/stripe/stripe-http-client.service'
import { StripeServiceLive } from '../../src/effects/services/stripe/stripe-service-live'
import { createMockStripeService, createMockWorkosService } from '../mocks'
import { createApp } from '../test-factory'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { billingKvLayerFromTestService, TestBillingKvService } from './billing-kv-runtime'

const webhookSecret = 'whsec_webhook_route_fixture'
const customerId = 'cus_webhook_tracked'
const organizationId = 'org_webhook_tracked'
const sdk = new Stripe('sk_test_webhook_fixture')

export const trackedWebhookEvent = () => ({
	id: 'evt_webhook_tracked',
	object: 'event',
	created: 1,
	type: 'customer.subscription.updated',
	data: { object: { id: 'sub_webhook', object: 'subscription', customer: customerId } },
})

export const untrackedWebhookEvent = () => ({
	id: 'evt_webhook_untracked',
	object: 'event',
	created: 1,
	type: 'charge.refunded',
	data: { object: { id: 'ch_webhook', object: 'charge', customer: customerId } },
})

export const serializeWebhook = (event: object, pretty = false) => JSON.stringify(event, null, pretty ? 2 : undefined)

export const signWebhook = (body: string) =>
	sdk.webhooks.generateTestHeaderStringAsync({ payload: body, secret: webhookSecret })

export async function createStripeWebhookFixture(options: { failSync?: boolean } = {}) {
	const kv = new TestBillingKvService()
	const cacheLayer = options.failSync
		? Layer.succeed(BillingKvService, {
				getSubscriptionCache: () => Effect.succeed(null),
				setSubscriptionCache: () =>
					Effect.fail(
						new BillingKvUnavailableError({
							operation: 'set_subscription_cache',
							cause: new RedisCommandError({ command: 'SET', cause: new Error('cache unavailable') }),
						}),
					),
				setOrgCustomerId: () => Effect.void,
				setCustomerOrgId: () => Effect.void,
				getOrgCustomerId: () => Effect.succeed(null),
				getCustomerOrgId: () => Effect.succeed(null),
			})
		: billingKvLayerFromTestService(kv)
	const dependencies = Layer.mergeAll(
		cacheLayer,
		Layer.succeed(PostgresDb, {
			client: {} as PostgresDbClient,
			query: <A>() => Effect.succeed([{ organizationId }] as A),
			run: <A>() => Effect.succeed([{ organizationId }] as A),
			transaction: () => Effect.die('transaction not used'),
		} satisfies EffectPostgresDbService),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				STRIPE_SECRET_KEY: 'sk_test_webhook_fixture',
				STRIPE_WEBHOOK_SECRET: webhookSecret,
				STRIPE_PRICE_PRO: 'price_pro',
				STRIPE_PRICE_STARTER: 'price_starter',
			}),
		),
		Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) => Effect.succeed(stripeResponse(request))),
		),
	)
	const stripeHttpClientLayer = StripeHttpClientLive.pipe(Layer.provide(dependencies), Layer.orDie)
	const stripeLayer = StripeServiceLive.pipe(
		Layer.provideMerge(stripeHttpClientLayer),
		Layer.provideMerge(dependencies),
		Layer.provideMerge(
			Layer.succeed(RedisService, { send: () => Effect.die('Redis is not used by the webhook fixture') }),
		),
		Layer.orDie,
	)
	const runtime = createRuntimeWithTestPostgresLayer({} as never, {
		stripe: stripeLayer,
		stripeHttpClient: stripeHttpClientLayer,
		billingKv: cacheLayer,
	})
	const app = createApp({
		db: {} as never,
		workos: createMockWorkosService(),
		stripe: createMockStripeService(),
		effectRuntime: runtime,
	})

	return {
		app,
		request: async (body: string, signature: string) =>
			app.request('/webhooks/stripe', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'stripe-signature': signature },
				body,
			}),
		cacheForTrackedCustomer: () => kv.getSubscriptionCache(customerId),
	}
}

function stripeResponse(request: HttpClientRequest) {
	const body = request.url.includes('/v1/subscriptions')
		? {
				object: 'list',
				has_more: false,
				data: [
					{
						id: 'sub_webhook',
						object: 'subscription',
						customer: customerId,
						status: 'active',
						created: 1,
						default_payment_method: { id: 'pm_webhook' },
						items: {
							data: [
								{ id: 'si_webhook', quantity: 1, current_period_end: 999, price: { id: 'price_pro' } },
							],
						},
					},
				],
			}
		: {
				object: 'list',
				data: [
					{
						id: 'in_webhook',
						object: 'invoice',
						status: 'paid',
						customer: customerId,
						subscription: 'sub_webhook',
					},
				],
			}
	return HttpClientResponse.fromWeb(
		request,
		new Response(JSON.stringify(body), {
			headers: { 'content-type': 'application/json', 'request-id': 'req_webhook' },
		}),
	)
}
