import type { ReadableStripeSubscriptionCache } from '@humanlayer/billing/billing-kv'
import { Effect, Predicate } from 'effect'

import { captureBlocked, captureFailOpen } from './billing-access-telemetry'
import type { BillingStepFailure } from './billing-access.errors'
import type { BillingAccessDecision, BillingAccessInput } from './billing-access.service'

const ALLOWED_STATUSES = new Set(['active', 'trialing'])

export const decisionForFailure = (
	failure: BillingStepFailure,
	input: BillingAccessInput,
): Effect.Effect<BillingAccessDecision> => {
	if (failure.step !== 'stripe_refresh') {
		return Effect.succeed('fail_open')
	}

	const error = failure.error
	const kvRefreshFailure =
		Predicate.isTagged(error, 'BillingKvUnavailableError') ||
		(Predicate.isTagged(error, 'StripeBillingSyncError') && error.dependency === 'cache')

	return kvRefreshFailure
		? captureFailOpen(input, 'kv_refresh_error', error).pipe(Effect.as('fail_open' as const))
		: captureBlocked(input, { reason: 'subscription_refresh_failed', error }).pipe(Effect.as('blocked' as const))
}

export const decideFromCache = (
	cache: ReadableStripeSubscriptionCache,
	input: BillingAccessInput,
): Effect.Effect<BillingAccessDecision> =>
	Effect.gen(function* () {
		if (cache.subscriptionId && ALLOWED_STATUSES.has(cache.status)) {
			yield* Effect.logInfo('Billing access allowed for billing-required operation').pipe(
				Effect.annotateLogs({
					operation: input.operation,
					organizationId: input.organizationId,
					subscriptionStatus: cache.status,
				}),
			)
			return 'allowed'
		}

		yield* captureBlocked(input, {
			reason: cache.subscriptionId ? 'blocked_subscription_status' : 'missing_subscription',
			customerId: cache.customerId,
			subscriptionId: cache.subscriptionId,
			subscriptionStatus: cache.status,
		})
		return 'blocked'
	})
