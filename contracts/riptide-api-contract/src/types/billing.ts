import z from 'zod/v4'

import { RIPTIDE_CLIENTS, RiptideClientSchema, type RiptideClient } from './client'

/**
 * Canonical client identifiers accepted by every billing Checkout flow.
 * Aliases of the shared {@link RIPTIDE_CLIENTS} enum so there is one definition in the repo.
 */
export const BILLING_CHECKOUT_CLIENTS = RIPTIDE_CLIENTS
export const BillingCheckoutClientSchema = RiptideClientSchema
export type BillingCheckoutClient = RiptideClient

export const CheckoutAttemptIdSchema = z.uuidv4()
export type CheckoutAttemptId = z.infer<typeof CheckoutAttemptIdSchema>

export const BillingSubscriptionStatusSchema = z.enum([
	'active',
	'canceled',
	'incomplete',
	'incomplete_expired',
	'past_due',
	'paused',
	'trialing',
	'unpaid',
	'none',
])
export type BillingSubscriptionStatus = z.infer<typeof BillingSubscriptionStatusSchema>

export const StarterCapacityExceededDataSchema = z.object({
	message: z.string(),
	currentActiveSeats: z.number().int().positive(),
	pendingInvitations: z.number().int().nonnegative(),
	freeCapacity: z.number().int().positive(),
})
export type StarterCapacityExceededData = z.infer<typeof StarterCapacityExceededDataSchema>

export const MembershipStatusSchema = z.enum(['active', 'inactive'])
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>

export const BillingCheckoutClientInputSchema = z.union([
	z.object({
		client: BillingCheckoutClientSchema,
		checkoutAttemptId: CheckoutAttemptIdSchema,
	}),
	z.object({
		successUrl: z.string().url(),
		cancelUrl: z.string().url(),
	}),
])
export type BillingCheckoutClientInput = z.infer<typeof BillingCheckoutClientInputSchema>
