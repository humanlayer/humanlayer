import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const RemoveAdminUserInputSchema = z.object({
	userId: z.string(),
})

export const RemoveAdminUserOutputSchema = z.object({
	success: z.boolean(),
})

export const removeAdminUserContract = contractBuilder
	.input(RemoveAdminUserInputSchema)
	.output(RemoveAdminUserOutputSchema)
	.errors({
		CANNOT_REMOVE_SELF: {
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
	})
