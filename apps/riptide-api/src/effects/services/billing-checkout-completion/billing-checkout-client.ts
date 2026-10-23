import { createHash } from 'node:crypto'

import {
	BILLING_CHECKOUT_CLIENTS,
	type BillingCheckoutClient,
	type BillingCheckoutClientInput,
} from '@humanlayer/riptide-api-contract/types/billing'
import { Config, Data, Effect, Schema } from 'effect'

/** A normalized checkout client selection, including an idempotency key for the attempt. */
export type ResolvedBillingCheckoutClient = {
	readonly client: BillingCheckoutClient
	readonly checkoutAttemptId: string
}

const BillingCheckoutClientSchema = Schema.Literals(
	BILLING_CHECKOUT_CLIENTS,
) satisfies Schema.Schema<BillingCheckoutClient>

/** Indicates that legacy checkout redirect URLs do not identify one supported client. */
export class InvalidLegacyBillingCheckoutClientError extends Data.TaggedError(
	'InvalidLegacyBillingCheckoutClientError',
)<{ readonly message: string }> {}

/**
 * Normalizes current checkout inputs and legacy redirect URL inputs into the current client-based shape.
 * Legacy callers retain deterministic attempt IDs so retries remain backward compatible.
 */
export const resolveBillingCheckoutClient = (
	input: BillingCheckoutClientInput,
	organizationId: string,
): Effect.Effect<ResolvedBillingCheckoutClient, InvalidLegacyBillingCheckoutClientError | Config.ConfigError> =>
	Effect.gen(function* () {
		if ('client' in input) {
			const client = yield* Schema.decodeUnknownEffect(BillingCheckoutClientSchema)(input.client).pipe(
				Effect.mapError(
					() =>
						new InvalidLegacyBillingCheckoutClientError({
							message: 'Billing checkout client is not recognized',
						}),
				),
			)
			return { ...input, client }
		}

		const origins = {
			app: (yield* Config.URL('APP_ORIGIN')).origin,
			cloud: (yield* Config.URL('CLOUD_ORIGIN')).origin,
		}
		const successClient = yield* clientFromLegacyUrl(input.successUrl, origins)
		const cancelClient = yield* clientFromLegacyUrl(input.cancelUrl, origins)
		if (!successClient || !cancelClient || successClient !== cancelClient) {
			return yield* new InvalidLegacyBillingCheckoutClientError({
				message: 'Legacy billing redirect URLs must target the same recognized HumanLayer client',
			})
		}

		return {
			client: successClient,
			checkoutAttemptId: legacyCheckoutAttemptId(organizationId, input.successUrl, input.cancelUrl),
		}
	})

const clientFromLegacyUrl = (
	rawUrl: string,
	origins: { readonly app: string; readonly cloud: string },
): Effect.Effect<BillingCheckoutClient | null, InvalidLegacyBillingCheckoutClientError> =>
	Effect.gen(function* () {
		const url = yield* Effect.try({
			try: () => new URL(rawUrl),
			catch: () =>
				new InvalidLegacyBillingCheckoutClientError({ message: 'Legacy billing redirect URL is invalid' }),
		})
		if (url.protocol === 'tauri:' && url.hostname === 'localhost') return 'native'
		if (url.origin === origins.app) return 'ui'
		if (url.origin === origins.cloud) return 'cloud'

		return null
	})

/**
 * Generates a stable UUIDv4-shaped idempotency key for legacy callers that did
 * not send a checkout attempt ID, so replayed requests reuse the Stripe result.
 */
const legacyCheckoutAttemptId = (organizationId: string, successUrl: string, cancelUrl: string): string => {
	const value = JSON.stringify([organizationId, successUrl, cancelUrl])
	const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16))
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = bytes.toString('hex')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
