import { Effect } from 'effect'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as Schema from 'effect/Schema'

import {
	StripeApiUnavailableError,
	StripeAuthenticationError,
	StripeCardError,
	StripeIdempotencyConflictError,
	StripeInvalidRequestError,
	StripeRateLimitError,
	StripeResourceMissingError,
	StripeResponseDecodeError,
	StripeUnexpectedResponseError,
} from './stripe.errors'
import type { StripeProviderError } from './stripe.errors'
import { StripeErrorEnvelopeSchema, StripeRequestIdSchema } from './stripe.schema'
import type { StripeErrorEnvelope, StripeRequestId } from './stripe.schema'

/** Decodes a Stripe HTTP response into either the requested schema or a tagged provider error. */
export const decodeStripeSuccessResponse = <A>(
	response: HttpClientResponse.HttpClientResponse,
	schema: Schema.ConstraintDecoder<A, never>,
	resource: string,
): Effect.Effect<A, StripeProviderError> => {
	const requestId = stripeRequestIdFromResponse(response)
	const decodeSuccess = Schema.decodeUnknownEffect(schema)
	const decodeError = Schema.decodeUnknownEffect(StripeErrorEnvelopeSchema)
	if (response.status >= 200 && response.status < 300) {
		const decoded = requestId.pipe(
			Effect.flatMap((requestId) =>
				response.json.pipe(
					Effect.flatMap((json) => decodeSuccess(json)),
					Effect.mapError(
						(cause) =>
							new StripeResponseDecodeError({
								status: response.status,
								requestId,
								resource,
								cause,
							}),
					),
				),
			),
		)
		return decoded
	}

	return requestId.pipe(
		Effect.flatMap((requestId) =>
			response.json.pipe(
				Effect.flatMap((json) => decodeError(json)),
				Effect.mapError(
					(cause) =>
						new StripeUnexpectedResponseError({
							status: response.status,
							requestId,
							reason: 'stripe_error_envelope_decode_failed',
							cause,
						}),
				),
				Effect.flatMap((envelope) =>
					Effect.fail(classifyStripeErrorEnvelope(response.status, requestId, envelope)),
				),
			),
		),
	)
}

/** Extracts Stripe's request ID from supported response headers and treats absence as a provider defect. */
export const stripeRequestIdFromResponse = (
	response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<StripeRequestId> => {
	return Schema.decodeUnknownEffect(StripeRequestIdSchema)(
		response.headers['request-id'] ?? response.headers['stripe-request-id'],
	).pipe(Effect.orDie)
}

/** Maps a decoded Stripe error envelope to the internal provider error vocabulary. */
const classifyStripeErrorEnvelope = (
	status: number,
	requestId: StripeRequestId,
	envelope: StripeErrorEnvelope,
): StripeProviderError => {
	const error = envelope.error
	const shared = {
		status,
		requestId,
		type: error.type,
		code: error.code,
		param: error.param,
		cause: envelope,
	}

	if (status === 401 || status === 403) {
		return new StripeAuthenticationError(shared)
	}
	if (status === 429) {
		return new StripeRateLimitError({ ...shared, retryable: true })
	}
	if (status === 404) {
		return new StripeResourceMissingError(shared)
	}
	if (status === 409 || error.code === 'idempotency_key_in_use') {
		return new StripeIdempotencyConflictError(shared)
	}
	if (error.type === 'card_error') {
		return new StripeCardError({ ...shared, declineCode: error.decline_code })
	}
	if (status >= 500) {
		return new StripeApiUnavailableError({ ...shared, retryable: true })
	}
	if (error.type === 'invalid_request_error') {
		return new StripeInvalidRequestError(shared)
	}

	return new StripeUnexpectedResponseError({
		status,
		requestId,
		reason: 'stripe_error_envelope_unclassified',
		cause: envelope,
	})
}
