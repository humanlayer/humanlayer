import type { BillingKvServiceShape, ReadableStripeSubscriptionCache } from '@humanlayer/billing/billing-kv'
import { BillingKvService } from '@humanlayer/billing/billing-kv'
import * as Sentry from '@sentry/node'
import { type Context, Duration, Effect, Layer, Predicate } from 'effect'

import { StripeService } from '../stripe/stripe.service'
import type { StripeServiceShape } from '../stripe/stripe.types'
import { decideFromCache, decisionForFailure } from './billing-access-decision'
import { captureBlocked, captureRefreshRequired } from './billing-access-telemetry'
import {
	type BillingStepCause,
	BillingStepFailure,
	classifyStepCause,
	type Dependency,
	isCacheDecodeFailure,
} from './billing-access.errors'
import { BillingAccess, type BillingAccessDecision, type BillingAccessInput } from './billing-access.service'
import type { BillingDependencies } from './billing-plan'

const DEPENDENCY_TIMEOUT = Duration.millis(750)

const undecodableCache = { malformed: true, cache: null as ReadableStripeSubscriptionCache | null }

/**
 * The decision workflow, built against resolved dependencies so it can be exercised without
 * building the layer. The steps re-provide the captured context because the service shape
 * declares no dependencies of its own.
 */
export const makeBillingAccess = (services: {
	readonly kv: BillingKvServiceShape
	readonly stripe: StripeServiceShape
	readonly dependencies: Context.Context<BillingDependencies>
}) => {
	const { kv, stripe, dependencies } = services

	const runDependencyStep = <A, E extends BillingStepCause>(
		step: Effect.Effect<A, E, BillingDependencies>,
		name: Dependency,
		input: BillingAccessInput,
	): Effect.Effect<A, BillingStepFailure> =>
		step.pipe(
			Effect.provide(dependencies),
			Effect.timeout(DEPENDENCY_TIMEOUT),
			Effect.retry({ times: 1 }),
			Effect.catchCause((cause) =>
				Effect.gen(function* () {
					const error = classifyStepCause(cause)
					const reported = Predicate.isTagged(error, 'BillingStepDefect') ? error.defect : error
					yield* Effect.logWarning('Billing access dependency failed').pipe(
						Effect.annotateLogs({
							error: reported,
							dependency: name,
							operation: input.operation,
							organizationId: input.organizationId,
						}),
					)
					yield* Effect.sync(() =>
						Sentry.captureException(reported, {
							tags: {
								error_type: 'billing_access_dependency_error',
								dependency: name,
								operation: input.operation,
							},
							extra: { organizationId: input.organizationId },
						}),
					)
					return yield* Effect.fail(new BillingStepFailure({ step: name, error }))
				}),
			),
		)

	const refreshCache = (customerId: string) =>
		stripe
			.syncCustomerBillingToKv({ customerId })
			.pipe(Effect.provide(dependencies), Effect.withSpan('billing_access.refresh_stripe_billing_cache'))

	const readOrgCustomerId = (input: BillingAccessInput) =>
		runDependencyStep(kv.getOrgCustomerId({ organizationId: input.organizationId }), 'kv_org_customer', input)

	const readSubscriptionCache = (
		customerId: string,
		input: BillingAccessInput,
	): Effect.Effect<ReadableStripeSubscriptionCache | null, BillingStepFailure> =>
		runDependencyStep(
			kv.getSubscriptionCache({ customerId }).pipe(
				Effect.map((cache) => ({ malformed: false, cache })),
				Effect.catchTag('BillingKvCacheDecodeError', () => Effect.succeed(undecodableCache)),
			),
			'kv_subscription_cache',
			input,
		).pipe(
			Effect.catchTag('BillingStepFailure', (failure) =>
				isCacheDecodeFailure(failure) ? Effect.succeed(undecodableCache) : Effect.fail(failure),
			),
			Effect.tap((read) =>
				read.malformed
					? captureRefreshRequired(input, { reason: 'malformed_subscription_cache', customerId })
					: read.cache === null
						? captureRefreshRequired(input, { reason: 'missing_subscription_cache', customerId })
						: Effect.void,
			),
			Effect.map((read) => read.cache),
		)

	const decideForOperation = (input: BillingAccessInput): Effect.Effect<BillingAccessDecision> =>
		Effect.gen(function* () {
			const customerId = yield* readOrgCustomerId(input)
			if (!customerId) {
				yield* captureBlocked(input, { reason: 'missing_customer_mapping' })
				return 'blocked'
			}

			let cache: ReadableStripeSubscriptionCache | null = yield* readSubscriptionCache(customerId, input)
			if (!cache) {
				cache = yield* runDependencyStep(refreshCache(customerId), 'stripe_refresh', input)
			}

			return yield* decideFromCache(cache, input)
		}).pipe(
			Effect.catchTag('BillingStepFailure', (failure) => decisionForFailure(failure, input)),
			Effect.withSpan('billing_access.decide_for_operation'),
		)

	return { decideForOperation, refreshStripeBillingCache: refreshCache }
}

export const BillingAccessLive = Layer.effect(
	BillingAccess,
	Effect.gen(function* () {
		const kv = yield* BillingKvService
		const stripe = yield* StripeService
		const dependencies = yield* Effect.context<BillingDependencies>()

		return BillingAccess.of(makeBillingAccess({ kv, stripe, dependencies }))
	}),
)
