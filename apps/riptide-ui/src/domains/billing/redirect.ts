import z from 'zod/v4'

export const billingRedirectSearchSchema = z.object({
	billing: z.string().optional(),
	billing_error: z.string().optional(),
})

export type BillingRedirectSearch = z.infer<typeof billingRedirectSearchSchema>

const successMessages = {
	starter_to_pro_finalized: 'Upgrade complete. Billing is now synced to Pro.',
	checkout_synced: 'Checkout complete. Billing is now synced.',
} as const

const errorMessages = {
	checkout_invalid_session: 'Checkout could not be verified. Please refresh billing or contact support.',
	checkout_plan_mismatch: 'Checkout completed, but the selected plan did not match. Please contact support.',
	checkout_finalize_failed:
		'Checkout completed, but billing finalization needs another sync. Please retry from Billing settings.',
	checkout_unavailable: 'Checkout status is temporarily unavailable. Please refresh billing in a moment.',
} as const

export function getBillingSuccessMessage(code: string | undefined): string | null {
	if (!code) return null
	return code in successMessages ? successMessages[code as keyof typeof successMessages] : 'Billing update complete.'
}

export function getBillingErrorMessage(code: string | undefined): string | null {
	if (!code) return null
	return code in errorMessages
		? errorMessages[code as keyof typeof errorMessages]
		: 'Unable to confirm checkout status. Please refresh billing.'
}

export function buildBillingSearchParams(search: BillingRedirectSearch): string {
	const params = new URLSearchParams()
	if (search.billing) params.set('billing', search.billing)
	if (search.billing_error) params.set('billing_error', search.billing_error)
	return params.toString()
}

export const parseBillingRedirectSearch = (search: unknown): BillingRedirectSearch =>
	billingRedirectSearchSchema.parse(search)

export const normalizeBillingRedirectSearch = parseBillingRedirectSearch
