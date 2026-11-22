import { Effect } from 'effect'

import type { StripeHttpClientShape } from './stripe-http-client.service'
import { BillingNotConfiguredError } from './stripe.errors'
import type { StripeServiceShape } from './stripe.types'

const failBillingNotConfigured = (operation: string) =>
	Effect.fail(new BillingNotConfiguredError({ operation })).pipe(
		Effect.withSpan(`stripe_service.${operation}`, { attributes: { stripe_configured: false } }),
	)

/**
 * The Stripe service for a deployment with billing enforcement off and no Stripe account. Every
 * method fails with `BillingNotConfiguredError`. With enforcement off, the billing middlewares and
 * entitlement checks never reach Stripe, so this only answers paths that do not check the flag.
 */
export const unconfiguredStripeService: StripeServiceShape = {
	configured: false,
	createCheckoutSession: () => failBillingNotConfigured('create_checkout_session'),
	createProUpgradeCheckoutSession: () => failBillingNotConfigured('create_pro_upgrade_checkout_session'),
	retrieveCheckoutSession: () => failBillingNotConfigured('retrieve_checkout_session'),
	retrieveSubscription: () => failBillingNotConfigured('retrieve_subscription'),
	listCustomerSubscriptions: () => failBillingNotConfigured('list_customer_subscriptions'),
	cancelSubscription: () => failBillingNotConfigured('cancel_subscription'),
	listPaidInvoices: () => failBillingNotConfigured('list_paid_invoices'),
	findActivePaidProSubscription: () => failBillingNotConfigured('find_active_paid_pro_subscription'),
	findNonCanceledStarterSubscription: () => failBillingNotConfigured('find_non_canceled_starter_subscription'),
	syncCustomerBillingToKv: () => failBillingNotConfigured('sync_customer_billing_to_kv'),
	processWebhook: () => failBillingNotConfigured('process_webhook'),
}

/**
 * The Stripe transport paired with `unconfiguredStripeService`. Only the real Stripe service sends
 * requests through it, and that service does not exist on this deployment, so a call here is a
 * programming error and fails loudly.
 */
export const unconfiguredStripeHttpClient: StripeHttpClientShape = {
	execute: (request) =>
		Effect.die(
			new BillingNotConfiguredError({
				operation: `http_request ${request.method} ${request.url.split(/[?#]/, 1)[0]}`,
			}),
		),
}
