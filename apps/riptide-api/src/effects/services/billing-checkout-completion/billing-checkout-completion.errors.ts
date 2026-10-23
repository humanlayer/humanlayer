import { Data } from 'effect'

export class CheckoutRedirectQueryParseError extends Data.TaggedError('CheckoutRedirectQueryParseError')<{
	readonly cause: unknown
}> {}

export class CheckoutSessionRetrieveError extends Data.TaggedError('CheckoutSessionRetrieveError')<{
	readonly sessionId: string
	readonly cause: unknown
}> {}

export class CheckoutSessionInvalidForOperationError extends Data.TaggedError(
	'CheckoutSessionInvalidForOperationError',
)<{
	readonly sessionId: string
	readonly reason: 'not_complete' | 'not_subscription_mode' | 'payment_not_paid'
}> {}

export class CheckoutSessionMissingCustomerError extends Data.TaggedError('CheckoutSessionMissingCustomerError')<{
	readonly sessionId: string
}> {}

export class CheckoutSessionMissingSubscriptionError extends Data.TaggedError(
	'CheckoutSessionMissingSubscriptionError',
)<{
	readonly sessionId: string
}> {}

export class SubscriptionRetrieveError extends Data.TaggedError('SubscriptionRetrieveError')<{
	readonly subscriptionId: string
	readonly cause: unknown
}> {}

export class SubscriptionInvalidPlanError extends Data.TaggedError('SubscriptionInvalidPlanError')<{
	readonly subscriptionId: string
	readonly expectedPriceId: string
	readonly cause?: unknown
}> {}

export class OrganizationResolveError extends Data.TaggedError('OrganizationResolveError')<{
	readonly customerId: string
	readonly cause?: unknown
}> {}

export class CustomerSubscriptionListError extends Data.TaggedError('CustomerSubscriptionListError')<{
	readonly customerId: string
	readonly cause: unknown
}> {}

export class StripeSubscriptionCancelError extends Data.TaggedError('StripeSubscriptionCancelError')<{
	readonly subscriptionId: string
	readonly cause: unknown
}> {}

export class CheckoutStripeKvSyncError extends Data.TaggedError('CheckoutStripeKvSyncError')<{
	readonly customerId: string
	readonly cause: unknown
}> {}

export type BillingCheckoutCompletionInternalError =
	| CheckoutRedirectQueryParseError
	| CheckoutSessionRetrieveError
	| CheckoutSessionInvalidForOperationError
	| CheckoutSessionMissingCustomerError
	| CheckoutSessionMissingSubscriptionError
	| SubscriptionRetrieveError
	| SubscriptionInvalidPlanError
	| OrganizationResolveError
	| CustomerSubscriptionListError
	| StripeSubscriptionCancelError
	| CheckoutStripeKvSyncError
