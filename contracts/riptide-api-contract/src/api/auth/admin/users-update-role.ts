import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const UpdateAdminUserRoleInputSchema = z.object({
	userId: z.string(),
	roleSlug: z.enum(['admin', 'member']),
})

export const UpdateAdminUserRoleOutputSchema = z.object({
	success: z.boolean(),
})

export const updateAdminUserRoleContract = contractBuilder
	.input(UpdateAdminUserRoleInputSchema)
	.output(UpdateAdminUserRoleOutputSchema)
	.errors({
		CANNOT_DEMOTE_SELF: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		USER_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
	})
