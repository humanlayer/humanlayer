import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../postgres/postgres-db.service'
import { StripeService } from '../stripe/stripe.service'
import type { SubscriptionDetails } from '../stripe/stripe.types'
import {
	CheckoutSessionInvalidForOperationError,
	CheckoutSessionMissingCustomerError,
	CheckoutSessionMissingSubscriptionError,
	CheckoutSessionRetrieveError,
	CheckoutStripeKvSyncError,
	CustomerSubscriptionListError,
	OrganizationResolveError,
	StripeSubscriptionCancelError,
	SubscriptionInvalidPlanError,
	SubscriptionRetrieveError,
} from './billing-checkout-completion.errors'
import type { CheckoutRedirectQuery } from './billing-checkout-completion.schema'
import type { ResolvedCheckoutOrganization } from './billing-checkout-completion.types'

/** Retrieves a checkout session and maps Stripe service errors to checkout-completion domain errors. */
export const retrieveCheckoutSessionForCompletion = (sessionId: string) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.retrieveCheckoutSession({ sessionId }).pipe(
			Effect.catchTags({
				StripeCheckoutSessionNotFoundError: () =>
					Effect.fail(new CheckoutSessionInvalidForOperationError({ sessionId, reason: 'not_complete' })),
				StripeServiceInputParseError: (cause) =>
					Effect.fail(new CheckoutSessionRetrieveError({ sessionId, cause })),
				StripeOperationError: (cause) => Effect.fail(new CheckoutSessionRetrieveError({ sessionId, cause })),
			}),
		)
	})

/** Retrieves a subscription and maps Stripe service errors to checkout-completion domain errors. */
export const retrieveSubscriptionForCompletion = (input: {
	readonly subscriptionId: string
	readonly proPriceId: string
}) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.retrieveSubscription({ subscriptionId: input.subscriptionId }).pipe(
			Effect.catchTags({
				StripeSubscriptionNotFoundError: (cause) =>
					Effect.fail(
						new SubscriptionInvalidPlanError({
							subscriptionId: input.subscriptionId,
							expectedPriceId: input.proPriceId,
							cause,
						}),
					),
				StripeServiceInputParseError: (cause) =>
					Effect.fail(new SubscriptionRetrieveError({ subscriptionId: input.subscriptionId, cause })),
				StripeOperationError: (cause) =>
					Effect.fail(new SubscriptionRetrieveError({ subscriptionId: input.subscriptionId, cause })),
			}),
		)
	})

/** Lists customer subscriptions and maps Stripe service errors to checkout-completion domain errors. */
export const listCustomerSubscriptionsForCompletion = (customerId: string) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.listCustomerSubscriptions({ customerId }).pipe(
			Effect.catchTags({
				StripeServiceInputParseError: (cause) =>
					Effect.fail(new CustomerSubscriptionListError({ customerId, cause })),
				StripeOperationError: (cause) => Effect.fail(new CustomerSubscriptionListError({ customerId, cause })),
			}),
		)
	})

/** Cancels an obsolete subscription and treats already-deleted subscriptions as an idempotent success. */
export const cancelSubscriptionForCompletion = (subscriptionId: string) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.cancelSubscription({ subscriptionId }).pipe(
			Effect.catchTag('StripeSubscriptionAlreadyGoneError', (error) =>
				Effect.logWarning('Checkout completion obsolete subscription already gone').pipe(
					Effect.annotateLogs({ subscription_id: error.subscriptionId, request_id: error.requestId }),
				),
			),
			Effect.catchTags({
				StripeServiceInputParseError: (cause) =>
					Effect.fail(new StripeSubscriptionCancelError({ subscriptionId, cause })),
				StripeOperationError: (cause) =>
					Effect.fail(new StripeSubscriptionCancelError({ subscriptionId, cause })),
			}),
		)
	})

/** Refreshes the customer billing KV snapshot after checkout completion. */
export const syncCustomerBillingToKvForCompletion = (customerId: string) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.syncCustomerBillingToKv({ customerId }).pipe(
			Effect.catchTags({
				StripeServiceInputParseError: (cause) =>
					Effect.fail(new CheckoutStripeKvSyncError({ customerId, cause })),
				StripeBillingSyncError: (cause) => Effect.fail(new CheckoutStripeKvSyncError({ customerId, cause })),
				StripeOperationError: (cause) => Effect.fail(new CheckoutStripeKvSyncError({ customerId, cause })),
			}),
		)
	})

/** Resolves the local organization attached to a Stripe customer. */
export const resolveOrganizationByCustomer = (
	customerId: string,
): Effect.Effect<ResolvedCheckoutOrganization, OrganizationResolveError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		const [organization] = yield* pg
			.query(
				pg.client
					.select({
						organizationId: organizations.id,
						stripeCustomerId: organizations.stripe_customer_id,
					})
					.from(organizations)
					.where(eq(organizations.stripe_customer_id, customerId))
					.limit(1),
			)
			.pipe(Effect.mapError((cause) => new OrganizationResolveError({ customerId, cause })))

		if (!organization?.stripeCustomerId) {
			return yield* Effect.fail(new OrganizationResolveError({ customerId }))
		}

		return { organizationId: organization.organizationId, stripeCustomerId: organization.stripeCustomerId }
	}).pipe(Effect.withSpan('billing_checkout.resolve_organization', { attributes: { customer_id: customerId } }))

/** Verifies that a checkout session completed with a paid subscription and returns ids needed for finalization. */
export const verifyCompleteSubscriptionSession = (query: CheckoutRedirectQuery) =>
	Effect.gen(function* () {
		const session = yield* retrieveCheckoutSessionForCompletion(query.session_id)
		yield* Effect.annotateCurrentSpan({ checkout_session_id: session.id })

		if (session.status !== 'complete') {
			return yield* Effect.fail(
				new CheckoutSessionInvalidForOperationError({ sessionId: session.id, reason: 'not_complete' }),
			)
		}
		if (session.mode !== 'subscription') {
			return yield* Effect.fail(
				new CheckoutSessionInvalidForOperationError({ sessionId: session.id, reason: 'not_subscription_mode' }),
			)
		}
		if (session.paymentStatus !== 'paid') {
			return yield* Effect.fail(
				new CheckoutSessionInvalidForOperationError({ sessionId: session.id, reason: 'payment_not_paid' }),
			)
		}
		if (!session.customerId) {
			return yield* Effect.fail(new CheckoutSessionMissingCustomerError({ sessionId: session.id }))
		}
		if (!session.subscriptionId) {
			return yield* Effect.fail(new CheckoutSessionMissingSubscriptionError({ sessionId: session.id }))
		}

		return { customerId: session.customerId, sessionId: session.id, subscriptionId: session.subscriptionId }
	})

/** Verifies that a checkout session completed and returns the customer id needed for cache resync. */
export const verifyCompleteCustomerSession = (query: CheckoutRedirectQuery) =>
	Effect.gen(function* () {
		const session = yield* retrieveCheckoutSessionForCompletion(query.session_id)
		yield* Effect.annotateCurrentSpan({ checkout_session_id: session.id })

		if (session.status !== 'complete') {
			return yield* Effect.fail(
				new CheckoutSessionInvalidForOperationError({ sessionId: session.id, reason: 'not_complete' }),
			)
		}
		if (!session.customerId) {
			return yield* Effect.fail(new CheckoutSessionMissingCustomerError({ sessionId: session.id }))
		}

		return { customerId: session.customerId, sessionId: session.id }
	})

/** Ensures the subscription created by checkout is an active or trialing Pro subscription. */
export const requireProSubscription = (input: {
	readonly subscription: SubscriptionDetails
	readonly proPriceId: string
}) =>
	Effect.gen(function* () {
		if (
			(input.subscription.status !== 'active' && input.subscription.status !== 'trialing') ||
			!input.subscription.priceIds.includes(input.proPriceId)
		) {
			return yield* Effect.fail(
				new SubscriptionInvalidPlanError({
					subscriptionId: input.subscription.id,
					expectedPriceId: input.proPriceId,
				}),
			)
		}
		return input.subscription
	})

/** Cancels any non-canceled Starter subscriptions after a Starter-to-Pro checkout succeeds. */
export const cancelStarterSubscriptions = (input: { readonly customerId: string; readonly starterPriceId: string }) =>
	Effect.gen(function* () {
		const subscriptions = yield* listCustomerSubscriptionsForCompletion(input.customerId)
		const starterSubscriptions = subscriptions.filter(
			(subscription) =>
				subscription.status !== 'canceled' && subscription.priceIds.includes(input.starterPriceId),
		)

		yield* Effect.forEach(
			starterSubscriptions,
			(subscription) =>
				cancelSubscriptionForCompletion(subscription.id).pipe(
					Effect.withSpan('billing_checkout.cancel_obsolete_starter', {
						attributes: { customer_id: input.customerId, subscription_id: subscription.id },
					}),
				),
			{ concurrency: 1 },
		)
	})
