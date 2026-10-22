import type { StripeCheckoutSession, StripeInvoice, StripeSubscription } from '../stripe.schema'
import type { CheckoutSessionDetails, PaidInvoiceDetails, SubscriptionDetails } from '../stripe.types'

export function transformStripeCheckoutSessionToCheckoutSessionDetails(
	session: StripeCheckoutSession,
): CheckoutSessionDetails {
	return {
		id: session.id,
		status: session.status,
		paymentStatus: session.payment_status,
		mode: session.mode,
		customerId: session.customer,
		subscriptionId: session.subscription,
		url: session.url ?? null,
	}
}

/**
 * Converts Stripe's item-oriented subscription into the billing model used by the application.
 * Quantity and period end describe the first item, matching the single-price plans we sell.
 */
export function transformStripeSubscriptionToSubscriptionDetails(
	subscription: StripeSubscription,
): SubscriptionDetails {
	const firstItem = subscription.items.data[0]
	return {
		id: subscription.id,
		customerId: subscription.customer,
		status: subscription.status,
		created: subscription.created,
		priceIds: subscription.items.data.map((item) => item.price.id),
		quantity: firstItem?.quantity ?? null,
		currentPeriodEnd: firstItem?.current_period_end ?? null,
		hasPaymentMethod: hasPaymentMethod(subscription.default_payment_method),
	}
}

function hasPaymentMethod(paymentMethod: StripeSubscription['default_payment_method']): boolean {
	if (typeof paymentMethod === 'string') return paymentMethod.length > 0
	return Boolean(paymentMethod?.id)
}

/** Converts an invoice already filtered as paid into the identifiers needed by billing synchronization. */
export function transformStripePaidInvoiceToPaidInvoiceDetails(invoice: StripeInvoice): PaidInvoiceDetails {
	return {
		id: invoice.id,
		customerId: invoice.customer ?? null,
		subscriptionId: invoice.subscription ?? null,
	}
}
