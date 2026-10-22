import type { BillingTier } from '@humanlayer/billing/types'
import * as Sentry from '@sentry/node'
import { Config, Context, Effect, Layer } from 'effect'

import { isBillingEnforcementEnabled } from '../../../lib/environment'
import type { AppRuntime } from '../../app-runtime'
import { type BillingDependencies, isInGoodStanding, organizationBillingPlan } from './billing-plan'
import type { PriceIdByTier } from './billing-tier'

const FEATURE_TIERS = {
	advancedMetrics: new Set<BillingTier>(['pro', 'enterprise']),
}

export type Feature = keyof typeof FEATURE_TIERS

export class Entitlements extends Context.Service<
	Entitlements,
	{
		readonly hasFeature: (organizationId: string, feature: Feature) => Effect.Effect<boolean>
	}
>()('Entitlements') {}

export const organizationHasFeature = (organizationId: string, feature: Feature) =>
	Effect.gen(function* () {
		const entitlements = yield* Entitlements
		return yield* entitlements.hasFeature(organizationId, feature)
	})

export function hasFeature(runtime: AppRuntime, organizationId: string, feature: Feature): Promise<boolean> {
	return runtime.runPromise(organizationHasFeature(organizationId, feature))
}

// An id the environment does not set matches no price, which is what a tier nobody sells means.
const priceId = (name: string) => Config.String(name).pipe(Config.withDefault(''))

export const EntitlementsLive = Layer.effect(
	Entitlements,
	Effect.gen(function* () {
		const dependencies = yield* Effect.context<BillingDependencies>()
		const priceIdByTier: PriceIdByTier = {
			starter: yield* priceId('STRIPE_PRICE_STARTER'),
			pro: yield* priceId('STRIPE_PRICE_PRO'),
			enterprise: yield* priceId('STRIPE_PRICE_ENTERPRISE'),
		}

		const planIncludes = (feature: Feature, organizationId: string) =>
			organizationBillingPlan(organizationId, priceIdByTier).pipe(
				Effect.provide(dependencies),
				Effect.map((plan) => {
					if (plan === null || plan.tier === null || !isInGoodStanding(plan)) return false
					return FEATURE_TIERS[feature].has(plan.tier)
				}),
			)

		// Fails open: this runs inside `auth.user.info`, the bootstrap call every client makes, so a
		// billing lookup error must not 500 the whole app over a feature flag.
		const hasFeature = (organizationId: string, feature: Feature): Effect.Effect<boolean> =>
			Effect.suspend(() =>
				isBillingEnforcementEnabled() ? planIncludes(feature, organizationId) : Effect.succeed(true),
			).pipe(
				Effect.catchCause((cause) =>
					Effect.gen(function* () {
						yield* Effect.logWarning('Feature entitlement check failed open').pipe(
							Effect.annotateLogs({ cause, organizationId, feature }),
						)
						yield* Effect.sync(() =>
							Sentry.captureException(cause, {
								tags: { error_type: 'feature_entitlement_failure', feature },
								extra: { organizationId },
							}),
						)
						return true
					}),
				),
				Effect.withSpan('entitlements.has_feature'),
			)

		return Entitlements.of({ hasFeature })
	}),
)
