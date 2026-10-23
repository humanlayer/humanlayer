import { Effect, Match, Option } from 'effect'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as Schema from 'effect/Schema'

import {
	ResendApiUnavailableError,
	ResendAuthenticationError,
	ResendIdempotencyConflictError,
	ResendQuotaExceededError,
	ResendRateLimitError,
	ResendResourceMissingError,
	ResendResponseDecodeError,
	ResendUnexpectedResponseError,
	ResendValidationError,
} from './resend-errors'
import type { ResendProviderError } from './resend-errors'
import { ResendErrorEnvelopeSchema } from './resend.schema'
import type { ResendErrorEnvelope } from './resend.schema'

/** Decodes a Resend HTTP response into either the requested schema or a tagged provider error. */
export const decodeResendSuccessResponse = <A>(
	response: HttpClientResponse.HttpClientResponse,
	schema: Schema.ConstraintDecoder<A, never>,
	resource: string,
): Effect.Effect<A, ResendProviderError> => {
	if (response.status >= 200 && response.status < 300) {
		return response.json.pipe(
			Effect.mapError(
				(error) =>
					new ResendResponseDecodeError({
						status: response.status,
						providerErrorName: null,
						message: `Resend returned an unreadable ${resource} response`,
						retryable: false,
						resource,
						cause: error.reason.cause ?? new Error('Resend response JSON parsing failed without a cause'),
					}),
			),
			Effect.flatMap((json) =>
				Schema.decodeUnknownEffect(schema)(json).pipe(
					Effect.mapError(
						(cause) =>
							new ResendResponseDecodeError({
								status: response.status,
								providerErrorName: null,
								message: `Resend returned an invalid ${resource} response`,
								retryable: false,
								resource,
								cause,
							}),
					),
				),
			),
		)
	}

	return response.json.pipe(
		Effect.mapError(
			(error) =>
				new ResendApiUnavailableError({
					status: response.status,
					providerErrorName: null,
					message: 'Resend returned an unreadable error response',
					retryable: isDocumentedRetryableStatus(response.status),
					cause: error.reason.cause ?? new Error('Resend error response parsing failed without a cause'),
				}),
		),
		Effect.map((json) => Schema.decodeUnknownOption(ResendErrorEnvelopeSchema)(json)),
		Effect.flatMap((envelope) =>
			Option.match(envelope, {
				onNone: () =>
					Effect.fail(
						new ResendApiUnavailableError({
							status: response.status,
							providerErrorName: null,
							message: 'Resend returned an undecodable error response',
							retryable: isDocumentedRetryableStatus(response.status),
							cause: new Error('Resend error envelope decoding failed'),
						}),
					),
				onSome: (decodedEnvelope) =>
					Effect.fail(
						classifyResendFailure({
							status: response.status,
							retryAfterMs: resendRetryAfterMs(response),
							envelope: decodedEnvelope,
						}),
					),
			}),
		),
	)
}

const isDocumentedRetryableStatus = (status: number): boolean => status === 500 || status === 503

/** Maps a decoded Resend error envelope to the internal provider error vocabulary. */
export const classifyResendFailure = (input: {
	readonly status: number
	readonly retryAfterMs: number | undefined
	readonly envelope: ResendErrorEnvelope
}): ResendProviderError => {
	const details = {
		status: input.status,
		providerErrorName: input.envelope.name,
		message: input.envelope.message,
		cause: input.envelope,
	}
	const failure = { status: input.status, name: input.envelope.name }

	return Match.value(failure).pipe(
		Match.when({ status: 401 }, () => new ResendAuthenticationError({ ...details, retryable: false })),
		Match.whenOr(
			{ status: 403, name: 'missing_api_key' },
			{ status: 403, name: 'restricted_api_key' },
			{ status: 403, name: 'suspended_api_key' },
			{ status: 403, name: 'invalid_permission' },
			() => new ResendAuthenticationError({ ...details, retryable: false }),
		),
		Match.whenOr(
			{ status: 400, name: 'validation_error' },
			{ status: 400, name: 'invalid_idempotency_key' },
			{ status: 403, name: 'validation_error' },
			() => new ResendValidationError({ ...details, retryable: false }),
		),
		Match.when({ status: 422 }, () => new ResendValidationError({ ...details, retryable: false })),
		Match.when(
			{ status: 404, name: 'not_found' },
			() => new ResendResourceMissingError({ ...details, retryable: false }),
		),
		Match.whenOr(
			{ status: 409, name: 'concurrent_idempotent_requests' },
			{ status: 409, name: 'resource_locked' },
			() => new ResendIdempotencyConflictError({ ...details, retryable: true }),
		),
		Match.when(
			{ status: 409, name: 'invalid_idempotent_request' },
			() => new ResendIdempotencyConflictError({ ...details, retryable: false }),
		),
		Match.when(
			{ status: 429, name: 'rate_limit_exceeded' },
			() => new ResendRateLimitError({ ...details, retryable: true, retryAfterMs: input.retryAfterMs }),
		),
		Match.whenOr(
			{ status: 429, name: 'daily_quota_exceeded' },
			{ status: 429, name: 'monthly_quota_exceeded' },
			() => new ResendQuotaExceededError({ ...details, retryable: false }),
		),
		Match.when(
			{ status: (status: number) => status >= 500 },
			() => new ResendApiUnavailableError({ ...details, retryable: true }),
		),
		Match.orElse(
			({ status, name }) =>
				new ResendUnexpectedResponseError({
					...details,
					status,
					providerErrorName: name,
					retryable: false,
					reason: 'resend_error_envelope_unclassified',
				}),
		),
	)
}

const resendRetryAfterMs = (response: HttpClientResponse.HttpClientResponse): number | undefined =>
	Option.match(Schema.decodeUnknownOption(Schema.NumberFromString)(response.headers['retry-after']), {
		onNone: () => undefined,
		onSome: (seconds) => seconds * 1_000,
	})
