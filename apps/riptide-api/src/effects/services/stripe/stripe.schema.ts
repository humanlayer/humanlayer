import * as Schema from 'effect/Schema'

export const StripeRequestIdSchema = Schema.String.check(Schema.isPattern(/^req_[A-Za-z0-9]+$/)).pipe(
	Schema.brand('StripeRequestId'),
)
export type StripeRequestId = Schema.Schema.Type<typeof StripeRequestIdSchema>

export const StripeErrorEnvelopeSchema = Schema.Struct({
	error: Schema.Struct({
		type: Schema.String,
		code: Schema.optional(Schema.String),
		decline_code: Schema.optional(Schema.String),
		param: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String),
		doc_url: Schema.optional(Schema.String),
	}),
})
export type StripeErrorEnvelope = Schema.Schema.Type<typeof StripeErrorEnvelopeSchema>

export const StripeCheckoutSessionStatusSchema = Schema.Union([
	Schema.Literal('complete'),
	Schema.Literal('open'),
	Schema.Literal('expired'),
	Schema.Null,
])

export const StripeCheckoutPaymentStatusSchema = Schema.Union([
	Schema.Literal('paid'),
	Schema.Literal('unpaid'),
	Schema.Literal('no_payment_required'),
])

export const StripeCheckoutModeSchema = Schema.Union([
	Schema.Literal('subscription'),
	Schema.Literal('payment'),
	Schema.Literal('setup'),
	Schema.Null,
])

export const StripeCheckoutSessionSchema = Schema.Struct({
	id: Schema.String,
	object: Schema.Literal('checkout.session'),
	status: StripeCheckoutSessionStatusSchema,
	payment_status: StripeCheckoutPaymentStatusSchema,
	mode: StripeCheckoutModeSchema,
	customer: Schema.Union([Schema.String, Schema.Null]),
	subscription: Schema.Union([Schema.String, Schema.Null]),
	url: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
})
export type StripeCheckoutSession = Schema.Schema.Type<typeof StripeCheckoutSessionSchema>

export const StripeSubscriptionStatusSchema = Schema.Union([
	Schema.Literal('incomplete'),
	Schema.Literal('incomplete_expired'),
	Schema.Literal('trialing'),
	Schema.Literal('active'),
	Schema.Literal('past_due'),
	Schema.Literal('canceled'),
	Schema.Literal('unpaid'),
	Schema.Literal('paused'),
])
export type StripeSubscriptionStatus = Schema.Schema.Type<typeof StripeSubscriptionStatusSchema>

export const StripeSubscriptionItemSchema = Schema.Struct({
	id: Schema.String,
	quantity: Schema.Union([Schema.Number, Schema.Null]),
	current_period_end: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
	price: Schema.Struct({ id: Schema.String }),
})

const StripePaymentMethodReferenceSchema = Schema.Union([
	Schema.String,
	Schema.Struct({ id: Schema.String }),
	Schema.Null,
])

export const StripeSubscriptionSchema = Schema.Struct({
	id: Schema.String,
	object: Schema.Literal('subscription'),
	customer: Schema.String,
	status: StripeSubscriptionStatusSchema,
	created: Schema.Number,
	default_payment_method: Schema.optional(StripePaymentMethodReferenceSchema),
	items: Schema.Struct({ data: Schema.Array(StripeSubscriptionItemSchema) }),
})
export type StripeSubscription = Schema.Schema.Type<typeof StripeSubscriptionSchema>

export const StripeSubscriptionListSchema = Schema.Struct({
	object: Schema.Literal('list'),
	data: Schema.Array(StripeSubscriptionSchema),
	has_more: Schema.Boolean,
})
export type StripeSubscriptionList = Schema.Schema.Type<typeof StripeSubscriptionListSchema>

export const StripeInvoiceSchema = Schema.Struct({
	id: Schema.String,
	object: Schema.Literal('invoice'),
	status: Schema.Union([
		Schema.Literal('draft'),
		Schema.Literal('open'),
		Schema.Literal('paid'),
		Schema.Literal('uncollectible'),
		Schema.Literal('void'),
		Schema.Null,
	]),
	subscription: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
	customer: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
})
export type StripeInvoice = Schema.Schema.Type<typeof StripeInvoiceSchema>

export const StripeInvoiceListSchema = Schema.Struct({
	object: Schema.Literal('list'),
	data: Schema.Array(StripeInvoiceSchema),
})
export type StripeInvoiceList = Schema.Schema.Type<typeof StripeInvoiceListSchema>
