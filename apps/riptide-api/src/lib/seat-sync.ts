import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type Stripe from 'stripe'

import type { IStripeService } from './stripe-service'
import type { WorkosSdkAdapter } from './workos-service'

export type SeatSyncReason =
	| 'checkout_creation'
	| 'trial_subscription_creation'
	| 'workos_webhook'
	| 'first_party_membership_mutation'
	| 'customer_force_sync'
	| 'admin_force_sync'

export type SeatSyncStripeService = Pick<
	IStripeService,
	'prices' | 'findCurrentSubscriptionItemForCustomer' | 'updateSubscriptionItemQuantity'
>

export type SeatSyncDependencies = {
	workosService: Pick<WorkosSdkAdapter, 'countActiveOrganizationMemberships'>
	/** `null` when this deployment has no Stripe; seat sync then does nothing. */
	stripeService: SeatSyncStripeService | null
	db: PostgresJsDatabase
}

/** Returned instead of a sync when this deployment has no Stripe. */
export type SeatSyncSkipped = { skipped: 'billing_not_configured' }

export type SeatSyncResult = {
	organizationId: string
	reason: SeatSyncReason
	seatCount: number
	subscriptionId: string
	subscriptionItemId: string
	previousQuantity: number | null
	currentQuantity: number | null
	stripeQuantityChanged: boolean
}

type SeatSyncInput = {
	organizationId: string
	reason: SeatSyncReason
	prorationBehavior?: Stripe.SubscriptionItemUpdateParams.ProrationBehavior
}

/**
 * Sets the Stripe subscription quantity to the organization's active member count. Without
 * Stripe (`stripeService: null`) it returns `{ skipped: 'billing_not_configured' }` and touches
 * nothing, so callers pass the service through without their own check.
 */
export async function syncOrganizationSeatQuantity(
	input: SeatSyncInput,
	deps: SeatSyncDependencies & { stripeService: SeatSyncStripeService },
): Promise<SeatSyncResult>
export async function syncOrganizationSeatQuantity(
	input: SeatSyncInput,
	deps: SeatSyncDependencies,
): Promise<SeatSyncResult | SeatSyncSkipped>
export async function syncOrganizationSeatQuantity(
	input: SeatSyncInput,
	deps: SeatSyncDependencies,
): Promise<SeatSyncResult | SeatSyncSkipped> {
	const { stripeService } = deps
	if (!stripeService) return { skipped: 'billing_not_configured' }
	const organizationId = normalizeRequiredId(input.organizationId, 'organizationId')
	const [organization] = await deps.db
		.select()
		.from(organizations)
		.where(eq(organizations.id, organizationId))
		.limit(1)

	if (!organization) {
		throw new Error(`Organization ${organizationId} was not found while syncing seat quantity`)
	}

	const parsedOrganization = organizationSelectSchema.safeParse(organization)
	if (!parsedOrganization.success) {
		throw new Error(
			`Selected organization billing row failed schema validation while syncing seat quantity: ${JSON.stringify(
				parsedOrganization.error.flatten(),
			)}`,
		)
	}

	const stripeCustomerId = parsedOrganization.data.stripe_customer_id
	if (!stripeCustomerId) {
		throw new Error(`Organization ${organizationId} is not linked to Stripe billing while syncing seat quantity`)
	}
	const subscriptionItem = await stripeService.findCurrentSubscriptionItemForCustomer(stripeCustomerId)
	if (!subscriptionItem) {
		throw new Error(`No active Stripe subscription item found for organization ${organizationId}`)
	}

	const seatCount = await deps.workosService.countActiveOrganizationMemberships(
		parsedOrganization.data.workos_organization_id,
	)
	const targetQuantity =
		subscriptionItem.priceId === stripeService.prices.starter ||
		subscriptionItem.priceId === stripeService.prices.pro
			? seatCount
			: 1
	const updatedSubscriptionItem = await stripeService.updateSubscriptionItemQuantity({
		subscriptionItemId: subscriptionItem.subscriptionItemId,
		quantity: targetQuantity,
		prorationBehavior: input.prorationBehavior ?? 'create_prorations',
	})

	return {
		organizationId,
		reason: input.reason,
		seatCount,
		subscriptionId: subscriptionItem.subscriptionId,
		subscriptionItemId: subscriptionItem.subscriptionItemId,
		previousQuantity: subscriptionItem.quantity,
		currentQuantity: updatedSubscriptionItem.quantity,
		stripeQuantityChanged: subscriptionItem.quantity !== targetQuantity,
	}
}

function normalizeRequiredId(value: string | null | undefined, fieldName: string): string {
	const normalized = value?.trim()
	if (!normalized) {
		throw new Error(`Seat sync expected non-empty ${fieldName}`)
	}

	return normalized
}
