import { BillingKvService } from '@humanlayer/billing/billing-kv'
import type { ReadableStripeSubscriptionCache } from '@humanlayer/billing/billing-kv'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../postgres/postgres-db.service'
import { listCustomerSubscriptions } from './procedures/list-customer-subscriptions'
import { listPaidInvoices } from './procedures/list-paid-invoices'
import {
	narrowCacheErrors,
	narrowOrganizationResolveErrors,
	narrowProviderErrors,
	observeStripeErrors,
} from './stripe-error-handling'
import { StripeOrganizationResolveError } from './stripe.errors'
import type { StripeBillingCache, SubscriptionDetails, SyncCustomerBillingToKvInput } from './stripe.types'

/** Rebuilds and persists the canonical billing cache for a Stripe customer. */
export const synchronizeStripeCustomerBillingCache = (input: SyncCustomerBillingToKvInput) =>
	Effect.gen(function* () {
		const attributes = { customer_id: input.customerId }
		const billingCacheStore = yield* BillingKvService
		const existing = yield* billingCacheStore
			.getSubscriptionCache({ customerId: input.customerId })
			.pipe(observeStripeErrors('sync_customer_billing_to_kv', attributes), narrowCacheErrors(input.customerId))
		const organizationId = yield* resolveOrganizationIdForStripeCustomer(input.customerId).pipe(
			observeStripeErrors('sync_customer_billing_to_kv', attributes),
			narrowOrganizationResolveErrors(input.customerId),
		)
		const subscriptions = yield* listCustomerSubscriptions({ customerId: input.customerId }).pipe(
			observeStripeErrors('sync_customer_billing_to_kv', attributes),
			narrowProviderErrors('sync_customer_billing_to_kv'),
		)
		const subscription = selectRepresentativeSubscriptionForBillingCache(subscriptions)
		const paidInvoices = yield* listPaidInvoices({ customerId: input.customerId }).pipe(
			observeStripeErrors('sync_customer_billing_to_kv', attributes),
			narrowProviderErrors('sync_customer_billing_to_kv'),
		)
		const cache = buildStripeCustomerBillingCacheSnapshot(
			input.customerId,
			organizationId,
			subscription,
			paidInvoices.length > 0,
			existing,
		)
		if (organizationId) {
			yield* billingCacheStore
				.setCustomerOrgId({ customerId: input.customerId, organizationId })
				.pipe(
					observeStripeErrors('sync_customer_billing_to_kv', attributes),
					narrowCacheErrors(input.customerId),
				)
			yield* billingCacheStore
				.setOrgCustomerId({ organizationId, customerId: input.customerId })
				.pipe(
					observeStripeErrors('sync_customer_billing_to_kv', attributes),
					narrowCacheErrors(input.customerId),
				)
		}
		yield* billingCacheStore
			.setSubscriptionCache({ customerId: input.customerId, cache })
			.pipe(observeStripeErrors('sync_customer_billing_to_kv', attributes), narrowCacheErrors(input.customerId))
		return cache
	})

/** Resolves the organization currently associated with a Stripe customer. */
export const resolveOrganizationIdForStripeCustomer = (customerId: string) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		return yield* postgres
			.run(() =>
				postgres.client
					.select({ organizationId: organizations.id })
					.from(organizations)
					.where(eq(organizations.stripe_customer_id, customerId))
					.limit(1)
					.execute(),
			)
			.pipe(
				Effect.map((rows) => rows[0]?.organizationId ?? null),
				Effect.mapError((cause) => new StripeOrganizationResolveError({ customerId, cause })),
			)
	})

/** Chooses the subscription whose state should represent the customer in the billing cache. */
export const selectRepresentativeSubscriptionForBillingCache = (
	subscriptions: readonly SubscriptionDetails[],
): SubscriptionDetails | null => {
	return (
		subscriptions.find((subscription) => subscription.status === 'active' || subscription.status === 'trialing') ??
		subscriptions.find((subscription) => subscription.status !== 'canceled') ??
		subscriptions[0] ??
		null
	)
}

/** Builds a billing cache snapshot while preserving the start of an existing past-due period. */
export const buildStripeCustomerBillingCacheSnapshot = (
	customerId: string,
	organizationId: string | null,
	subscription: SubscriptionDetails | null,
	hasPaidInvoice: boolean,
	existing: ReadableStripeSubscriptionCache | null,
): StripeBillingCache => {
	const now = Date.now()
	if (!subscription)
		return {
			customerId,
			organizationId,
			subscriptionId: null,
			status: 'none',
			priceId: null,
			currentPeriodEnd: null,
			hasPaidInvoice: false,
			hasPaymentMethod: false,
			pastDueAt: null,
			syncedAt: now,
		}
	return {
		customerId,
		organizationId,
		subscriptionId: subscription.id,
		status: subscription.status,
		priceId: subscription.priceIds[0] ?? null,
		currentPeriodEnd: subscription.currentPeriodEnd,
		hasPaidInvoice,
		hasPaymentMethod: subscription.hasPaymentMethod,
		pastDueAt:
			subscription.status === 'past_due'
				? existing?.status === 'past_due' && existing.pastDueAt
					? existing.pastDueAt
					: now
				: null,
		syncedAt: now,
	}
}
