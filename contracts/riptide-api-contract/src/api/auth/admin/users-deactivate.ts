import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const DeactivateAdminUserInputSchema = z.object({
	userId: z.string(),
})

export const DeactivateAdminUserOutputSchema = z.object({
	success: z.literal(true),
})

export const deactivateAdminUserContract = contractBuilder
	.input(DeactivateAdminUserInputSchema)
	.output(DeactivateAdminUserOutputSchema)
	.errors({
		CANNOT_DEACTIVATE_SELF: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		LAST_ADMIN: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		USER_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
		INVALID_STATE: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
