import type {
	BillingKvCacheDecodeError,
	BillingKvCacheEncodeError,
	BillingKvUnavailableError,
} from '@humanlayer/billing/billing-kv'
import { Effect } from 'effect'

import { Sentry } from '../../../instrument'
import {
	StripeBillingSyncError,
	StripeCheckoutSessionNotFoundError,
	StripeOperationError,
	StripeResourceMissingError,
	StripeSubscriptionAlreadyGoneError,
	StripeSubscriptionNotFoundError,
} from './stripe.errors'
import type { StripeOrganizationResolveError, StripeProviderError } from './stripe.errors'

export type StripeObservationAttributes = Readonly<Record<string, string | number | boolean | null | undefined>>

/** Records any tagged Stripe failure while preserving its error channel. */
export const observeStripeErrors =
	(operation: string, attributes: StripeObservationAttributes) =>
	<A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
		effect.pipe(
			Effect.tapError((error) => {
				const annotations = { ...attributes, operation, error_type: error._tag }
				return Effect.logError('Stripe operation failed').pipe(
					Effect.annotateLogs(annotations),
					Effect.flatMap(() =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: error._tag, operation },
								extra: attributes,
							}),
						),
					),
					Effect.catchCause(() => Effect.void),
				)
			}),
		)

const narrowProvider =
	<M>(operation: string, missing: (cause: StripeResourceMissingError) => Effect.Effect<never, M>) =>
	<A, R>(effect: Effect.Effect<A, StripeProviderError, R>) =>
		effect.pipe(
			Effect.catchTags({
				StripeAuthenticationError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
				StripeRateLimitError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: true, cause })),
				StripeInvalidRequestError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
				StripeResourceMissingError: missing,
				StripeIdempotencyConflictError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
				StripeCardError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
				StripeApiUnavailableError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: true, cause })),
				StripeTransportError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: cause.retryable, cause })),
				StripeUnexpectedResponseError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
				StripeResponseDecodeError: (cause) =>
					Effect.fail(new StripeOperationError({ operation, retryable: false, cause })),
			}),
		)

/** Maps provider failures to the public operation error. */
export const narrowProviderErrors = (operation: string) =>
	narrowProvider(operation, (cause) => Effect.fail(new StripeOperationError({ operation, retryable: false, cause })))
/** Maps a missing checkout session to its public domain error. */
export const narrowCheckoutSessionRetrieveErrors = (sessionId: string) =>
	narrowProvider('retrieve_checkout_session', (cause) =>
		Effect.fail(new StripeCheckoutSessionNotFoundError({ sessionId, cause })),
	)
/** Maps a missing subscription to its public retrieval error. */
export const narrowSubscriptionRetrieveErrors = (subscriptionId: string) =>
	narrowProvider('retrieve_subscription', (cause) =>
		Effect.fail(new StripeSubscriptionNotFoundError({ subscriptionId, cause })),
	)
/** Maps a missing subscription to the idempotent cancellation result. */
export const narrowSubscriptionCancelErrors = (subscriptionId: string) =>
	narrowProvider('cancel_subscription', (cause) =>
		Effect.fail(new StripeSubscriptionAlreadyGoneError({ subscriptionId, requestId: cause.requestId, cause })),
	)

/** Maps cache failures to billing synchronization failures. */
export const narrowCacheErrors =
	(customerId: string) =>
	<A, R>(
		effect: Effect.Effect<A, BillingKvUnavailableError | BillingKvCacheDecodeError | BillingKvCacheEncodeError, R>,
	) =>
		effect.pipe(Effect.mapError((cause) => new StripeBillingSyncError({ customerId, dependency: 'cache', cause })))

/** Maps organization lookup failures to billing synchronization failures. */
export const narrowOrganizationResolveErrors =
	(customerId: string) =>
	<A, R>(effect: Effect.Effect<A, StripeOrganizationResolveError, R>) =>
		effect.pipe(
			Effect.catchTag('StripeOrganizationResolveError', (cause) =>
				Effect.fail(new StripeBillingSyncError({ customerId, dependency: 'postgres', cause })),
			),
		)
