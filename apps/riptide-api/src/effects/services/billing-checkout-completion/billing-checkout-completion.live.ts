import { Config, Effect, Layer, Match, Predicate, Result } from 'effect'
import type * as Cause from 'effect/Cause'
import * as Schema from 'effect/Schema'

import { Sentry } from '../../../instrument'
import type { BillingCheckoutCompletionInternalError } from './billing-checkout-completion.errors'
import { CheckoutRedirectQueryParseError } from './billing-checkout-completion.errors'
import {
	cancelStarterSubscriptions,
	requireProSubscription,
	resolveOrganizationByCustomer,
	retrieveSubscriptionForCompletion,
	syncCustomerBillingToKvForCompletion,
	verifyCompleteCustomerSession,
	verifyCompleteSubscriptionSession,
} from './billing-checkout-completion.operations'
import { CheckoutRedirectQuerySchema, ClientSchema } from './billing-checkout-completion.schema'
import type {
	BillingErrorCode,
	BillingSuccessCode,
	CheckoutRedirectQuery,
	Client,
} from './billing-checkout-completion.schema'
import { BillingCheckoutCompletionService } from './billing-checkout-completion.service'
import type {
	CheckoutCompletionFailureRedirectInput,
	CheckoutCompletionRedirect,
	CheckoutCompletionSuccessRedirectInput,
	CheckoutRedirectInput,
	RedirectOrigins,
} from './billing-checkout-completion.types'

export const BillingCheckoutCompletionServiceLive = Layer.effect(
	BillingCheckoutCompletionService,
	Effect.gen(function* () {
		const origins: RedirectOrigins = {
			appOrigin: yield* Config.URL('APP_ORIGIN'),
			cloudOrigin: yield* Config.URL('CLOUD_ORIGIN'),
		}
		const proPriceId = yield* Config.String('STRIPE_PRICE_PRO')
		const starterPriceId = yield* Config.String('STRIPE_PRICE_STARTER')

		const extractRawQuery = (
			url: string,
		): Effect.Effect<Record<string, unknown>, CheckoutRedirectQueryParseError> =>
			Effect.try({
				try: () => {
					const searchParams = new URL(url).searchParams
					return Object.fromEntries(
						[...new Set(searchParams.keys())].map((key) => {
							const values = searchParams.getAll(key)
							return [key, values.length > 1 ? values : values[0]]
						}),
					)
				},
				catch: (cause) => new CheckoutRedirectQueryParseError({ cause }),
			})

		const parseClientOrCloud = (rawQuery: Record<string, unknown>) =>
			Schema.decodeUnknownEffect(ClientSchema)(rawQuery.client).pipe(
				Effect.result,
				Effect.map((result) =>
					Result.isSuccess(result)
						? { client: result.success, isValid: true as const }
						: { client: 'cloud' as const, isValid: false as const },
				),
			)

		const parseQuery = (
			rawQuery: Record<string, unknown>,
		): Effect.Effect<CheckoutRedirectQuery, CheckoutRedirectQueryParseError> =>
			Schema.decodeUnknownEffect(CheckoutRedirectQuerySchema)(rawQuery).pipe(
				Effect.mapError((cause) => new CheckoutRedirectQueryParseError({ cause })),
			)

		const finalizeStarterToProUpgrade = (query: CheckoutRedirectQuery) =>
			Effect.gen(function* () {
				const verified = yield* verifyCompleteSubscriptionSession(query)
				yield* Effect.annotateCurrentSpan({ customer_id: verified.customerId })

				const subscription = yield* retrieveSubscriptionForCompletion({
					subscriptionId: verified.subscriptionId,
					proPriceId,
				})
				yield* requireProSubscription({ subscription, proPriceId })
				const organization = yield* resolveOrganizationByCustomer(verified.customerId)
				yield* Effect.annotateCurrentSpan({ organization_id: organization.organizationId })

				yield* cancelStarterSubscriptions({ customerId: verified.customerId, starterPriceId })
				yield* syncCustomerBillingToKvForCompletion(verified.customerId)

				return buildSuccessRedirect({ origins, client: query.client, successCode: 'starter_to_pro_finalized' })
			})

		const resyncCheckout = (query: CheckoutRedirectQuery) =>
			Effect.gen(function* () {
				const verified = yield* verifyCompleteCustomerSession(query)
				yield* Effect.annotateCurrentSpan({ customer_id: verified.customerId })
				const organization = yield* resolveOrganizationByCustomer(verified.customerId)
				yield* Effect.annotateCurrentSpan({ organization_id: organization.organizationId })

				yield* syncCustomerBillingToKvForCompletion(verified.customerId)

				return buildSuccessRedirect({ origins, client: query.client, successCode: 'checkout_synced' })
			})

		const completeRedirect = <R>(
			input: CheckoutRedirectInput,
			operation: 'finalize_starter_to_pro_upgrade' | 'resync',
			program: (
				query: CheckoutRedirectQuery,
			) => Effect.Effect<CheckoutCompletionRedirect, BillingCheckoutCompletionInternalError, R>,
		) =>
			Effect.gen(function* () {
				const rawQuery = yield* extractRawQuery(input.url)
				const parsedClient = yield* parseClientOrCloud(rawQuery)
				if (!parsedClient.isValid) {
					return buildFailureRedirect({
						origins,
						client: parsedClient.client,
						errorCode: 'checkout_invalid_session',
					})
				}

				return yield* Effect.gen(function* () {
					const query = yield* parseQuery(rawQuery)
					return yield* program(query)
				}).pipe(captureThenNarrow({ origins, client: parsedClient.client, operation }))
			}).pipe(
				Effect.catchCause((cause) =>
					captureUnexpectedCause(cause, operation).pipe(
						Effect.as(
							buildFailureRedirect({
								origins,
								client: 'cloud',
								errorCode: 'checkout_unavailable',
							}),
						),
					),
				),
				Effect.withSpan(`billing_checkout.${operation}`),
			)

		return {
			finalizeStarterToProUpgradeFromRedirect: (input) =>
				completeRedirect(input, 'finalize_starter_to_pro_upgrade', finalizeStarterToProUpgrade),
			resyncFromCheckoutRedirect: (input) => completeRedirect(input, 'resync', resyncCheckout),
		}
	}),
)

function captureThenNarrow(input: {
	readonly origins: RedirectOrigins
	readonly client: Client
	readonly operation: string
}) {
	return <R>(effect: Effect.Effect<CheckoutCompletionRedirect, BillingCheckoutCompletionInternalError, R>) =>
		effect.pipe(
			Effect.tapError((error) => logCheckoutCompletionError(error, input.operation)),
			Effect.tapError((error) => captureCheckoutCompletionError(error, input.operation)),
			Effect.catchTags({
				CheckoutRedirectQueryParseError: () => redirect('checkout_invalid_session', input),
				CheckoutSessionInvalidForOperationError: () => redirect('checkout_invalid_session', input),
				CheckoutSessionMissingCustomerError: () => redirect('checkout_invalid_session', input),
				CheckoutSessionMissingSubscriptionError: () => redirect('checkout_plan_mismatch', input),
				SubscriptionInvalidPlanError: () => redirect('checkout_plan_mismatch', input),
				CheckoutSessionRetrieveError: () => redirect('checkout_unavailable', input),
				SubscriptionRetrieveError: () => redirect('checkout_unavailable', input),
				OrganizationResolveError: () => redirect('checkout_finalize_failed', input),
				CustomerSubscriptionListError: () => redirect('checkout_finalize_failed', input),
				StripeSubscriptionCancelError: () => redirect('checkout_finalize_failed', input),
				CheckoutStripeKvSyncError: () => redirect('checkout_finalize_failed', input),
			}),
			Effect.catchCause((cause) =>
				captureUnexpectedCause(cause, input.operation).pipe(
					Effect.as(
						buildFailureRedirect({
							origins: input.origins,
							client: input.client,
							errorCode: 'checkout_unavailable',
						}),
					),
				),
			),
		)
}

function redirect(errorCode: BillingErrorCode, input: { readonly origins: RedirectOrigins; readonly client: Client }) {
	return Effect.succeed(buildFailureRedirect({ origins: input.origins, client: input.client, errorCode }))
}

function buildSuccessRedirect(input: CheckoutCompletionSuccessRedirectInput): CheckoutCompletionRedirect {
	return { redirectUrl: buildRedirectUrl(input.origins, input.client, 'billing', input.successCode) }
}

function buildFailureRedirect(input: CheckoutCompletionFailureRedirectInput): CheckoutCompletionRedirect {
	return { redirectUrl: buildRedirectUrl(input.origins, input.client, 'billing_error', input.errorCode) }
}

function buildRedirectUrl(
	origins: RedirectOrigins,
	client: Client,
	paramName: 'billing' | 'billing_error',
	paramValue: BillingSuccessCode | BillingErrorCode,
): string {
	const base = client === 'cloud' ? origins.cloudOrigin : origins.appOrigin
	const path = client === 'cloud' ? '/settings' : client === 'native' ? '/billing/return' : '/settings/billing'
	const url = new URL(path, base)
	url.searchParams.set(paramName, paramValue)
	return url.toString()
}

function logCheckoutCompletionError(error: BillingCheckoutCompletionInternalError, operation: string) {
	if (isExpectedCheckoutCompletionError(error)) return Effect.void
	return Effect.logError('Billing checkout completion failed').pipe(
		Effect.annotateLogs({ operation, ...errorLogAnnotations(error) }),
	)
}

function captureCheckoutCompletionError(error: BillingCheckoutCompletionInternalError, operation: string) {
	return Effect.fail(error).pipe(
		Effect.catchTags({
			CheckoutRedirectQueryParseError: () => Effect.void,
			CheckoutSessionInvalidForOperationError: () => Effect.void,
			CheckoutSessionMissingCustomerError: (cause) => captureException(cause, operation),
			CheckoutSessionMissingSubscriptionError: (cause) => captureException(cause, operation),
			SubscriptionInvalidPlanError: () => Effect.void,
			CheckoutSessionRetrieveError: (cause) => captureException(cause, operation),
			SubscriptionRetrieveError: (cause) => captureException(cause, operation),
			OrganizationResolveError: (cause) => captureException(cause, operation),
			CustomerSubscriptionListError: (cause) => captureException(cause, operation),
			StripeSubscriptionCancelError: (cause) => captureException(cause, operation),
			CheckoutStripeKvSyncError: (cause) => captureException(cause, operation),
		}),
	)
}

function isExpectedCheckoutCompletionError(error: BillingCheckoutCompletionInternalError): boolean {
	return [
		Predicate.isTagged('CheckoutRedirectQueryParseError'),
		Predicate.isTagged('CheckoutSessionInvalidForOperationError'),
		Predicate.isTagged('SubscriptionInvalidPlanError'),
	].some((isExpected) => isExpected(error))
}

function captureException(error: BillingCheckoutCompletionInternalError, operation: string) {
	return Effect.sync(() =>
		Sentry.captureException(error, {
			tags: { error_type: error._tag, operation },
			extra: errorLogAnnotations(error),
		}),
	)
}

function captureUnexpectedCause(cause: Cause.Cause<unknown>, operation: string) {
	return Effect.logError('Billing checkout completion defect').pipe(
		Effect.annotateLogs({ operation }),
		Effect.flatMap(() =>
			Effect.sync(() =>
				Sentry.captureException(cause, {
					tags: { error_type: 'billing_checkout_completion_defect', operation },
				}),
			),
		),
	)
}

function errorLogAnnotations(error: BillingCheckoutCompletionInternalError) {
	return Match.value(error).pipe(
		Match.tagsExhaustive({
			CheckoutRedirectQueryParseError: (cause) => ({ error_type: cause._tag }),
			CheckoutSessionRetrieveError: (cause) => ({
				error_type: cause._tag,
				checkout_session_id: cause.sessionId,
			}),
			CheckoutSessionInvalidForOperationError: (cause) => ({
				error_type: cause._tag,
				checkout_session_id: cause.sessionId,
				reason: cause.reason,
			}),
			CheckoutSessionMissingCustomerError: (cause) => ({
				error_type: cause._tag,
				checkout_session_id: cause.sessionId,
			}),
			CheckoutSessionMissingSubscriptionError: (cause) => ({
				error_type: cause._tag,
				checkout_session_id: cause.sessionId,
			}),
			SubscriptionRetrieveError: (cause) => ({
				error_type: cause._tag,
				subscription_id: cause.subscriptionId,
			}),
			SubscriptionInvalidPlanError: (cause) => ({
				error_type: cause._tag,
				subscription_id: cause.subscriptionId,
				expected_price_id: cause.expectedPriceId,
			}),
			OrganizationResolveError: (cause) => ({ error_type: cause._tag, customer_id: cause.customerId }),
			CustomerSubscriptionListError: (cause) => ({ error_type: cause._tag, customer_id: cause.customerId }),
			StripeSubscriptionCancelError: (cause) => ({
				error_type: cause._tag,
				subscription_id: cause.subscriptionId,
			}),
			CheckoutStripeKvSyncError: (cause) => ({ error_type: cause._tag, customer_id: cause.customerId }),
		}),
	)
}
