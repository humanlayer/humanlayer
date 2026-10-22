import { Effect, Option, SchemaTransformation } from 'effect'
import * as Schema from 'effect/Schema'

import type { VerifiedStripeSdkWebhookEvent } from './stripe-webhook-signature-verifier'
import { StripeWebhookPayloadError } from './stripe.errors'

/**
 * Canonical Stripe event types that require billing-cache synchronization.
 *
 * This is the schema-driven equivalent of the tracked-event list removed from
 * the legacy Stripe webhook implementation; no second runtime list is kept.
 */
export const StripeBillingWebhookEventTypeSchema = Schema.Literals([
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'customer.subscription.paused',
	'customer.subscription.resumed',
	'customer.subscription.pending_update_applied',
	'customer.subscription.pending_update_expired',
	'customer.subscription.trial_will_end',
	'invoice.paid',
	'invoice.payment_failed',
	'invoice.payment_action_required',
	'invoice.upcoming',
	'invoice.marked_uncollectible',
	'invoice.payment_succeeded',
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'payment_intent.canceled',
])

/** Stripe event type that triggers billing-cache synchronization. */
export type StripeBillingWebhookEventType = Schema.Schema.Type<typeof StripeBillingWebhookEventTypeSchema>

const StripeWebhookCustomerIdSchema = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]).pipe(
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform({
			decode: (customer) => (typeof customer === 'string' ? customer : customer.id),
			encode: (customerId) => customerId,
		}),
	),
)

const StripeWebhookObjectSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	customer: StripeWebhookCustomerIdSchema,
})

const UntrackedStripeBillingWebhookSchema = Schema.Struct({
	tracked: Schema.Literal(false),
	eventId: Schema.String,
	eventType: Schema.String,
})

const TrackedStripeBillingWebhookSchema = Schema.Struct({
	tracked: Schema.Literal(true),
	eventId: Schema.String,
	eventType: StripeBillingWebhookEventTypeSchema,
	customerId: Schema.String,
	objectId: Schema.NullOr(Schema.String),
})

/** Parsed billing webhook result consumed by webhook dispatch. */
export const ParsedStripeBillingWebhookSchema = Schema.Union([
	UntrackedStripeBillingWebhookSchema,
	TrackedStripeBillingWebhookSchema,
])

/** Parsed billing webhook result derived from its canonical Effect schema. */
export type ParsedStripeBillingWebhook = Schema.Schema.Type<typeof ParsedStripeBillingWebhookSchema>

/** Parses a signature-verified Stripe event into the billing webhook domain model. */
export const parseVerifiedWebhook = (event: VerifiedStripeSdkWebhookEvent) =>
	Effect.gen(function* () {
		const eventType = yield* Schema.decodeUnknownEffect(StripeBillingWebhookEventTypeSchema)(event.type).pipe(
			Effect.option,
		)
		const trackedEventType = Option.getOrUndefined(eventType)
		if (!trackedEventType) return { tracked: false, eventId: event.id, eventType: event.type } as const

		const object = yield* Schema.decodeUnknownEffect(StripeWebhookObjectSchema)(event.data.object).pipe(
			Effect.mapError((cause) => new StripeWebhookPayloadError({ cause })),
		)
		return {
			tracked: true,
			eventId: event.id,
			eventType: trackedEventType,
			customerId: object.customer,
			objectId: object.id ?? null,
		} as const
	})
