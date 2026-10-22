import { stripeCustomerIdSchema as StripeCustomerIdSchema } from '@humanlayer/db/tables/organizations'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const BillingInfoInputSchema = z.object({})

export const BillingPaymentMethodSchema = z.object({
	brand: z.string().nullable(),
	last4: z.string().nullable(),
	expMonth: z.number().nullable(),
	expYear: z.number().nullable(),
})

export const BillingDiscountSchema = z.object({
	id: z.string(),
	promotionCodeId: z.string().nullable(),
	code: z.string().nullable(),
	name: z.string().nullable(),
	percentOff: z.number().nullable(),
	amountOff: z.number().nullable(),
	currency: z.string().nullable(),
	duration: z.string().nullable(),
})

export const BillingNextInvoiceSchema = z.object({
	amountDue: z.number(),
	currency: z.string(),
})

export const BillingInfoOutputSchema = z.object({
	rolloutDisplayState: z.enum(['not_linked', 'billing_linked', 'billing_enrolled']),
	tier: z.enum(['starter', 'pro', 'enterprise']).nullable(),
	subscriptionStatus: z.enum(['trialing', 'active', 'paused', 'past_due', 'unpaid', 'none']).nullable(),
	hasPaymentMethod: z.boolean().nullable(),
	paymentMethod: BillingPaymentMethodSchema.nullable(),
	discount: BillingDiscountSchema.nullable(),
	nextInvoice: BillingNextInvoiceSchema.nullable(),
	stripeCustomerId: StripeCustomerIdSchema.nullable(),
	subscriptionId: z.string().nullable(),
	priceId: z.string().nullable(),
	currentPeriodEnd: z.number().nullable(),
	syncedAt: z.number().nullable(),
	activeSeatCount: z.number().int().positive().nullable(),
	pendingInvitationCount: z.number().int().nonnegative().nullable(),
	freeCapacity: z.number().int().positive().nullable(),
})

export type BillingInfoInput = z.infer<typeof BillingInfoInputSchema>
export type BillingInfoOutput = z.infer<typeof BillingInfoOutputSchema>

export const billingInfoContract = contractBuilder.input(BillingInfoInputSchema).output(BillingInfoOutputSchema)
