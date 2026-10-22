import { Effect } from 'effect'

import { Sentry } from '../../../instrument'
import { ResendOperationError } from './resend-errors'
import type {
	ResendError,
	ResendNotCancelableError,
	ResendOperationErrorCategory,
	ResendProviderError,
} from './resend-errors'

export type ResendObservationAttributes = Readonly<Record<string, string | number | boolean | null | undefined>>

const captureResendProviderError =
	(operation: string, attributes: ResendObservationAttributes) => (error: ResendProviderError) => {
		const annotations = {
			...attributes,
			operation,
			error_type: error._tag,
			status: error.status,
			provider_error_name: error.providerErrorName,
			retryable: error.retryable,
		}
		return Effect.logError('Resend operation failed').pipe(
			Effect.annotateLogs(annotations),
			Effect.andThen(
				Effect.sync(() =>
					Sentry.captureException(error, {
						tags: {
							error_type: error._tag,
							operation,
							retryable: String(error.retryable),
						},
						extra: {
							...attributes,
							status: error.status,
							provider_error_name: error.providerErrorName,
						},
					}),
				),
			),
			Effect.catchCause(() => Effect.void),
		)
	}

/** Records provider failures before public error narrowing, excluding expected cancellation races. */
export const observeResendErrors =
	(operation: string, attributes: ResendObservationAttributes) =>
	<A, R>(effect: Effect.Effect<A, ResendProviderError | ResendNotCancelableError, R>) =>
		effect.pipe(
			Effect.tapError((error) =>
				Effect.fail(error).pipe(
					Effect.catchTag('ResendNotCancelableError', () => Effect.void),
					Effect.catchTag('ResendResourceMissingError', () => Effect.void),
					Effect.tapError(captureResendProviderError(operation, attributes)),
				),
			),
		)

const operationError = (operation: string, category: ResendOperationErrorCategory, cause: ResendProviderError) =>
	Effect.fail(new ResendOperationError({ operation, category, retryable: cause.retryable, message: cause.message }))

/** Maps rich provider failures to the caller-actionable Resend error union. */
export const narrowProviderErrors =
	(operation: string) =>
	<A, R>(
		effect: Effect.Effect<A, ResendProviderError | ResendNotCancelableError, R>,
	): Effect.Effect<A, ResendError, R> =>
		effect.pipe(
			Effect.catchTags({
				ResendAuthenticationError: (cause) => operationError(operation, 'authentication', cause),
				ResendValidationError: (cause) => operationError(operation, 'invalid_request', cause),
				ResendResourceMissingError: (cause) => operationError(operation, 'resource_missing', cause),
				ResendIdempotencyConflictError: (cause) => operationError(operation, 'conflict', cause),
				ResendRateLimitError: (cause) => operationError(operation, 'rate_limited', cause),
				ResendQuotaExceededError: (cause) => operationError(operation, 'quota_exceeded', cause),
				ResendApiUnavailableError: (cause) => operationError(operation, 'unavailable', cause),
				ResendTransportError: (cause) => operationError(operation, 'unavailable', cause),
				ResendUnexpectedResponseError: (cause) => operationError(operation, 'unexpected_response', cause),
				ResendResponseDecodeError: (cause) => operationError(operation, 'unexpected_response', cause),
				ResendNotCancelableError: (cause) => Effect.fail(cause),
			}),
		)
