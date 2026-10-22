import { Effect, Redacted } from 'effect'
import * as Schema from 'effect/Schema'
import Stripe from 'stripe'

import { StripeWebhookPayloadError, StripeWebhookSignatureError } from './stripe.errors'

/** Signature-verified Stripe SDK event fields consumed by billing webhook handling. */
export const VerifiedStripeSdkWebhookEventSchema = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	created: Schema.Number,
	data: Schema.Struct({ object: Schema.Unknown }),
})

/** Signature-verified Stripe SDK event decoded at the adapter boundary. */
export type VerifiedStripeSdkWebhookEvent = Schema.Schema.Type<typeof VerifiedStripeSdkWebhookEventSchema>

type StripeWebhookAdapterError = StripeWebhookSignatureError | StripeWebhookPayloadError

const mapStripeSdkWebhookVerificationError = (cause: unknown): StripeWebhookSignatureError =>
	new StripeWebhookSignatureError({ cause })

/** Creates the narrow Stripe SDK adapter used only to verify webhook signatures. */
export const makeStripeWebhookSignatureVerifier = (input: {
	readonly apiKey: Redacted.Redacted<string>
	readonly webhookSecret: Redacted.Redacted<string>
}) => {
	const client = new Stripe(Redacted.value(input.apiKey))
	return {
		constructWebhookEvent: (request: {
			readonly body: string
			readonly signature: string
		}): Effect.Effect<VerifiedStripeSdkWebhookEvent, StripeWebhookAdapterError> =>
			Effect.tryPromise({
				try: () =>
					client.webhooks.constructEventAsync(
						request.body,
						request.signature,
						Redacted.value(input.webhookSecret),
					),
				catch: mapStripeSdkWebhookVerificationError,
			}).pipe(
				Effect.flatMap((event) =>
					Schema.decodeUnknownEffect(VerifiedStripeSdkWebhookEventSchema)(event).pipe(
						Effect.mapError((cause) => new StripeWebhookPayloadError({ cause })),
					),
				),
				Effect.withSpan('stripe_adapter.construct_webhook_event'),
			),
	}
}
