import * as Schema from 'effect/Schema'

export const ClientSchema = Schema.Union([Schema.Literal('ui'), Schema.Literal('cloud'), Schema.Literal('native')])
export type Client = Schema.Schema.Type<typeof ClientSchema>

export const CheckoutRedirectQuerySchema = Schema.Struct({
	session_id: Schema.NonEmptyString,
	client: ClientSchema,
})
export type CheckoutRedirectQuery = Schema.Schema.Type<typeof CheckoutRedirectQuerySchema>

export const BillingErrorCodeSchema = Schema.Union([
	Schema.Literal('checkout_invalid_session'),
	Schema.Literal('checkout_plan_mismatch'),
	Schema.Literal('checkout_finalize_failed'),
	Schema.Literal('checkout_unavailable'),
])
export type BillingErrorCode = Schema.Schema.Type<typeof BillingErrorCodeSchema>

export const BillingSuccessCodeSchema = Schema.Union([
	Schema.Literal('starter_to_pro_finalized'),
	Schema.Literal('checkout_synced'),
])
export type BillingSuccessCode = Schema.Schema.Type<typeof BillingSuccessCodeSchema>

export const CheckoutRedirectInputSchema = Schema.Struct({ url: Schema.String })
export type CheckoutRedirectInput = Schema.Schema.Type<typeof CheckoutRedirectInputSchema>

export const CheckoutCompletionRedirectSchema = Schema.Struct({ redirectUrl: Schema.String })
export type CheckoutCompletionRedirect = Schema.Schema.Type<typeof CheckoutCompletionRedirectSchema>

export const ResolvedCheckoutOrganizationSchema = Schema.Struct({
	organizationId: Schema.String,
	stripeCustomerId: Schema.String,
})
export type ResolvedCheckoutOrganization = Schema.Schema.Type<typeof ResolvedCheckoutOrganizationSchema>
