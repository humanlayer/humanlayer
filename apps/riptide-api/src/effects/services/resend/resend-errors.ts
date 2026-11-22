import { Data } from 'effect'

type ResendProviderErrorDetails = {
	readonly status: number | null
	readonly providerErrorName: string | null
	readonly message: string
	readonly retryable: boolean
	readonly retryAfterMs?: number
	readonly cause: unknown
}

export class ResendAuthenticationError extends Data.TaggedError(
	'ResendAuthenticationError',
)<ResendProviderErrorDetails> {}

export class ResendValidationError extends Data.TaggedError('ResendValidationError')<ResendProviderErrorDetails> {}

export class ResendResourceMissingError extends Data.TaggedError(
	'ResendResourceMissingError',
)<ResendProviderErrorDetails> {}

export class ResendIdempotencyConflictError extends Data.TaggedError(
	'ResendIdempotencyConflictError',
)<ResendProviderErrorDetails> {}

export class ResendRateLimitError extends Data.TaggedError('ResendRateLimitError')<ResendProviderErrorDetails> {}

export class ResendQuotaExceededError extends Data.TaggedError(
	'ResendQuotaExceededError',
)<ResendProviderErrorDetails> {}

export class ResendApiUnavailableError extends Data.TaggedError(
	'ResendApiUnavailableError',
)<ResendProviderErrorDetails> {}

export class ResendTransportError extends Data.TaggedError('ResendTransportError')<
	ResendProviderErrorDetails & {
		readonly method: string
		readonly path_template: string
	}
> {}

export class ResendUnexpectedResponseError extends Data.TaggedError('ResendUnexpectedResponseError')<
	ResendProviderErrorDetails & { readonly reason: string }
> {}

export class ResendResponseDecodeError extends Data.TaggedError('ResendResponseDecodeError')<
	ResendProviderErrorDetails & { readonly resource: string }
> {}

export class ResendNotCancelableError extends Data.TaggedError('ResendNotCancelableError')<{
	readonly emailId: string
	readonly cause: ResendResourceMissingError
}> {}

/**
 * This deployment cannot send email: at least one of RESEND_API_KEY, RESEND_FROM_EMAIL, or
 * RESEND_PRODUCT_USERS_SEGMENT_ID is missing. Callers that send in the background skip it quietly.
 */
export class EmailNotConfiguredError extends Data.TaggedError('EmailNotConfiguredError')<{
	readonly operation: string
}> {}

export type ResendOperationErrorCategory =
	| 'authentication'
	| 'invalid_request'
	| 'resource_missing'
	| 'conflict'
	| 'rate_limited'
	| 'quota_exceeded'
	| 'unavailable'
	| 'unexpected_response'

export class ResendOperationError extends Data.TaggedError('ResendOperationError')<{
	readonly operation: string
	readonly category: ResendOperationErrorCategory
	readonly retryable: boolean
	readonly message?: string
}> {}

export type ResendProviderError =
	| ResendAuthenticationError
	| ResendValidationError
	| ResendResourceMissingError
	| ResendIdempotencyConflictError
	| ResendRateLimitError
	| ResendQuotaExceededError
	| ResendApiUnavailableError
	| ResendTransportError
	| ResendUnexpectedResponseError
	| ResendResponseDecodeError

export type ResendError = ResendOperationError | ResendNotCancelableError | EmailNotConfiguredError
