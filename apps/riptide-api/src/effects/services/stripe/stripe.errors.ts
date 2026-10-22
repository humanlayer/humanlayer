import type {
	BillingKvCacheDecodeError,
	BillingKvCacheEncodeError,
	BillingKvUnavailableError,
} from '@humanlayer/billing/billing-kv'
import { Data } from 'effect'

import type { StripeRequestId } from './stripe.schema'

export class StripeAuthenticationError extends Data.TaggedError('StripeAuthenticationError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly param?: string
	readonly cause?: unknown
}> {}

export class StripeRateLimitError extends Data.TaggedError('StripeRateLimitError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly retryable: true
	readonly cause?: unknown
}> {}

export class StripeInvalidRequestError extends Data.TaggedError('StripeInvalidRequestError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly param?: string
	readonly cause?: unknown
}> {}

export class StripeResourceMissingError extends Data.TaggedError('StripeResourceMissingError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly param?: string
	readonly cause?: unknown
}> {}

export class StripeIdempotencyConflictError extends Data.TaggedError('StripeIdempotencyConflictError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly cause?: unknown
}> {}

export class StripeCardError extends Data.TaggedError('StripeCardError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly declineCode?: string
	readonly param?: string
	readonly cause?: unknown
}> {}

export class StripeApiUnavailableError extends Data.TaggedError('StripeApiUnavailableError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly type?: string
	readonly code?: string
	readonly retryable: true
	readonly cause?: unknown
}> {}

export class StripeTransportError extends Data.TaggedError('StripeTransportError')<{
	readonly method: string
	readonly path: string
	readonly retryable: boolean
	readonly cause: unknown
}> {}

export class StripeUnexpectedResponseError extends Data.TaggedError('StripeUnexpectedResponseError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly reason: string
	readonly cause?: unknown
}> {}

export class StripeResponseDecodeError extends Data.TaggedError('StripeResponseDecodeError')<{
	readonly status: number
	readonly requestId: StripeRequestId
	readonly resource: string
	readonly cause: unknown
}> {}

export class StripeSubscriptionAlreadyGoneError extends Data.TaggedError('StripeSubscriptionAlreadyGoneError')<{
	readonly subscriptionId: string
	readonly requestId: StripeRequestId
	readonly cause?: unknown
}> {}

export class StripeBillingCacheError extends Data.TaggedError('StripeBillingCacheError')<{
	readonly operation:
		| 'get_subscription'
		| 'set_subscription'
		| 'set_customer_organization'
		| 'set_organization_customer'
	readonly customerId: string
	readonly cause: unknown
}> {}

export class StripeOrganizationResolveError extends Data.TaggedError('StripeOrganizationResolveError')<{
	readonly customerId: string
	readonly cause: unknown
}> {}

export class StripeCheckoutSessionNotFoundError extends Data.TaggedError('StripeCheckoutSessionNotFoundError')<{
	readonly sessionId: string
	readonly cause: StripeResourceMissingError
}> {}

export class StripeSubscriptionNotFoundError extends Data.TaggedError('StripeSubscriptionNotFoundError')<{
	readonly subscriptionId: string
	readonly cause: StripeResourceMissingError
}> {}

export class StripeOperationError extends Data.TaggedError('StripeOperationError')<{
	readonly operation: string
	readonly retryable: boolean
	readonly cause: StripeProviderError
}> {}

export class StripeBillingSyncError extends Data.TaggedError('StripeBillingSyncError')<{
	readonly customerId: string
	readonly dependency: 'cache' | 'postgres'
	readonly cause:
		| BillingKvUnavailableError
		| BillingKvCacheDecodeError
		| BillingKvCacheEncodeError
		| StripeOrganizationResolveError
}> {}

export class StripeServiceInputParseError extends Data.TaggedError('StripeServiceInputParseError')<{
	readonly operation: string
	readonly cause: unknown
}> {}

export class StripeWebhookSignatureError extends Data.TaggedError('StripeWebhookSignatureError')<{
	readonly cause: unknown
}> {}

export class StripeWebhookPayloadError extends Data.TaggedError('StripeWebhookPayloadError')<{
	readonly cause: unknown
}> {}

export type StripeWebhookError =
	| StripeWebhookSignatureError
	| StripeWebhookPayloadError
	| StripeSyncCustomerBillingError

export type StripeProviderError =
	| StripeAuthenticationError
	| StripeRateLimitError
	| StripeInvalidRequestError
	| StripeResourceMissingError
	| StripeIdempotencyConflictError
	| StripeCardError
	| StripeApiUnavailableError
	| StripeTransportError
	| StripeUnexpectedResponseError
	| StripeResponseDecodeError

export type StripeRetrieveCheckoutSessionError =
	| StripeServiceInputParseError
	| StripeCheckoutSessionNotFoundError
	| StripeOperationError

export type StripeRetrieveSubscriptionError =
	| StripeServiceInputParseError
	| StripeSubscriptionNotFoundError
	| StripeOperationError

export type StripeListCustomerSubscriptionsError = StripeServiceInputParseError | StripeOperationError

export type StripeCancelSubscriptionError =
	| StripeServiceInputParseError
	| StripeSubscriptionAlreadyGoneError
	| StripeOperationError

export type StripeCheckoutSessionCreateError = StripeServiceInputParseError | StripeOperationError

export type StripeSyncCustomerBillingError =
	| StripeServiceInputParseError
	| StripeBillingSyncError
	| StripeOperationError

export type StripeServiceError =
	| StripeServiceInputParseError
	| StripeCheckoutSessionNotFoundError
	| StripeSubscriptionNotFoundError
	| StripeOperationError
	| StripeSubscriptionAlreadyGoneError
	| StripeBillingSyncError
