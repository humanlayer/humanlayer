import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { BillingSubscriptionStatusSchema, StarterCapacityExceededDataSchema } from '../../types/billing'

export const DowngradeToStarterInputSchema = z.object({})

export const DowngradeToStarterOutputSchema = z.object({
	success: z.literal(true),
	activeMemberCount: z.number().int().positive(),
	pendingInvitationCount: z.number().int().nonnegative(),
	freeCapacity: z.number().int().positive(),
	starterSubscriptionId: z.string().nullable(),
	canceledProSubscriptionId: z.string().nullable(),
	subscriptionStatus: BillingSubscriptionStatusSchema,
})

export const downgradeToStarterContract = contractBuilder
	.input(DowngradeToStarterInputSchema)
	.output(DowngradeToStarterOutputSchema)
	.errors({
		CAPACITY_EXCEEDED: {
			status: StatusCodes.BAD_REQUEST,
			data: StarterCapacityExceededDataSchema,
		},
	})
