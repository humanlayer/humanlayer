import type { BillingKvService } from '@humanlayer/billing/billing-kv'
import type { RedisService } from '@humanlayer/billing/redis'
import type { Effect } from 'effect'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { StripeHttpClient } from '../stripe/stripe-http-client.service'
import type { StripeService } from '../stripe/stripe.service'
import type {
	BillingErrorCode,
	BillingSuccessCode,
	CheckoutCompletionRedirect,
	CheckoutRedirectInput,
	Client,
	ResolvedCheckoutOrganization,
} from './billing-checkout-completion.schema'

export type { CheckoutCompletionRedirect, CheckoutRedirectInput, Client, ResolvedCheckoutOrganization }

export type BillingCheckoutCompletionServiceShape = {
	readonly finalizeStarterToProUpgradeFromRedirect: (
		input: CheckoutRedirectInput,
	) => Effect.Effect<
		CheckoutCompletionRedirect,
		never,
		BillingKvService | PostgresDb | RedisService | StripeHttpClient | StripeService
	>
	readonly resyncFromCheckoutRedirect: (
		input: CheckoutRedirectInput,
	) => Effect.Effect<
		CheckoutCompletionRedirect,
		never,
		BillingKvService | PostgresDb | RedisService | StripeHttpClient | StripeService
	>
}

export type RedirectOrigins = {
	readonly appOrigin: URL
	readonly cloudOrigin: URL
}

export type CheckoutCompletionFailureRedirectInput = {
	readonly origins: RedirectOrigins
	readonly client: Client
	readonly errorCode: BillingErrorCode
}

export type CheckoutCompletionSuccessRedirectInput = {
	readonly origins: RedirectOrigins
	readonly client: Client
	readonly successCode: BillingSuccessCode
}
