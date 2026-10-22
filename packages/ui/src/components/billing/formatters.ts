import type { BillingNextInvoice, BillingPaymentMethod } from './types'

export function formatBillingAmount(amountInCents: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: currency.toUpperCase(),
	}).format(amountInCents / 100)
}

export function formatNextInvoice(invoice?: BillingNextInvoice | null): string {
	if (!invoice) {
		return 'Unavailable'
	}

	return formatBillingAmount(invoice.amountDue, invoice.currency)
}

export function formatPaymentMethod(paymentMethod?: BillingPaymentMethod | null): string {
	if (!paymentMethod) {
		return 'No payment method'
	}

	const brand = paymentMethod.brand?.trim()
	const last4 = paymentMethod.last4?.trim()
	const expiration =
		paymentMethod.expMonth && paymentMethod.expYear
			? ` exp ${String(paymentMethod.expMonth).padStart(2, '0')}/${paymentMethod.expYear}`
			: ''

	if (brand && last4) {
		return `${brand.toUpperCase()} ending in ${last4}${expiration}`
	}

	if (last4) {
		return `Card ending in ${last4}${expiration}`
	}

	return `Payment method on file${expiration}`
}
