import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ReactivateAdminUserInputSchema = z.object({
	userId: z.string(),
})

export const ReactivateAdminUserOutputSchema = z.object({
	success: z.literal(true),
})

export const reactivateAdminUserContract = contractBuilder
	.input(ReactivateAdminUserInputSchema)
	.output(ReactivateAdminUserOutputSchema)
	.errors({
		USER_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
		CAPACITY_EXCEEDED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({
				message: z.string(),
				currentActiveSeats: z.number(),
				pendingInvitations: z.number(),
				freeCapacity: z.number(),
			}),
		},
		INVALID_STATE: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
