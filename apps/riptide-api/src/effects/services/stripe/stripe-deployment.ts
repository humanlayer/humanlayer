import { type Config, Effect } from 'effect'

import { type IntegrationKeyGroupStatus, StripeKeyGroup } from '../../../lib/integration-key-groups'
import {
	BillingEnforcementEnabledConfig,
	readIntegrationKeyGroupStatus,
	reportIntegrationKeyGroupStatus,
} from '../integration-configuration/integration-key-group'

export type StripeDeployment = {
	readonly billingEnforcementEnabled: boolean
	/**
	 * Whether the real Stripe service runs. Always true with billing enforcement on, so a missing
	 * key stops startup naming it. With enforcement off, true only when every STRIPE_* key is set.
	 */
	readonly stripeConfigured: boolean
	readonly keyGroupStatus: IntegrationKeyGroupStatus
}

/**
 * Decides whether this deployment runs Stripe:
 *
 *   billing on,  any key missing → real Stripe; its config read stops startup naming the key
 *   billing on,  all keys set    → real Stripe
 *   billing off, all keys set    → real Stripe
 *   billing off, any key missing → not set up
 */
export const readStripeDeployment: Effect.Effect<StripeDeployment, Config.ConfigError> = Effect.gen(function* () {
	const billingEnforcementEnabled = yield* BillingEnforcementEnabledConfig
	const keyGroupStatus = yield* readIntegrationKeyGroupStatus(StripeKeyGroup)
	return {
		billingEnforcementEnabled,
		stripeConfigured: billingEnforcementEnabled || keyGroupStatus.configured,
		keyGroupStatus,
	}
})

/** `readStripeDeployment`, plus the startup log lines. Called once, by the Stripe service layer. */
export const loadStripeDeployment: Effect.Effect<StripeDeployment, Config.ConfigError> = readStripeDeployment.pipe(
	Effect.tap((deployment) =>
		Effect.logInfo(`Billing enforcement is ${deployment.billingEnforcementEnabled ? 'on' : 'off'}`).pipe(
			Effect.annotateLogs({ billing_enforcement_enabled: deployment.billingEnforcementEnabled }),
		),
	),
	Effect.tap((deployment) =>
		// With enforcement on, a missing key is not a warning: the Stripe config read fails startup.
		deployment.billingEnforcementEnabled
			? Effect.void
			: reportIntegrationKeyGroupStatus(StripeKeyGroup, deployment.keyGroupStatus),
	),
	Effect.withSpan('stripe_deployment.load'),
)
