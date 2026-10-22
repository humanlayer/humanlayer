import { RedisService } from '@humanlayer/billing/redis'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import {
	type EffectPostgresDbService,
	type PostgresDbClient,
	PostgresDb,
} from '../../src/effects/services/postgres/postgres-db.service'
import { StripeHttpClientLive } from '../../src/effects/services/stripe/stripe-http-client.layer'
import { StripeServiceLive } from '../../src/effects/services/stripe/stripe-service-live'
import { billingKvLayerFromTestService, TestBillingKvService } from './billing-kv-runtime'

type ResponseSpec = { readonly status: number; readonly body: unknown; readonly requestId: string | null }

export const stripeResponse = (
	body: unknown,
	options: { readonly status?: number; readonly requestId?: string | null } = {},
): ResponseSpec => ({
	status: options.status ?? 200,
	body,
	requestId: options.requestId === undefined ? 'req_fixture' : options.requestId,
})

export const stripeErrorResponse = (status: number, requestId: string, code: string): ResponseSpec =>
	stripeResponse({ error: { type: 'invalid_request_error', code } }, { status, requestId })

export const checkoutSessionResponse = (
	input: {
		readonly id?: string
		readonly customerId?: string | null
		readonly subscriptionId?: string | null
		readonly status?: 'open' | 'complete'
		readonly url?: string | null
	} = {},
) => ({
	id: input.id ?? 'cs_123',
	object: 'checkout.session',
	status: input.status ?? 'complete',
	payment_status: input.status === 'open' ? 'unpaid' : 'paid',
	mode: 'subscription',
	customer: input.customerId === undefined ? 'cus_123' : input.customerId,
	subscription: input.subscriptionId === undefined ? 'sub_pro' : input.subscriptionId,
	url: input.url === undefined ? null : input.url,
})

export const subscriptionResponse = (
	input: {
		readonly id?: string
		readonly customerId?: string
		readonly priceId?: string
		readonly status?: string
		readonly created?: number
	} = {},
) => ({
	id: input.id ?? 'sub_pro',
	object: 'subscription',
	customer: input.customerId ?? 'cus_123',
	status: input.status ?? 'active',
	created: input.created ?? 1,
	default_payment_method: { id: 'pm_123' },
	items: {
		data: [
			{
				id: `si_${input.id ?? 'pro'}`,
				quantity: 1,
				current_period_end: 456,
				price: { id: input.priceId ?? 'price_pro' },
			},
		],
	},
})

export function makeStripeTestLayer(input: {
	readonly responses: readonly ResponseSpec[]
	readonly kv?: TestBillingKvService
	readonly organizationId?: string
	readonly postgresLayer?: Layer.Layer<PostgresDb>
}) {
	const requests: HttpClientRequest[] = []
	let responseIndex = 0
	const kv = input.kv ?? new TestBillingKvService()
	const transport = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) => {
			requests.push(request)
			const spec = input.responses[responseIndex++]
			if (!spec) return Effect.die(`Unexpected Stripe request: ${request.method} ${request.url}`)
			const headers: Record<string, string> = { 'content-type': 'application/json' }
			if (spec.requestId !== null) headers['request-id'] = spec.requestId
			return Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(JSON.stringify(spec.body), { status: spec.status, headers }),
				),
			)
		}),
	)
	const postgres =
		input.postgresLayer ??
		Layer.succeed(PostgresDb, {
			client: {} as PostgresDbClient,
			query: <A>() => Effect.succeed([{ organizationId: input.organizationId ?? null }] as A),
			run: <A>() => Effect.succeed([{ organizationId: input.organizationId ?? null }] as A),
			transaction: () => Effect.die('transaction not used'),
		} satisfies EffectPostgresDbService)
	const config = ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			STRIPE_SECRET_KEY: 'sk_test',
			STRIPE_WEBHOOK_SECRET: 'whsec_test',
			STRIPE_API_BASE_URL: 'https://stripe.example.test',
			STRIPE_PRICE_PRO: 'price_pro',
			STRIPE_PRICE_STARTER: 'price_starter',
		}),
	)
	const layer = StripeServiceLive.pipe(
		Layer.provideMerge(StripeHttpClientLive.pipe(Layer.provideMerge(transport))),
		Layer.provideMerge(postgres),
		Layer.provideMerge(billingKvLayerFromTestService(kv)),
		Layer.provideMerge(
			Layer.succeed(RedisService, { send: () => Effect.die('Redis is not used by TestBillingKvService') }),
		),
		Layer.provide(config),
	)
	return {
		layer,
		requests,
		kv,
		requestBody: (index: number) => {
			const body = requests[index]?.body
			return body?._tag === 'Uint8Array'
				? Object.fromEntries(new URLSearchParams(new TextDecoder().decode(body.body)))
				: {}
		},
		requestParams: (index: number) => Object.fromEntries(requests[index]?.urlParams ?? []),
	}
}
