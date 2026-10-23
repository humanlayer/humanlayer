import { Cause, Config, Effect, Layer } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

import { Sentry } from '../../../instrument'
import { cancelSubscription } from './procedures/cancel-subscription'
import { createCheckoutSession } from './procedures/create-checkout-session'
import { createProUpgradeCheckoutSession } from './procedures/create-pro-upgrade-checkout-session'
import { listCustomerSubscriptions } from './procedures/list-customer-subscriptions'
import { listPaidInvoices } from './procedures/list-paid-invoices'
import { retrieveCheckoutSession } from './procedures/retrieve-checkout-session'
import { retrieveSubscription } from './procedures/retrieve-subscription'
import { synchronizeStripeCustomerBillingCache } from './stripe-billing-sync'
import {
	narrowCheckoutSessionRetrieveErrors,
	narrowProviderErrors,
	narrowSubscriptionCancelErrors,
	narrowSubscriptionRetrieveErrors,
	observeStripeErrors,
} from './stripe-error-handling'
import { StripeHttpClientLive } from './stripe-http-client.layer'
import { decodeStripeServiceInput } from './stripe-service-input'
import { parseVerifiedWebhook } from './stripe-webhook'
import { makeStripeWebhookSignatureVerifier } from './stripe-webhook-signature-verifier'
import { StripeService } from './stripe.service'
import {
	CancelSubscriptionInput,
	CreateCheckoutSessionInput,
	CreateProUpgradeCheckoutSessionInput,
	ListCustomerSubscriptionsInput,
	ListPaidInvoicesInput,
	RetrieveCheckoutSessionInput,
	RetrieveSubscriptionInput,
	SyncCustomerBillingToKvInput,
} from './stripe.types'
import type { StripeServiceShape } from './stripe.types'

export const StripeServiceLive = Layer.effect(
	StripeService,
	Effect.gen(function* () {
		const proPriceId = yield* Config.String('STRIPE_PRICE_PRO')
		const starterPriceId = yield* Config.String('STRIPE_PRICE_STARTER')
		const stripeApiKey = yield* Config.Redacted('STRIPE_SECRET_KEY')
		const stripeWebhookSecret = yield* Config.Redacted('STRIPE_WEBHOOK_SECRET')
		const webhookSignatureVerifier = makeStripeWebhookSignatureVerifier({
			apiKey: stripeApiKey,
			webhookSecret: stripeWebhookSecret,
		})

		const service: StripeServiceShape = {
			processWebhook: (input) =>
				Effect.gen(function* () {
					const verifiedEvent = yield* webhookSignatureVerifier.constructWebhookEvent(input)
					const event = yield* parseVerifiedWebhook(verifiedEvent)
					if (!event.tracked) {
						yield* Effect.logInfo('Ignoring untracked Stripe webhook').pipe(
							Effect.annotateLogs({ event_id: event.eventId, event_type: event.eventType }),
						)
						return { received: true } as const
					}
					const cache = yield* service.syncCustomerBillingToKv({ customerId: event.customerId })
					yield* Effect.logInfo('Stripe webhook billing cache synchronized').pipe(
						Effect.annotateLogs({
							event_id: event.eventId,
							event_type: event.eventType,
							customer_id: event.customerId,
							organization_id: cache.organizationId,
						}),
					)
					return { received: true } as const
				}).pipe(
					Effect.tapError((error) =>
						Effect.fail(error).pipe(
							Effect.catchTag('StripeWebhookSignatureError', () => Effect.void),
							Effect.catchTag('StripeWebhookPayloadError', () => Effect.void),
							observeStripeErrors('process_webhook', {}),
							Effect.ignore,
						),
					),
					Effect.catchCause((cause) => {
						if (!Cause.hasDies(cause)) return Effect.failCause(cause)
						return Effect.logError('Stripe webhook defect', cause).pipe(
							Effect.tap(() =>
								Effect.sync(() =>
									Sentry.captureException(cause, { tags: { error_type: 'stripe_webhook_defect' } }),
								),
							),
							Effect.flatMap(() => Effect.failCause(cause)),
						)
					}),
					Effect.withSpan('stripe_service.process_webhook'),
				),
			createCheckoutSession: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						CreateCheckoutSessionInput,
						rawInput,
						'create_checkout_session',
					)
					const attributes = {
						customer_id: input.customerId,
						organization_id: input.organizationId,
					}
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* createCheckoutSession(input, proPriceId).pipe(
						observeStripeErrors('create_checkout_session', attributes),
						narrowProviderErrors('create_checkout_session'),
					)
				}).pipe(Effect.withSpan('stripe_service.create_checkout_session')),
			createProUpgradeCheckoutSession: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						CreateProUpgradeCheckoutSessionInput,
						rawInput,
						'create_pro_upgrade_checkout_session',
					)
					const attributes = {
						customer_id: input.customerId,
						organization_id: input.organizationId,
					}
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* createProUpgradeCheckoutSession(input, proPriceId).pipe(
						observeStripeErrors('create_pro_upgrade_checkout_session', attributes),
						narrowProviderErrors('create_pro_upgrade_checkout_session'),
					)
				}).pipe(Effect.withSpan('stripe_service.create_pro_upgrade_checkout_session')),
			retrieveCheckoutSession: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						RetrieveCheckoutSessionInput,
						rawInput,
						'retrieve_checkout_session',
					)
					const attributes = { checkout_session_id: input.sessionId }
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* retrieveCheckoutSession(input).pipe(
						observeStripeErrors('retrieve_checkout_session', attributes),
						narrowCheckoutSessionRetrieveErrors(input.sessionId),
					)
				}).pipe(Effect.withSpan('stripe_service.retrieve_checkout_session')),
			retrieveSubscription: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						RetrieveSubscriptionInput,
						rawInput,
						'retrieve_subscription',
					)
					const attributes = { subscription_id: input.subscriptionId }
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* retrieveSubscription(input).pipe(
						observeStripeErrors('retrieve_subscription', attributes),
						narrowSubscriptionRetrieveErrors(input.subscriptionId),
					)
				}).pipe(Effect.withSpan('stripe_service.retrieve_subscription')),
			listCustomerSubscriptions: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						ListCustomerSubscriptionsInput,
						rawInput,
						'list_customer_subscriptions',
					)
					const attributes = { customer_id: input.customerId }
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* listCustomerSubscriptions(input).pipe(
						observeStripeErrors('list_customer_subscriptions', attributes),
						narrowProviderErrors('list_customer_subscriptions'),
					)
				}).pipe(Effect.withSpan('stripe_service.list_customer_subscriptions')),
			cancelSubscription: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						CancelSubscriptionInput,
						rawInput,
						'cancel_subscription',
					)
					const attributes = { subscription_id: input.subscriptionId }
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* cancelSubscription(input).pipe(
						observeStripeErrors('cancel_subscription', attributes),
						narrowSubscriptionCancelErrors(input.subscriptionId),
						Effect.catchTag('StripeSubscriptionAlreadyGoneError', (error) =>
							Effect.logWarning('Stripe subscription already gone during cancel').pipe(
								Effect.annotateLogs({
									subscription_id: error.subscriptionId,
									request_id: error.requestId,
								}),
								Effect.flatMap(() => Effect.fail(error)),
							),
						),
					)
				}).pipe(Effect.withSpan('stripe_service.cancel_subscription')),
			listPaidInvoices: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(ListPaidInvoicesInput, rawInput, 'list_paid_invoices')
					const attributes = {
						customer_id: input.customerId,
						subscription_id: input.subscriptionId,
					}
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* listPaidInvoices(input).pipe(
						observeStripeErrors('list_paid_invoices', attributes),
						narrowProviderErrors('list_paid_invoices'),
					)
				}).pipe(Effect.withSpan('stripe_service.list_paid_invoices')),
			findActivePaidProSubscription: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						ListCustomerSubscriptionsInput,
						rawInput,
						'find_active_paid_pro_subscription',
					)
					const attributes = { customer_id: input.customerId }
					yield* Effect.annotateCurrentSpan(attributes)
					const subscriptions = yield* listCustomerSubscriptions(input).pipe(
						observeStripeErrors('find_active_paid_pro_subscription', attributes),
						narrowProviderErrors('find_active_paid_pro_subscription'),
					)
					const proSubscription = subscriptions.find(
						(subscription) =>
							subscription.status === 'active' && subscription.priceIds.includes(proPriceId),
					)
					if (!proSubscription) return null

					const paidInvoices = yield* listPaidInvoices({
						customerId: input.customerId,
						subscriptionId: proSubscription.id,
					}).pipe(
						observeStripeErrors('find_active_paid_pro_subscription', {
							...attributes,
							subscription_id: proSubscription.id,
						}),
						narrowProviderErrors('find_active_paid_pro_subscription'),
					)
					return paidInvoices.length > 0 ? { subscriptionId: proSubscription.id } : null
				}).pipe(Effect.withSpan('stripe_service.find_active_paid_pro_subscription')),
			findNonCanceledStarterSubscription: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						ListCustomerSubscriptionsInput,
						rawInput,
						'find_non_canceled_starter_subscription',
					)
					const attributes = { customer_id: input.customerId }
					yield* Effect.annotateCurrentSpan(attributes)
					const subscriptions = yield* listCustomerSubscriptions(input).pipe(
						observeStripeErrors('find_non_canceled_starter_subscription', attributes),
						narrowProviderErrors('find_non_canceled_starter_subscription'),
					)
					const starterSubscription = subscriptions.find(
						(subscription) =>
							subscription.status !== 'canceled' && subscription.priceIds.includes(starterPriceId),
					)
					return starterSubscription ? { subscriptionId: starterSubscription.id } : null
				}).pipe(Effect.withSpan('stripe_service.find_non_canceled_starter_subscription')),
			syncCustomerBillingToKv: (rawInput) =>
				Effect.gen(function* () {
					const input = yield* decodeStripeServiceInput(
						SyncCustomerBillingToKvInput,
						rawInput,
						'sync_customer_billing_to_kv',
					)
					const attributes = { customer_id: input.customerId }
					yield* Effect.annotateCurrentSpan(attributes)
					return yield* synchronizeStripeCustomerBillingCache(input)
				}).pipe(
					Effect.tap((cache) =>
						Effect.logInfo('Stripe customer billing synced to KV').pipe(
							Effect.annotateLogs({
								customer_id: cache.customerId,
								organization_id: cache.organizationId,
								subscription_id: cache.subscriptionId,
								status: cache.status,
							}),
						),
					),
					Effect.withSpan('stripe_service.sync_customer_billing_to_kv'),
				),
		}
		return service
	}),
)

const StripeHttpClientWithFetchLive = StripeHttpClientLive.pipe(Layer.provide(FetchHttpClient.layer))

export const StripeServiceWithFetchHttpClientLive = StripeServiceLive.pipe(
	Layer.provideMerge(StripeHttpClientWithFetchLive),
)
